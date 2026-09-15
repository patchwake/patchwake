# Trello + GitHub example

This composition uses Trello list membership as the assignment plate and
observes GitHub pull requests belonging to each task. It never writes through
either observer; the agent itself is responsible for task and PR mutations.

Conventions:

- assignment: cards in `TRELLO_READY_LIST_IDS` (actual IDs, not list names);
- task key: `TRELLO-<shortLink>`;
- repository: a Trello label named `repo:<owner>/<repo>`;
- priority: an optional numeric label `priority:<number>` (lower runs first);
- branch: `agent-TRELLO-<shortLink>` in the same GitHub repository;
- wake: formal reviews and inline review comments always count; top-level PR
  comments must mention `GITHUB_BOT_LOGIN` when directed wakeups are enabled.

Follow [Your first task](https://github.com/patchwake/patchwake/blob/main/docs/first-task.md) for board setup, credentials,
the agent's GitHub identity, and a first run. In a generated project the same
guide is at `docs/first-task.md` from the project root. The bundled adapter does
not discover Ready by name; automatic lookup and plan approval are optional
customizations. Keep cards in the configured lists while they need agent work
or review feedback.

In a generated project, edit `.env` and run `npm run dry-run` after building.
The generated npm scripts load `.env`; the workflow files live under `workflow/`.
In a source checkout, configure `.env.example` values through the process
environment, then run `npm start -- --dry-run` from the repository root after
`npm ci` and `npm run build`.

The bundled CLI accepts `--root /absolute/path/to/workspace` or `PATCHWAKE_ROOT`;
otherwise it uses the current directory. State and reports live in `<root>/var`.
It uses `<root>/templates/task` when present, otherwise the installed templates.
The generated composition defaults to its own project directory. For either
entry point, use the same root when scheduling ticks and inspecting `--status`.

Choose the agent CLI with `PATCHWAKE_AGENT_ENGINE=claude` or
`PATCHWAKE_AGENT_ENGINE=codex`. Claude uses its configured permission mode.
Codex uses `codex exec --json --sandbox workspace-write` with outbound network
access and a `never` approval policy by default. Operations outside the sandbox
fail instead of waiting for an unattended approval. Do not enable
`PATCHWAKE_CODEX_DANGEROUS_BYPASS` unless the whole runner is independently
sandboxed.
