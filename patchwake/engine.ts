/** One finite observe → decide → act tick. Channels always run last. */
import { health, observation, ERROR, WARNING, OK } from "./models.js";
import type {
  Activity,
  HealthReport,
  RunSnapshot,
  TaskObservation,
  TickReport,
  WorkItem,
} from "./models.js";
import type {
  ActivitySource,
  AgentRuntime,
  Board,
  Channel,
  HealthComponent,
} from "./ports.js";
import {
  activityPrompt,
  advanceSeen,
  freshActivities,
  sortCandidates,
} from "./policy.js";
import type { Candidate } from "./policy.js";
import { ClaimConflict, FileStateStore, nowSeconds } from "./state.js";
import {
  CLAIMED,
  FAILED,
  GAVE_UP,
  IDLE,
  RUNNING,
  STOPPED,
  STOPPING,
  WAITING,
} from "./state-machine.js";
import { errorMessage, lookup } from "./json.js";

export interface EngineConfig {
  readonly maxConcurrentTurns: number;
  readonly stallAfterSeconds: number;
  readonly stopGraceSeconds: number;
  readonly maxRestarts: number;
  readonly restartBackoffBaseSeconds: number;
  readonly requireDirectedActivity: boolean;
  readonly botIdentities: ReadonlySet<string>;
  readonly dryRun: boolean;
}
export interface EngineOptions {
  board: Board;
  activitySources: readonly ActivitySource[];
  runtime: AgentRuntime;
  channels: readonly Channel[];
  store: FileStateStore;
  config?: Partial<EngineConfig>;
  clock?: () => number;
}
type Snapshots = Readonly<Record<string, RunSnapshot>>;
type Observations = Readonly<Record<string, TaskObservation>>;

export class Engine {
  readonly board: Board;
  readonly activitySources: readonly ActivitySource[];
  readonly runtime: AgentRuntime;
  readonly channels: readonly Channel[];
  readonly store: FileStateStore;
  readonly config: EngineConfig;
  private readonly clock: () => number;

