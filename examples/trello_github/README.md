# Trello + GitHub example

This composition uses Trello list membership as the assignment plate and
observes GitHub pull requests belonging to each task. It never writes through
either observer; the agent itself is responsible for task and PR mutations.

Conventions:

- task key: `TRELLO-<shortLink>`;
- repository: a Trello label named `repo:<owner>/<repo>`;
- priority: an optional numeric label `priority:<number>` (lower runs first);
- branch: `agent-TRELLO-<shortLink>` in the same GitHub repository;
- wake: formal reviews and inline review comments always count; top-level PR
  comments must mention `GITHUB_BOT_LOGIN` when directed wakeups are enabled.

Configure the values in the root `.env.example` through the process environment,
then run `python -m examples.trello_github.orchestrator --dry-run` from the
repository root.

Choose the agent CLI with `ORCHESTRA_AGENT_ENGINE=claude` or
`ORCHESTRA_AGENT_ENGINE=codex`. Claude uses its configured permission mode.
Codex uses `codex exec --json --sandbox workspace-write` with outbound network
access and a `never` approval policy by default. Operations outside the sandbox
fail instead of waiting for an unattended approval. Do not enable
`ORCHESTRA_CODEX_DANGEROUS_BYPASS` unless the whole runner is independently
sandboxed.
