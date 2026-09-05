# Architecture

Orchestra is a supervisor, not an agent framework. It repeatedly decides which
existing task session deserves one more unattended turn.

## Tick flow

```text
                 normalized, read-only observations
  Board   ActivitySource(s) -------------------------------+
    |             |                                        |
    +-------> Engine policy <------ FileStateStore          |
                  |                    |                    |
                  +------ AgentRuntime +                    |
                  |                                         |
                  +------ TickReport ------> Channel(s) <---+
```

One scheduler invocation performs a finite tick and exits. The work directory
and lock files are the durable truth, so a host restart does not require a
daemon database to reconstruct the fleet.

## Ownership boundaries

| Component | Owns | Does not own |
|---|---|---|
| `Board` | The current assignment set and board normalization | Processes, disk state, code-host events |
| `ActivitySource` | Reading a remote feed and emitting pointers with cursors | Deciding whether or when to run an agent |
| `FileStateStore` | Claims, sessions, turns, status, cursors, wait snapshots | Remote APIs or scheduling priority |
| `AgentRuntime` | Starting, resuming, and stopping one turn | Assignment or activity policy |
| `Engine` | Ordering phases, filtering activity, choosing contenders | Provider transports and task instructions |
| `Channel` | Reporting an already completed tick | Any mutation that affects fleet behavior |

`HealthChangeChannel` is provider-neutral health reporting: it diffs each
component's latest real-work status against the previous tick and emits only
status changes (plus message changes while unhealthy). Supply a Slack, Teams,
email, or logging callable as its text sink.

## Lifecycle

```text
CLAIMED -> RUNNING -> IDLE
                 \-> WAITING
                 \-> FAILED -> RUNNING (bounded retry)
                               \-> GAVE_UP

Any assigned state -> STOPPING -> STOPPED when the board drops the task.
```

The state is derived from lock ownership plus `turn.json` and `status.json`.
A PID alone is never trusted because operating systems reuse PIDs. The worker
holds `.orchestra/turn.lock` for its full lifetime.

## Durable per-task contract

Each claim lives in `var/work/<task-key>/` and contains a `.orchestra/`
directory:

| File | Meaning |
|---|---|
| `task.json` | Normalized task metadata at claim time |
| `sessions/<runtime>.id` | Conversation id owned by one agent runtime |
| `sessions/<runtime>.ready` | Runtime-specific proof that the id may resume |
| `turn.json` | Current/last turn sequence, prompt, PID, and start time |
| `status.json` | Atomic completion record written by the worker |
| `seen.json` | Per-stream activity high-water marks |
| `waits.json` | Last complete wait-condition observation |
| `restarts.json` | Crash retry count and last attempt time |
| `turn.lock` | Process-liveness truth |
| `agent.log` | Append-only agent stream and stall heartbeat |
| `spawn.log` | Detached wrapper output |

Session state is namespaced by runtime. Claude pre-assigns a UUID and later
resumes it; Codex captures the `thread_id` from its first JSONL event and resumes
that thread on later turns. A deployment can change runtime without passing one
CLI's opaque session id to another.

The directory's existence is the claim. Creation happens in a staging
directory followed by an atomic rename, so overlapping schedulers cannot both
claim the same task. A separate tick lock prevents overlapping normal runs.

## Failure boundaries

- Board success with zero items means “stand everything down.” Board failure
  means “assignment unknown” and preserves every claim.
- One activity source failure is local. It cannot stand work down and it freezes
  wait presentation at the last complete observation.
- Activity cursors and retry ledgers advance only after a turn process starts.
- Notification channels execute after every process-affecting phase. A broken
  channel can make reporting stale, never make the fleet behave differently.
- Comment bodies should be reduced to a `directed` boolean at ingest. Prompts
  carry links and mechanical facts so the remote venue remains authoritative.