  constructor(options: EngineOptions) {
    this.board = options.board;
    this.activitySources = [...options.activitySources];
    this.runtime = options.runtime;
    this.channels = [...options.channels];
    this.store = options.store;
    this.clock = options.clock ?? nowSeconds;
    this.config = {
      maxConcurrentTurns: 3,
      stallAfterSeconds: 900,
      stopGraceSeconds: 120,
      maxRestarts: 5,
      restartBackoffBaseSeconds: 60,
      requireDirectedActivity: true,
      botIdentities: new Set(),
      dryRun: false,
      ...options.config,
    };
    for (const name of [
      "maxConcurrentTurns",
      "stallAfterSeconds",
      "stopGraceSeconds",
      "maxRestarts",
      "restartBackoffBaseSeconds",
    ] as const) {
      if (!Number.isInteger(this.config[name]) || this.config[name] < 0)
        throw new Error(`${name} must be a nonnegative integer`);
    }
  }
  tick(options: { dryRun?: boolean } = {}): Promise<TickReport> {
    return this.store.withTickLock(() =>
      this.runTick(options.dryRun ?? this.config.dryRun),
    );
  }
  async status(): Promise<Snapshots> {
    const entries = [];
    for (const [key, directory] of Object.entries(this.store.claims())) {
      entries.push([
        key,
        this.store.inspect(
          key,
          directory,
          this.store.waits(directory),
          await this.runtime.isAlive(directory),
          this.clock(),
        ),
      ] as const);
    }
    return Object.fromEntries(entries);
  }
  private async runTick(dry: boolean): Promise<TickReport> {
    const startedAt = this.clock(),
      actions: string[] = [];
    const componentHealth: Record<string, HealthReport> = Object.create(
      null,
    ) as Record<string, HealthReport>;
    let assigned: Record<string, WorkItem> | null;
    try {
      assigned = Object.fromEntries(
        (await this.board.fetch()).map((item) => [item.key, item]),
      );
      componentHealth[this.board.name] = await this.safeHealth(this.board);
    } catch (error) {
      assigned = null;
      componentHealth[this.board.name] = health(
        ERROR,
        `assignment unknown this tick: ${errorMessage(error)}`,
      );
      actions.push(
        `${this.board.name}: assignment unknown; preserving every claim`,
      );
    }
    let claims = this.store.claims();
    const known = new Map(Object.entries(assigned ?? {}));
    for (const [key, directory] of Object.entries(claims)) {
      const saved = this.store.workItem(directory);
      if (!known.has(key) && saved) known.set(key, saved);
    }
    const items = [...known.values()];
    let observations: Record<string, TaskObservation> = Object.fromEntries(
      items.map((item) => [item.key, observation()]),
    );
    const degraded: string[] = [];
    for (const source of this.activitySources) {
      try {
        const batch = await source.observe(items);
        const merged = new Map(Object.entries(observations));
        for (const [key, incoming] of Object.entries(batch)) {
          const previous = merged.get(key) ?? observation();
          merged.set(
            key,
            observation(
              [...previous.activities, ...incoming.activities],
              [...previous.waits, ...incoming.waits],
            ),
          );
        }
        observations = Object.fromEntries(merged);
        componentHealth[source.name] = await this.safeHealth(source);
      } catch (error) {
        degraded.push(source.name);
        const current = await this.safeHealth(source);
        componentHealth[source.name] =
          current.status !== OK
            ? current
            : health(
                WARNING,
                `observation failed this tick: ${errorMessage(error)}`,
              );
        actions.push(`${source.name}: degraded; activity treated as unknown`);
      }
    }
    if (degraded.length) {
      // A partial observation must not clear waits. Healthy-source activity still wakes.
      observations = Object.fromEntries(
        Object.entries(observations).map(([key, value]) => {
          const directory = lookup(claims, key);
          return [
            key,
            observation(
              value.activities,
              directory ? this.store.waits(directory) : [],
            ),
          ];
        }),
      );
    } else if (!dry) {
      for (const [key, directory] of Object.entries(claims))
        this.store.writeWaits(
          directory,
          lookup(observations, key)?.waits ?? [],
        );
    }
    let snapshots = await this.snapshots(claims, observations, startedAt);
    await this.killStalled(snapshots, actions, dry);
    this.reap(snapshots, actions, dry);
    if (assigned !== null) {
      await this.standDown(
        snapshots,
        new Set(Object.keys(assigned)),
        actions,
        dry,
      );
      for (const key of Object.keys(claims)
        .filter((key) => Object.hasOwn(assigned, key))
        .sort()) {
        const snapshot = lookup(snapshots, key);
        if (!snapshot?.stoppingAt) continue;
        actions.push(`${dry ? "would re-arm" : "re-armed"} ${key}`);
        if (!dry) this.store.clearStopping(snapshot.directory);
      }
    }
    claims = this.store.claims();
    snapshots = await this.snapshots(claims, observations, this.clock());
    if (assigned !== null)
      await this.fire(assigned, observations, snapshots, actions, dry);
    if (!dry)
      for (const name of this.store.tidyStaging())
        actions.push(`cleaned stale staging directory ${name}`);
    snapshots = await this.snapshots(
      this.store.claims(),
      observations,
      this.clock(),
    );
    componentHealth[this.runtime.name] = await this.safeHealth(this.runtime);
    const report: TickReport = {
      startedAt,
      finishedAt: this.clock(),
      actions,
      snapshots,
      health: componentHealth,
      degradedSources: degraded,
      dryRun: dry,
    };
    for (const channel of this.channels) {
      try {
        // Isolate reporting even from a channel that mutates its input at runtime.
        await channel.publish(
          structuredClone({ ...report, actions, health: componentHealth }),
        );
        componentHealth[channel.name] = await this.safeHealth(channel);
      } catch (error) {
        componentHealth[channel.name] = health(
          WARNING,
          `notification failed this tick: ${errorMessage(error)}`,
        );
        actions.push(
          `${channel.name}: notification failed: ${errorMessage(error)}`,
        );
      }
    }
    return { ...report, actions: [...actions], health: { ...componentHealth } };
  }
  private async snapshots(
    claims: Readonly<Record<string, string>>,
    observations: Observations,
    now: number,
  ): Promise<Snapshots> {
    const entries = [];
    for (const [key, directory] of Object.entries(claims))
      entries.push([
        key,
        this.store.inspect(
          key,
          directory,
          lookup(observations, key)?.waits ?? [],
          await this.runtime.isAlive(directory),
          now,
        ),
      ] as const);
    return Object.fromEntries(entries);
  }
  private async killStalled(
    snapshots: Snapshots,
    actions: string[],
    dry: boolean,
  ): Promise<void> {
    if (!this.config.stallAfterSeconds) return;
    for (const snapshot of Object.values(snapshots)) {
      if (
        !snapshot.alive ||
        snapshot.silentFor <= this.config.stallAfterSeconds
      )
        continue;
      actions.push(
        `${dry ? "would kill" : "killed"} ${snapshot.key}: silent for ${Math.trunc(snapshot.silentFor)}s`,
      );
      if (!dry) await this.runtime.stop(snapshot, { force: true });
    }
  }
  private reap(snapshots: Snapshots, actions: string[], dry: boolean): void {
    for (const snapshot of Object.values(snapshots)) {
      if (
        snapshot.alive ||
        ![FAILED, IDLE, WAITING, GAVE_UP, STOPPED].some(
          (state) => state === snapshot.state,
        ) ||
        this.store.recordedState(snapshot.directory) === snapshot.state
      )
        continue;
      actions.push(
        `${dry ? "would reap" : "reaped"} ${snapshot.key}: ${snapshot.state}`,
      );
      if (!dry) this.store.recordState(snapshot.directory, snapshot.state);
    }
  }
  private async standDown(
    snapshots: Snapshots,
    assignedKeys: ReadonlySet<string>,
    actions: string[],
    dry: boolean,
  ): Promise<void> {
    const now = this.clock();
    for (const [key, snapshot] of Object.entries(snapshots)) {
      if (assignedKeys.has(key)) continue;
      if (snapshot.alive) {
        const force = Boolean(
          snapshot.stoppingAt &&
          now - snapshot.stoppingAt > this.config.stopGraceSeconds,
        );
        actions.push(
          `${dry ? "would stop" : "stopping"} ${key}${force ? " (grace expired)" : ""}`,
        );
        if (!dry) {
          this.store.markStopping(snapshot.directory, now);
          await this.runtime.stop(snapshot, { force });
        }
      } else {
        actions.push(`${dry ? "would stand down" : "stood down"} ${key}`);
        if (!dry) {
          this.store.markStopping(snapshot.directory, now);
          this.store.recordState(snapshot.directory, STOPPED);
        }
      }
    }
  }
  private async fire(
    assigned: Readonly<Record<string, WorkItem>>,
    observations: Observations,
    snapshots: Snapshots,
    actions: string[],
    dry: boolean,
  ): Promise<void> {
    const candidates: Candidate[] = [],
      freshByKey = new Map<string, Activity[]>();
    for (const [key, snapshot] of Object.entries(snapshots)) {
      const item = lookup(assigned, key);
      if (
        !item ||
        snapshot.alive ||
        [GAVE_UP, STOPPED, RUNNING, STOPPING].some(
          (state) => state === snapshot.state,
        )
      )
        continue;
      if (snapshot.state === FAILED)
        candidates.push({ priority: item.priority, key, kind: "retry" });
      else if (snapshot.state === CLAIMED)
        candidates.push({ priority: item.priority, key, kind: "bootstrap" });
      else {
        const fresh = freshActivities(
          lookup(observations, key)?.activities ?? [],
          this.store.seen(snapshot.directory),
          this.config.botIdentities,
          this.config.requireDirectedActivity,
        );
        if (fresh.length) {
          freshByKey.set(key, fresh);
          candidates.push({ priority: item.priority, key, kind: "activity" });
        }
      }
    }
    for (const [key, item] of Object.entries(assigned))
      if (!Object.hasOwn(snapshots, key))
        candidates.push({ priority: item.priority, key, kind: "claim" });
    const ordered = sortCandidates(candidates);
    let room = Math.max(
      0,
      this.config.maxConcurrentTurns -
        Object.values(snapshots).filter(
          (snapshot) =>
            snapshot.alive ||
            snapshot.state === RUNNING ||
            snapshot.state === STOPPING,
        ).length,
    );
    for (const [index, candidate] of ordered.entries()) {
      if (room <= 0) {
        actions.push(
          `deferred at concurrency cap: ${ordered
            .slice(index)
            .map((value) => value.key)
            .join(", ")}`,
        );
        break;
      }
      const item = lookup(assigned, candidate.key);
      if (
        item &&
        (await this.fireCandidate(
          candidate,
          item,
          lookup(observations, candidate.key) ?? observation(),
          lookup(snapshots, candidate.key),
          freshByKey.get(candidate.key) ?? [],
          actions,
          dry,
        ))
      )
        room--;
    }
  }
  private async fireCandidate(
    candidate: Candidate,
    item: WorkItem,
    observed: TaskObservation,
    snapshot: RunSnapshot | undefined,
    fresh: readonly Activity[],
    actions: string[],
    dry: boolean,
  ): Promise<boolean> {
    const now = this.clock(),
      kind = candidate.kind;
    let directory: string, prompt: string, resume: boolean, sequence: number;
    if (kind === "claim") {
      if (dry) {
        actions.push(`would claim and fire ${item.key}: ${item.title}`);
        return true;
      }
      try {
        directory = this.store.claim(item);
      } catch (error) {
        if (error instanceof ClaimConflict) return false;
        throw error;
      }
      prompt = this.store.bootstrapPrompt(directory);
      resume = false;
      sequence = 1;
    } else if (!snapshot) return false;
    else if (kind === "bootstrap") {
      directory = snapshot.directory;
      prompt = this.store.bootstrapPrompt(directory);
      resume = false;
      sequence = 1;
    } else if (kind === "activity") {
      directory = snapshot.directory;
      prompt = activityPrompt(fresh);
      resume = true;
      sequence = (snapshot.turn.sequence ?? 0) + 1;
    } else {
      directory = snapshot.directory;
      const count = snapshot.restarts;
      if (count >= this.config.maxRestarts) {
        actions.push(`gave up ${item.key} after ${count} restart(s)`);
        if (!dry) this.store.markGaveUp(directory, now);
        return false;
      }
      if (count && snapshot.lastRestartAt) {
        const remaining = Math.trunc(
          this.config.restartBackoffBaseSeconds * 2 ** count -
            (now - snapshot.lastRestartAt),
        );
        if (remaining > 0) {
          actions.push(`${item.key}: retry backoff has ${remaining}s left`);
          return false;
        }
      }
      prompt = snapshot.turn.prompt || "Resume the interrupted task.";
      resume = snapshot.turn.resumed ?? true;
      sequence = snapshot.turn.sequence || 1;
    }
    if (kind === "claim" || kind === "bootstrap") {
      const initial = freshActivities(
        observed.activities,
        {},
        this.config.botIdentities,
        this.config.requireDirectedActivity,
      );
      if (initial.length) prompt += "\n\n" + activityPrompt(initial);
    }
    if (dry) {
      actions.push(`would fire ${item.key} (${kind})`);
      return true;
    }
    this.store.clearStopping(directory);
    const result = await this.runtime.start(
      directory,
      prompt,
      resume,
      sequence,
    );
    if (!result.ok) {
      this.store.recordState(directory, FAILED);
      actions.push(`fire failed ${item.key}: ${result.detail ?? ""}`);
      return false;
    }
    if (kind === "retry" && snapshot)
      this.store.recordRestart(directory, snapshot.restarts + 1, now);
    if (
      (kind === "activity" || kind === "claim" || kind === "bootstrap") &&
      observed.activities.length
    ) {
      // Consume all observed events, including filtered ones, only after successful creation.
      this.store.writeSeen(
        directory,
        advanceSeen(this.store.seen(directory), observed.activities),
      );
    }
    actions.push(`fired ${item.key} (${kind})`);
    return true;
  }
  private async safeHealth(component: HealthComponent): Promise<HealthReport> {
    try {
      const report = await component.health();
      return report &&
        [OK, WARNING, ERROR].includes(report.status) &&
        typeof report.message === "string"
        ? report
        : health(WARNING, "component returned invalid health");
    } catch (error) {
      return health(WARNING, `health unavailable: ${errorMessage(error)}`);
    }
  }
}
