import type { CompletionRecord, TaskState, TurnRecord } from "./models.js";

export const CLAIMED = "CLAIMED",
  RUNNING = "RUNNING",
  STOPPING = "STOPPING",
  IDLE = "IDLE";
export const WAITING = "WAITING",
  FAILED = "FAILED",
  STOPPED = "STOPPED",
  GAVE_UP = "GAVE_UP";

export function deriveState(value: {
  alive: boolean;
  stopping: boolean;
  gaveUp: boolean;
  turn: TurnRecord;
  status: CompletionRecord | null;
  waits: boolean;
  starting?: boolean;
}): TaskState {
  const {
    alive,
    stopping,
    gaveUp,
    turn,
    status,
    waits,
    starting = false,
  } = value;
  if (alive) return stopping ? STOPPING : RUNNING;
  if (gaveUp) return GAVE_UP;
  if (stopping) return STOPPED;
  if (Object.keys(turn).length === 0) return CLAIMED;
  if (status === null || status.sequence !== turn.sequence)
    return starting ? RUNNING : FAILED;
  if (status.exit_code !== 0 || status.is_error) return FAILED;
  return waits ? WAITING : IDLE;
}
