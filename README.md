# Patchwake

Patchwake is a small, provider-neutral foundation for supervising one long-lived
agent session per task. A scheduler runs a short **tick** repeatedly:

```text
board + activity sources -> observe -> decide -> act -> notification channels
                                      |
                                      `-> one resumable agent session per task
```

Boards, code hosts, agent runtimes, and notification destinations are
interchangeable ports. The repository includes Claude Code and Codex CLI
runtimes plus a concrete Trello + GitHub example, but the idea is that all the
pieces can be replaced and extended.

## What the core gives you

- atomic task claiming into an isolated directory;
- a runtime-namespaced session id and append-only log per task;
- cursor-based activity wakeups with self-event and mention filtering;
- bounded concurrency, deterministic priority, crash backoff, and stall kills;
- conservative outage behavior: an unreadable board is unknown, never empty;
- notification channels that run last and cannot steer the fleet;
- file-backed state that makes each cron invocation disposable;
- a dry-run path and pure policy functions that are easy to test.

Patchwake is written in strict TypeScript and targets Node.js 22+ on Linux and
macOS. Network adapters use asynchronous interfaces and Node's built-in `fetch`.
The only runtime dependency is `fs-ext`, which supplies the operating-system
file locks used for process liveness and overlap protection.

## Repository tour

```text
patchwake/                    TypeScript models, ports, state, policy, engine
templates/task/               default per-task agent workspace
examples/trello_github/       a real composition using Trello and GitHub
skills/build-orchestrator/    instructions for agents extending this repo
tests/                        Node test runner tests and fake agent fixtures
docs/                         architecture and extension guide
```

## Try it

Install and build from the repository root:

```bash
npm ci
npm run build
npm test
```

`fs-ext` is a native addon. Installation requires the usual `node-gyp` build
prerequisites: Python and a C/C++ toolchain (Xcode Command Line Tools on macOS,
or a compiler and make on Linux). Python is used only when building this
dependency; Patchwake and its workers run in Node.js. Use an up-to-date npm
with recent Python versions. If an older npm reports missing `distutils`, use
`npm ci --python=/path/to/python3.11` or update npm.

The repository allows the pinned `fs-ext` build script for npm versions that
require an install-script allowlist. When installing Patchwake into a separate
application with that policy, run `npm approve-scripts fs-ext` and
`npm rebuild fs-ext` if npm reports the native build as pending.

Check all source and tests with `npm run typecheck` and `npm run format:check`.

Preview the Trello + GitHub composition after setting `.env.example` values
in your process environment:

```bash
npm start -- --dry-run
```

Select the agent implementation independently from the board and code host:

```bash
export PATCHWAKE_AGENT_ENGINE=codex  # or claude
```

Run one real tick:

```bash
npm start
```

Read local task status with `npm start -- --status`.

Schedule `node /absolute/path/to/patchwake/dist/examples/trello_github/orchestrator.js`
with cron or a systemd timer on a persistent host. Use an absolute Node executable
path and configure credentials in the scheduler environment.
`var/cache/tick.lock` prevents overlapping invocations. Persist `var/` on a local
filesystem with working `flock` semantics; detached turns need the same host to
remain running between ticks.

## Build your own workflow

Start with [docs/customizing.md](docs/customizing.md). In Codex, invoke the
repository skill. The following prompt can be copied and completed with the
providers and conventions for a new workflow:

```text
$build-orchestrator Build a custom workflow in this repository.

Workflow:
- Board and assignment query: <provider and how assigned work is selected>
- Activity sources: <systems and events that should wake an agent>
- Task-to-repository mapping: <label, field, naming convention, or lookup>
- Agent runtime: <Codex CLI, Claude Code, or another runtime>
- Health destination: <console, Slack, Teams, email, or another channel>
- Maximum concurrent turns: <number>
- Schedule: <cron, systemd timer, or another trigger>
- Agent credential allowlist: <environment variable names, or none>

Keep provider logic in adapters and reuse Patchwake's engine and file store.
Add the composition under examples/<workflow-name>, document configuration and
dry-run commands, and add tests for assignment, wakeups, outages, retries, and
session resumption. Before coding, summarize the design and ask only for
missing choices that would materially change external behavior.
```

For example, a user could start with:

```text
User: $build-orchestrator Create a Trello + GitHub workflow. Cards assigned to
the automation member in the "Ready" list are work. A `repo:owner/name` label
selects the repository. Wake the agent for new pull-request reviews, CI results,
and comments that mention `@my-agent`. Use Codex CLI, allow at most two turns,
report health to the console, and support a five-minute cron schedule. Only pass
GITHUB_TOKEN to agent turns.

Agent: I can implement this with a Trello Board adapter, a GitHub ActivitySource,
CodexCliRuntime, ConsoleChannel, and the stock FileStateStore. Two choices affect
behavior: should moving a card out of "Ready" stop an idle task, and should a
failed CI check wake the agent immediately?

User: Yes to both. Start with fixtures and a dry run; do not make remote writes
during validation.
```

The agent should then implement the adapters and composition, run the tests,
exercise a dry tick, and report the exact configuration, credential boundary,
and scheduler command it created.

The intended customization surface is composition, not inheritance: implement
the small interfaces in `patchwake/ports.ts`, choose or implement an
`AgentRuntime`, assemble everything with `Engine`, and keep provider-specific
policy in the adapter or task template that owns it.
