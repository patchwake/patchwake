# Patchwake

[MIT licensed](LICENSE)

**Put your coding agents to work. Keep them moving.**

Build custom workflows around the coding agents you already use. Patchwake
connects your boards, repositories, and communication tools to keep work flowing.

Let Claude Code or Codex CLI pick up a task, open a pull request, and return to
the same session when a reviewer requests changes or CI fails. You define the
workflow; Patchwake handles when to start, when to resume, and where to send
updates.

[Visit the website](https://patchwake.github.io/patchwake/) to explore Patchwake and get started with your own workflow.

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
- Keep cards in Ready through planning, implementation, and review.
- Report health changes to the console. Never merge automatically.
- Run at most one agent turn at once; check for work every five minutes.

Adapt workflow/orchestrator.ts and workflow/adapters.ts. Preserve --dry-run
and --status. Reuse the Trello/GitHub starter and the included console channel.
Keep workflow rules in templates/task/. Document board setup, list IDs versus
names, repository labels, the agent identity, and the credential allowlist.
Add fixture tests, a first-task walkthrough, and five-minute scheduler
instructions with absolute paths, PATH, .env loading, and log inspection.
```

## Launch your first task

Follow [Your first Trello + GitHub task](docs/first-task.md) to configure your
board, Trello key and token, list IDs, repository labels, and agent GitHub
identity. Install and authenticate your chosen agent CLI, then add one small
card to Ready. In the generated project:

```bash
npm run build        # repeat after editing the TypeScript workflow
npm run typecheck
npm test             # local fixtures, no external services
npm run dry-run      # inspect component health and confirm card detection
npm start            # run one real tick
npm run status       # inspect local tasks
```

These generated scripts load `.env`. The bundled starter requires Trello **list
IDs**, not the name `Ready`; automatic name lookup is a customization. Dry runs
do not claim tasks or start agents, but do write a local tick lock. Inspect
component health; a successful exit alone does not prove provider access.

With this basic setup, keep the card in a configured list through implementation
and review. For cards that move between stages, use the
[list-lifecycle recipe](docs/first-task.md#optional-move-cards-as-work-progresses).
`npm start` runs one tick; `npm run status` only reads local state. New feedback
needs another tick to resume the session.

## Schedule on a persistent host

After the first task works, install the five-minute cron entry from your
workflow's README. It must use absolute executable and project paths, load
`.env`, and put the agent CLI and other required tools on `PATH`. Check
`crontab -l` and follow `scheduler.log` to verify it runs.
See the [complete scheduler walkthrough](packages/create-patchwake/project-README.md#schedule-on-a-persistent-host).

Keep the host awake: agent turns continue between ticks and state remains under
your project's `var/` directory. A review or plan approval resumes work on a
later tick, not immediately when the comment is posted.

## Make the workflow yours

For example, have the agent propose its approach before implementing:

```text
Ready → Doing: spec + plan → Review: draft PR and human approval
                                  ↓
             Doing: implementation → Review: code review / CI
                                               ↓
                                  Human merge → Done
```

The [plan-approval recipe](docs/first-task.md#optional-review-a-plan-before-coding)
asks your coding agent to add task instructions, verify a new `@bot approve plan`
comment against the latest published documents, and preserve comment wakeups.
Humans do not need to supply a commit SHA. Combine it with the
[list-lifecycle recipe](docs/first-task.md#optional-move-cards-as-work-progresses)
to admit new tasks from Ready and retain claimed tasks in Doing and Review.
The agent moves the card to Done only after verifying a human merge. This is an optional
agent-followed convention, not a built-in engine approval gate. Use separate
GitHub identities for the agent and human reviewer so approvals are not filtered
out as self-authored activity.

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

## Extend the engine or add a source example

For your own workflow, edit `workflow/orchestrator.ts`, `workflow/adapters.ts`,
and `templates/task/` in the generated project. Import from `patchwake` or
`patchwake/<module>` and keep the engine dependency intact. Start with
[customization and upgrades](docs/customizing.md).

When contributing inside this source repository, read
[the build-orchestrator skill](skills/build-orchestrator/SKILL.md) and place new
compositions under `examples/<workflow-name>`. Implement the interfaces in
`patchwake/ports.ts`, assemble them with `Engine`, and keep provider policy in
adapters and task templates. Document configuration and scheduler commands;
validate assignment, wakeups, outages, retries, and resumption with fixtures
before live provider reads.

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

## License

Patchwake's engine, project generator, bundled starter code, task templates,
and documentation are licensed under the [MIT License](LICENSE).
You can use them in personal, commercial, and private projects; retain the
copyright and license notice when redistributing copies or substantial portions.
Third-party dependencies retain their own licenses.

Generated projects include `PATCHWAKE-LICENSE` for the copied starter material.
You can choose different terms for your own additions while preserving that notice.
