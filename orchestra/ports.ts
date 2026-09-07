import type {
  HealthReport,
  RunSnapshot,
  StartResult,
  TaskObservation,
  TickReport,
  WorkItem,
} from "./models.js";

/** Adapters may be synchronous fakes or asynchronous transports. */
export type Awaitable<T> = T | Promise<T>;
export interface HealthComponent {
  readonly name: string;
  health(): Awaitable<HealthReport>;
}
export interface Board extends HealthComponent {
  fetch(): Awaitable<readonly WorkItem[]>;
}
export interface ActivitySource extends HealthComponent {
  observe(
    items: readonly WorkItem[],
  ): Awaitable<Readonly<Record<string, TaskObservation>>>;
}
export interface AgentRuntime extends HealthComponent {
  isAlive(taskDir: string): Awaitable<boolean>;
  start(
    taskDir: string,
    prompt: string,
    resume: boolean,
    sequence: number,
  ): Awaitable<StartResult>;
  stop(snapshot: RunSnapshot, options?: { force?: boolean }): Awaitable<void>;
}
export interface Channel extends HealthComponent {
  publish(report: TickReport): Awaitable<void>;
}
