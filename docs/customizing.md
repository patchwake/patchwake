# Build a custom orchestrator

Most custom workflows need three adapters and one composition module. Read
`patchwake/ports.ts` alongside the working `examples/trello_github/` example.
Ports accept synchronous results or promises; use `async` methods for network
transports and call `await engine.tick()` in the composition.

## 1. Define the plate

Implement `Board.fetch()` to return the tasks currently owned by the agent.
Choose a stable `WorkItem.key` containing only letters, digits, dots,
underscores, and hyphens. The key becomes a directory name, branch convention,
and durable identity; never derive it from a mutable title.

A normal empty response must return `[]`. Authentication, configuration, and
transport failures must throw. That difference prevents an outage from looking
like mass unassignment.

## 2. Normalize wake signals

Implement one `ActivitySource` per remote system. Every `Activity.stream` must
identify exactly one monotonically increasing feed, and its numeric `cursor`
must never move backward. Include the author and a URL, but not raw comment
content. If the source can decide whether a comment addresses the bot, set
`directed`; otherwise leave it as `null`, which fails open to a wake.

Use a stable code-host convention to associate reviews with tasks. The example
uses branch `agent-<task-key>` and a Trello label `repo:<owner>/<repo>`.

## 3. Choose the runtime

Two runtimes are ready to use:

- `ClaudeCodeRuntime` pins a UUID before the first `claude -p` turn and resumes
  that conversation later.
- `CodexCliRuntime` runs non-interactively with `codex exec --json`, captures
  the emitted thread id, and uses `codex exec resume` for later turns. Its safe
  default is `--sandbox workspace-write`; bypass mode requires an explicit,
  conspicuous opt-in intended only for an externally isolated runner.

The Codex runtime enables outbound network inside `workspace-write` because a
task agent must clone and communicate with its configured board/code host. It
sets approval policy to `never`, so an operation outside that boundary fails
instead of stranding an unattended turn on a prompt. Override either setting
deliberately for a different deployment boundary.

These flags follow OpenAI's [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
and [developer command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
Re-check both the current documentation and the installed `codex exec --help`
before changing CLI argument construction.

Both run detached, append JSONL to the task log, and write completion status
atomically. Pass credentials into agent turns only through the runtime config's
`passthroughEnv`; observer credentials are not implicitly exposed. Codex can
also use authentication already stored under its home directory.

Select either stock runtime in composition, as the Trello/GitHub example does
with `PATCHWAKE_AGENT_ENGINE`. Implement `AgentRuntime` when another CLI or
hosted agent needs different session and liveness mechanics. The runtime owns
its session namespace and must return success only when the turn was actually
created; `isAlive()` must not rely only on a stale PID.

## 4. Compose, do not subclass

Create a small executable module that constructs the store, board, sources,
runtime, channels, and an `EngineConfig` object, then calls `await engine.tick()`. Provider
configuration belongs in that module or its adapters. Board-specific workflow
rules belong in `templates/task/`, where every turn can see them.

Place `HealthChangeChannel` last so it can include the actual outcome of earlier
notification channels. Its sink is the narrow seam for Slack, Teams, email, or
another operator-health destination.

Run the composition once per scheduler interval. Do not put a sleep loop inside
an adapter: short, reconstructable ticks are what make recovery simple.

## 5. Verify invariants

Use fakes to prove at least these behaviors before enabling real writes:

1. A new assigned task is claimed and gets exactly one first turn.
2. A repeated tick with no activity starts nothing.
3. New external activity resumes the same session.
4. Self-authored and undirected comments do not wake under the configured policy.
5. A failed spawn does not consume the activity cursor.
6. A board outage does not stand down or create work.
7. A successful empty board response does stand claims down.
8. The concurrency cap and priority order choose deterministically.
9. Channel failures do not change process or cursor decisions.

Start with `--dry-run`, inspect the task directories and report, then run a
single real task before scheduling recurring ticks.

## TypeScript composition shape

```ts
import { Engine, FileStateStore, ClaudeCodeRuntime, ConsoleChannel,
  health, OK, workItem } from "patchwake";
import type { Board } from "patchwake";

const board: Board = {
  name: "example-board",
  async fetch() {
    // Replace this fixture with an authoritative read of the assignment set.
    return [workItem({ key: "TASK-1", title: "Example", url: "https://board.test/1" })];
  },
  health() { return health(OK, "fixture loaded"); },
};
const store = new FileStateStore("./var", "./templates/task");
const engine = new Engine({
  board,
  activitySources: [],
  runtime: new ClaudeCodeRuntime(store, { passthroughEnv: ["GITHUB_TOKEN"] }),
  channels: [new ConsoleChannel()],
  store,
  config: { maxConcurrentTurns: 3 },
});
await engine.tick({ dryRun: true });
```

Compile before scheduling.
