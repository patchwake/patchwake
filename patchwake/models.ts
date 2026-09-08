/** Provider-neutral values. Remote comment bodies never cross these boundaries. */
export const OK = "OK";
export const WARNING = "WARNING";
export const ERROR = "ERROR";
export type HealthStatus = typeof OK | typeof WARNING | typeof ERROR;
export interface HealthReport {
  readonly status: HealthStatus;
  readonly message: string;
}
export function health(status: HealthStatus, message: string): HealthReport {
  if (![OK, WARNING, ERROR].includes(status))
    throw new Error(`unknown health status: ${status}`);
  return { status, message };
}

export interface WorkItem {
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly priority: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export function workItem(
  value: Pick<WorkItem, "key" | "title" | "url"> & Partial<WorkItem>,
): WorkItem {
  return { description: "", priority: 100, metadata: {}, ...value };
}
export interface Activity {
  readonly stream: string;
  readonly cursor: number;
  readonly kind: string;
  readonly author: string;
  readonly url: string;
  readonly ref?: string;
  readonly thread?: string;
  readonly directed?: boolean | null;
}
export interface WaitCondition {
  readonly name: string;
  readonly url: string;
  readonly since?: number;
  readonly ref?: string;
}
export interface TaskObservation {
  readonly activities: readonly Activity[];
  readonly waits: readonly WaitCondition[];
}
export function observation(
  activities: readonly Activity[] = [],
  waits: readonly WaitCondition[] = [],
): TaskObservation {
  return { activities, waits };
}

// Persisted records use snake_case keys and Unix-second timestamps.
export interface TurnRecord {
  readonly version?: number;
  readonly sequence?: number;
  readonly prompt?: string;
  readonly pid?: number;
  readonly started_at?: number;
  readonly resumed?: boolean;
  readonly runtime?: string;
}
export interface CompletionRecord {
  readonly version?: number;
  readonly sequence?: number;
  readonly exit_code?: number | null;
  readonly finished_at?: number;
  readonly total_cost_usd?: number | null;
  readonly last_turn_cost_usd?: number | null;
  readonly usage?: unknown;
  readonly num_turns?: number | null;
  readonly is_error?: boolean | null;
  readonly api_error_status?: unknown;
}
export type TaskState =
  | "CLAIMED"
  | "RUNNING"
  | "STOPPING"
  | "IDLE"
  | "WAITING"
  | "FAILED"
  | "STOPPED"
  | "GAVE_UP";
export interface RunSnapshot {
  readonly key: string;
  readonly directory: string;
  readonly state: TaskState;
  readonly alive: boolean;
  readonly turn: TurnRecord;
  readonly status: CompletionRecord | null;
  readonly waits: readonly WaitCondition[];
  readonly silentFor: number;
  readonly stoppingAt: number;
  readonly restarts: number;
  readonly lastRestartAt: number;
}
export interface StartResult {
  readonly ok: boolean;
  readonly detail?: string;
}
export interface TickReport {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly actions: readonly string[];
  readonly snapshots: Readonly<Record<string, RunSnapshot>>;
  readonly health: Readonly<Record<string, HealthReport>>;
  readonly degradedSources: readonly string[];
  readonly dryRun: boolean;
}
