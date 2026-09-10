# Patchwake

**Put your coding agents to work. Keep them moving.**

Build custom workflows around the coding agents you already use. Patchwake
connects your boards, repositories, and communication tools to keep work flowing.

Let Claude Code or Codex CLI pick up a task, open a pull request, and return to
the same session when a reviewer requests changes or CI fails. You define the
workflow; Patchwake handles when to start, when to resume, and where to send
updates.

[Visit the website](https://patchwake.github.io/patchwake/) to explore Patchwake and build a workflow prompt.

## Start your own workflow

Create an editable project with Patchwake installed as a pinned dependency:

```bash
npm create patchwake@latest my-workflow
cd my-workflow
```

**Release availability:** these npm commands require the first npm release.
Until it is published, use [the source checkout](#try-it-from-source). Maintainers
can follow [the release guide](docs/publishing.md) to bootstrap both packages.

Requires Node.js 22+ on Linux or macOS, Python, and a C/C++ toolchain for native
file locks. On macOS install Xcode Command Line Tools; on Linux install Python,
make, and a compiler. The generator installs dependencies and compiles the starter.
Use `-- --no-install` to generate files only, then run `npm install` and
`npm run build` yourself. It refuses to overwrite a nonempty directory.

Open **my-workflow** in your coding agent and describe your workflow:

```text
Read skills/build-orchestrator/SKILL.md and build my workflow:

- Pick up Trello cards in the "Ready" list.
- Use each card's repo:owner/name label to select its GitHub repository.
- Run Codex CLI to implement the task and open a pull request.
- Resume the same session when reviewers request changes or CI fails.
- Send health changes to Slack. Never merge automatically.
- Run at most two agent turns at once; check for work every five minutes.

Adapt workflow/orchestrator.ts and workflow/adapters.ts. Preserve --dry-run
and --status. Reuse the Trello/GitHub starter and add the Slack health adapter.
Document environment variables and the agent credential allowlist. Add fixture
tests and scheduler instructions. Keep workflow rules in templates/task/.
```

Edit the generated `.env` and install and authenticate your chosen agent CLI.
Then run in your workflow project:

```bash
npm run build        # repeat after editing the TypeScript workflow
npm test             # local fixtures, no external services
npm run dry-run      # read provider state and preview decisions
npm start            # run one real tick
npm run status       # inspect local tasks
```

These generated scripts load `.env`. Dry runs do not claim tasks or start agents,
but do write a local tick lock. Check component health in the report before
enabling real ticks. The generated README includes an absolute-path cron example.
Run it on a persistent host: agent turns continue between ticks and state remains
under your project's `var/` directory.

Your adapters, instructions, and configuration stay in your project. Upgrade the
engine with `npm install --save-exact patchwake@<version>` and commit the lockfile.
Stop new ticks and allow active turns to finish before upgrading; retain `var/`.
See [customization and upgrades](docs/customizing.md).

## How it works

A scheduler runs a short **tick** repeatedly:

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

## Try it from source

Use a clone when contributing to the engine or trying it before the npm release.

```bash
git clone https://github.com/patchwake/patchwake.git
cd patchwake
```

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
path, pass `--root /absolute/path/to/patchwake`, and configure credentials in the
scheduler environment (or use Node's `--env-file=/absolute/path/to/.env`).
`var/cache/tick.lock` prevents overlapping invocations. Persist `var/` on a local
filesystem with working `flock` semantics; detached turns need the same host to
remain running between ticks.

## Build your own workflow

In a generated project, edit `workflow/orchestrator.ts` and `workflow/adapters.ts`;
the local skill explains where to find installed contracts. Import from
`patchwake` or `patchwake/<module>` and keep the engine dependency intact.
The prompt below is for contributors working inside the source repository.


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

## Distribution and releases

- `patchwake`: compiled library, type declarations, source contracts, templates,
  docs, and the optional `patchwake-trello-github` executable.
- `create-patchwake`: a lightweight generator that copies an editable workflow
  and installs an exact matching Patchwake version.
- GitHub: source, examples, contributions, and release automation. Docker is not
  required for the local workflow.

Existing applications can run `npm install --save-exact patchwake` and import the
engine directly. The bundled CLI uses `--root`, then `PATCHWAKE_ROOT`, then the
current directory for state; it uses local `templates/task/` when present and
bundled task templates otherwise. It never defaults state to the package directory.
For example, in an application with Patchwake installed:

```sh
npm exec -- patchwake-trello-github --root /srv/my-workflow --status
```

See [publishing](docs/publishing.md) for package checks, npm bootstrap, trusted
publishing, and the release process. `npm run check` runs the full validation,
including installation and execution from actual npm tarballs.
