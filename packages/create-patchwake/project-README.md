# My Patchwake workflow

This is your editable workflow project. The Patchwake engine is an npm dependency;
customize `workflow/`, `templates/task/`, and the environment without forking it.
Requires Node.js 22+ on Linux or macOS, Python, and a C/C++ build toolchain for
`fs-ext` (Xcode Command Line Tools on macOS; make and a compiler on Linux).

## Define your workflow

Open this directory in your coding agent and give it a prompt like:

```text
Read skills/build-orchestrator/SKILL.md and adapt workflow/orchestrator.ts:
Pick up Trello cards in Ready, use their repo:owner/name labels for GitHub,
run Codex CLI, resume on reviews or CI results, and report health to the console.
Never merge automatically. Run at most two agent turns concurrently.
Document credentials and a five-minute schedule. Add fixture tests first.
```

The initial Trello + GitHub composition is ready to configure. Other boards,
code hosts, and reporting channels need custom adapters. See
[workflow conventions](workflow/README.md) and [customization](docs/customizing.md).
The engine's source contracts ship in `node_modules/patchwake/patchwake/`.

## Configure and run

The generator installs dependencies and builds once unless `--no-install` was
used. In that case run `npm install` and `npm run build` first. If native compilation
fails, install the prerequisites above and retry. Use an up-to-date npm with
recent Python versions; older npm may report missing `distutils`. Update npm or
use Python 3.11 for that native build. With npm's install-script
approval policy, approve `fs-ext` using `npm approve-scripts fs-ext`, then run
`npm rebuild fs-ext` if its native build is pending.

Edit `.env` (created from `.env.example`) with your board, GitHub, and runtime
settings. Install and authenticate your chosen Claude Code or Codex CLI under
the same account that will run the scheduler. Review `PATCHWAKE_AGENT_ENV`:
only explicitly allowlisted variables reach agent turns. Keep `.env` private.
The npm run commands below load it; ordinary Node commands do not.

```sh
npm run build       # repeat after changing TypeScript
npm run typecheck
npm test            # local fixtures; no provider calls or agent turns
npm run dry-run     # real provider reads; no task claims or agent turns
npm start           # one real tick
npm run status      # inspect local tasks
```

Dry runs still write the local tick lock. Missing credentials
appear as component errors; a successful process exit alone does not establish
that observation succeeded. Inspect the report before running a real tick.

## Schedule on a persistent host

Keep this project and its `var/` directory on durable local storage with working
`flock` semantics. Detached turns must remain on the same running host between
ticks. Use the absolute Node executable path (`command -v node`) and absolute
project paths. For example, after building:

```cron
*/5 * * * * /absolute/path/to/node --env-file=/srv/my-workflow/.env /srv/my-workflow/dist/workflow/orchestrator.js >> /srv/my-workflow/scheduler.log 2>&1
```

The generated composition resolves state and templates relative to this project,
independently of the scheduler's working directory. `--root /path/to/workspace`
overrides `PATCHWAKE_ROOT`, which overrides the project default. Keep that path
consistent between run and status commands. Never put state under `node_modules`.
`var/cache/tick.lock` prevents overlapping ticks. Disabling the scheduler prevents
new ticks but does not stop already detached agent turns.

## Upgrade the engine

The generator pins Patchwake to an exact version. Commit `package-lock.json` and
use `npm ci` on the host. To adopt a reviewed release, run:

```sh
npm install --save-exact patchwake@<version>
npm test
npm run typecheck
npm run dry-run
```

Your workflow, task templates, and copied docs/skill remain yours; npm does not
replace them. Read the release notes and compare updated examples when upgrading.
Stop new ticks and let active turns finish before upgrading: detached workers
load code from the installed dependency. Keep `var/` intact. Do not rerun the
generator over this directory; it refuses nonempty destinations.
