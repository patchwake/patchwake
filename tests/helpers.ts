import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Engine } from "../patchwake/engine.js";
import type { EngineConfig } from "../patchwake/engine.js";
import { health, OK, workItem } from "../patchwake/models.js";
import type {
  RunSnapshot,
  TaskObservation,
  WorkItem,
} from "../patchwake/models.js";
import type {
  AgentRuntime,
  Board,
  ActivitySource,
  Channel,
} from "../patchwake/ports.js";
import { FileStateStore, writeJsonAtomic } from "../patchwake/state.js";

export function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "patchwake-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
export async function waitFor(
  predicate: () => boolean,
  detail = "condition",
  timeout = 5000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${detail}`);
    await setTimeout(10);
  }
}
export const work = (key = "TASK-1", priority = 100): WorkItem =>
  workItem({
    key,
    title: `Title ${key}`,
    url: `https://board.test/${key}`,
    priority,
  });
export class FakeBoard implements Board {
  readonly name = "board";
  error: Error | null = null;
  constructor(public items: WorkItem[]) {}
  fetch(): WorkItem[] {
    if (this.error) throw this.error;
    return [...this.items];
  }
  health() {
    return health(OK, `${this.items.length} item(s)`);
  }
}
export class FakeSource implements ActivitySource {
  readonly name: string;
  observations: Record<string, TaskObservation> = {};
  error: Error | null = null;
  constructor(name = "source") {
    this.name = name;
  }
  observe(): Record<string, TaskObservation> {
    if (this.error) throw this.error;
    return { ...this.observations };
  }
  health() {
    return health(OK, "observed");
  }
}
export class FakeRuntime implements AgentRuntime {
  readonly name = "runtime";
  readonly alive = new Set<string>();
  readonly starts: {
    directory: string;
    prompt: string;
    sessionId: string;
    resume: boolean;
    sequence: number;
  }[] = [];
  readonly stops: { key: string; force: boolean }[] = [];
  fail = false;
  ignoreStops = false;
  constructor(readonly store: FileStateStore) {}
  isAlive(directory: string): boolean {
    return this.alive.has(directory);
  }
  start(directory: string, prompt: string, resume: boolean, sequence: number) {
    this.starts.push({
      directory,
      prompt,
      sessionId: this.store.sessionId(directory, this.name),
      resume,
      sequence,
    });
    if (this.fail) return { ok: false, detail: "injected failure" };
    writeJsonAtomic(this.store.statePath(directory, "turn.json"), {
      sequence,
      prompt,
      resumed: resume,
      started_at: 100,
      pid: 123,
    });
    rmSync(this.store.statePath(directory, "status.json"), { force: true });
    this.alive.add(directory);
    return { ok: true };
  }
  stop(
    snapshot: RunSnapshot,
    { force = false }: { force?: boolean } = {},
  ): void {
    this.stops.push({ key: snapshot.key, force });
    if (!this.ignoreStops || force) this.alive.delete(snapshot.directory);
  }
  health() {
    return health(OK, "ready");
  }
  complete(directory: string, exitCode = 0): void {
    writeJsonAtomic(this.store.statePath(directory, "status.json"), {
      sequence: this.store.turn(directory).sequence,
      exit_code: exitCode,
    });
    this.alive.delete(directory);
  }
}
export function makeEngine(
  t: TestContext,
  items = [work()],
  options: { config?: Partial<EngineConfig>; channels?: Channel[] } = {},
) {
  const root = temporary(t),
    store = new FileStateStore(join(root, "var"));
  const board = new FakeBoard(items),
    source = new FakeSource(),
    runtime = new FakeRuntime(store),
    time = { now: 100 };
  const engine = new Engine({
    board,
    activitySources: [source],
    runtime,
    channels: options.channels ?? [],
    store,
    config: {
      stallAfterSeconds: 0,
      botIdentities: new Set(["bot"]),
      ...options.config,
    },
    clock: () => time.now,
  });
  return { root, store, board, source, runtime, engine, time };
}
