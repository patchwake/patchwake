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
Keep cards in Ready through planning, implementation, and review.
Never merge automatically. Run at most one agent turn at once.
Document board setup, list IDs versus names, repository labels, agent identity,
and the credential allowlist. Include a first-task walkthrough and five-minute
schedule with absolute paths, PATH, .env loading, and logs. Add fixture tests first.
```

The initial Trello + GitHub composition is ready to configure. Other boards,
code hosts, and reporting channels need custom adapters. See
[workflow conventions](workflow/README.md) and [customization](docs/customizing.md).
The engine's source contracts ship in `node_modules/patchwake/patchwake/`.

## Launch your first task

Follow [Your first Trello + GitHub task](docs/first-task.md) for list setup, board
and list IDs, Trello key versus token, and a separate GitHub identity for agent
work and human feedback. The bundled starter needs actual list IDs in
`TRELLO_READY_LIST_IDS`; entering `Ready` or leaving it blank does not select a
list by name. Name lookup is an optional adapter customization.

The basic setup keeps cards in Ready. To move cards through Ready → Doing →
Review → Done while preserving sessions, use the
[list-lifecycle recipe](docs/first-task.md#optional-move-cards-as-work-progresses).
It starts new tasks only from Ready and retains existing claims in Doing/Review.

For a spec → plan → draft PR → human approval → implementation flow, ask your
coding agent to apply the [plan-approval recipe](docs/first-task.md#optional-review-a-plan-before-coding)
before claiming tasks. Approval uses a new `@bot approve plan` comment without
a commit SHA. The rule lives in task instructions; the engine resumes
on comments but does not enforce approval.

### Configure and preview

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

Start with one small card in Ready, with a `repo:owner/name` label. Confirm it
is detected before the first real tick, then inspect its PR and local task logs.
Keep the card in a configured list during implementation and review so it can
resume. Moving it out removes the assignment on a later tick; it does not
immediately stop an active turn.

**`npm start` runs one tick.** `npm run status` reads local state without polling
providers. After a review or plan approval, run `npm start` again or let the
scheduler run the next tick.

## Schedule on a persistent host

Install a schedule after the first task works. Keep this project and its `var/`
directory on durable local storage with working `flock` semantics. Detached
turns must remain on the same running host between ticks. Keep your Mac or Linux
host awake; a sleeping or powered-off machine does not run ticks.

1. Find the absolute executable paths under the same OS user that will run cron:

   ```sh
   pwd
   command -v node
   command -v codex   # or claude
   command -v git
   command -v gh      # if your task instructions use GitHub CLI
   ```

2. Ask your coding agent to fill in the following example for this host. Replace
   every `/absolute/path/...` and `/srv/my-workflow` placeholder. Include the
   directories containing Node, your agent CLI, git, and gh on `PATH`. Cron does
   not load your interactive shell setup; Node installed through nvm needs its
   version-specific executable directory. Recheck these paths after CLI upgrades.

3. Run `crontab -e` and add this **single line**, preserving existing entries:

   ```cron
   */5 * * * * PATH=/absolute/path/to/node-bin:/absolute/path/to/agent-bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /absolute/path/to/node --env-file=/srv/my-workflow/.env /srv/my-workflow/dist/workflow/orchestrator.js --root /srv/my-workflow >> /srv/my-workflow/scheduler.log 2>&1
   ```

   This example assumes paths without spaces. If your paths contain spaces,
   have the agent provide a quoted entry or wrapper script for those exact paths.

4. Save, then confirm installation and inspect output after the next five-minute
   boundary (`:00`, `:05`, `:10`, and so on):

   ```sh
   crontab -l
   tail -f /srv/my-workflow/scheduler.log
   ```

   Replace the log path with your project path. Check for healthy observations
   and any missing-command or authentication errors. The file is created when
   cron first runs; a healthy empty board still has no work to launch.

The scheduled command loads `.env` explicitly, uses the same state root as your
manual runs, and writes both output streams to `scheduler.log`. Keep this local
log out of source control (add `scheduler.log` to your project's `.gitignore`).

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

## License of the starter

The copied Patchwake starter code, task templates, and documentation are MIT
licensed; see [PATCHWAKE-LICENSE](PATCHWAKE-LICENSE). Retain this notice when
redistributing copies or substantial portions of that material. You can choose
different terms for your own additions. Dependencies retain their own licenses.
