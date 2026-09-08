import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { health, OK } from "./models.js";
import type { HealthReport, TickReport } from "./models.js";
import type { Awaitable, Channel } from "./ports.js";
import { readJson, writeJsonAtomic } from "./state.js";
import { isRecord } from "./json.js";

export class ConsoleChannel implements Channel {
  readonly name = "console";
  private current = health(OK, "ready");
  constructor(private readonly sink: (text: string) => void = console.log) {}
  publish(report: TickReport): void {
    for (const action of report.actions.length
      ? report.actions
      : ["no actions"])
      this.sink(action);
    this.current = health(OK, `reported ${report.actions.length} action(s)`);
  }
  health(): HealthReport {
    return this.current;
  }
}
export class JsonlAuditChannel implements Channel {
  readonly name = "audit-log";
  private current = health(OK, "ready");
  constructor(readonly path: string) {}
  publish(report: TickReport): void {
    if (report.dryRun) {
      this.current = health(OK, "dry run; audit not written");
      return;
    }
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(
      this.path,
      JSON.stringify({
        started_at: report.startedAt,
        finished_at: report.finishedAt,
        dry_run: report.dryRun,
        actions: report.actions,
        states: Object.fromEntries(
          Object.entries(report.snapshots).map(([key, value]) => [
            key,
            value.state,
          ]),
        ),
        health: report.health,
        degraded_sources: report.degradedSources,
      }) + "\n",
    );
    this.current = health(OK, "tick appended");
  }
  health(): HealthReport {
    return this.current;
  }
}
export function healthChanged(
  previous: Readonly<Record<string, unknown>>,
  name: string,
  current: HealthReport,
): boolean {
  const row = previous[name];
  return (
    !isRecord(row) ||
    row.status !== current.status ||
    (current.status !== OK && row.message !== current.message)
  );
}
export class HealthChangeChannel implements Channel {
  readonly name = "health";
  private current = health(OK, "ready");
  constructor(
    readonly statePath: string,
    private readonly sink: (text: string) => Awaitable<void> = console.log,
  ) {}
  async publish(report: TickReport): Promise<void> {
    if (report.dryRun) {
      this.current = health(OK, "dry run; health state not written");
      return;
    }
    const previous = readJson(this.statePath) ?? {};
    const lines = Object.entries(report.health)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .filter(([name, value]) => healthChanged(previous, name, value))
      .map(([name, value]) => `${value.status} ${name}: ${value.message}`);
    if (lines.length) await this.sink(lines.join("\n"));
    writeJsonAtomic(this.statePath, report.health);
    this.current = health(OK, `reported ${lines.length} change(s)`);
  }
  health(): HealthReport {
    return this.current;
  }
}
