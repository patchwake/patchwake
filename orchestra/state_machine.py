"""Pure derivation of a task agent's lifecycle state."""

from __future__ import annotations

CLAIMED = "CLAIMED"
RUNNING = "RUNNING"
STOPPING = "STOPPING"
IDLE = "IDLE"
WAITING = "WAITING"
FAILED = "FAILED"
STOPPED = "STOPPED"
GAVE_UP = "GAVE_UP"


def derive_state(
    *,
    alive: bool,
    stopping: bool,
    gave_up: bool,
    turn: dict,
    status: dict | None,
    waits: bool,
    starting: bool = False,
) -> str:
    if alive:
        return STOPPING if stopping else RUNNING
    if gave_up:
        return GAVE_UP
    if stopping:
        return STOPPED
    if not turn:
        return CLAIMED
    if status is None or status.get("sequence") != turn.get("sequence"):
        return RUNNING if starting else FAILED
    if status.get("exit_code") != 0 or status.get("is_error"):
        return FAILED
    return WAITING if waits else IDLE
