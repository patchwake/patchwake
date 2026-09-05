# Adapter and runtime contracts

Read this when adding or changing a `Board`, `ActivitySource`, `AgentRuntime`, or
`Channel`.

## Board

- `fetch()` returns the complete current plate, not a delta.
- Return an empty sequence only after a successful remote observation.
- Raise on missing credentials, invalid configuration, and remote failures.
- `WorkItem.key` is durable and safe as a directory segment.
- Put provider ids and routing hints in `metadata`; keep the shared model small.

## Activity source

- `observe(items)` is read-only and returns entries keyed by `WorkItem.key`.
- A stream key includes provider, repository/resource, object, and feed kind.
- A cursor is numeric, monotonic within its stream, and based on the event—not
  the local polling time.
- Do not place comment bodies, review text, or instructions in `Activity`.
- `directed=False` may suppress a wake. When direction cannot be established,
  use `None` so uncertainty fails open.
- Authentication or transport failure raises. Do not silently return an empty
  mapping, which would be indistinguishable from “nothing happened.”

## Runtime

- One task has one stable session id per runtime across its turns. Session ids
  are runtime-owned opaque values; never reuse one engine's id with another.
- `start()` writes intent before spawning, returns `ok=True` only after process
  creation, and never evaluates task data through a shell.
- The worker holds a lock for its entire life and writes completion atomically.
- Logs are append-only; their modification time is the stall heartbeat.
- A retry reuses the failed turn's sequence and prompt.
- Stop the process group, not only the immediate wrapper.

The stock Claude runtime can pre-pin its session UUID. The stock Codex runtime
must instead capture `thread.started.thread_id` from `codex exec --json` before
it can use `codex exec resume`. Keep the Codex sandbox explicit and default to
`workspace-write`; bypassing approvals and sandboxing is not a generic
unattended-mode setting.

When changing the Codex runtime, verify flags against the current official
Codex non-interactive documentation and the installed `codex exec --help` and
`codex exec resume --help`; this interface evolves independently from the core.

## Channel

- `publish()` receives a completed `TickReport` and returns no decisions.
- Catching a channel failure must not skip another channel.
- Channel writes are reporting-only. If a remote write can change assignment or
  wake behavior, model it outside the channel layer and make its policy explicit.
- Health reflects the publish attempt that actually happened; do not add a
  redundant probe just for health reporting.
