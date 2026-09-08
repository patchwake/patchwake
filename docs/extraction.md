# What was extracted

The source worker combined a YouTrack assignment plate, GitLab and GitHub
observation, Slack health/status reporting, and Claude Code sessions. Patchwake
separates the mechanics that survived that production use from the policy that
belonged to one organization.

## Preserved in the foundation

- finite cron-style ticks with an overlap lock;
- one isolated directory and pinned conversation per task;
- atomic claim and completion records;
- lock-based liveness, append-only logs, and startup/stall race guards;
- normalized activity streams with per-stream high-water marks;
- self-authored activity filtering and optional directed-wake policy;
- pointer-only prompts that leave remote content authoritative;
- deterministic contention, bounded concurrency, retry backoff, and give-up;
- conservative degradation, especially unknown board assignment;
- notify-last channels and edge-triggered component health.

## Moved out of the core

- YouTrack fields, queries, dependency links, tags, and cost comments;
- GitLab/GitHub endpoint details and branch naming;
- Slack transport, thread formatting, and reviewer nudges;
- organization-specific repository selection and bot identity;
- spec/plan approval gates and merge policy;
- CLI-specific credential wiring beyond each stock runtime's explicit
  environment allowlist.

Those are still supported behaviors. They now belong in adapters, channels,
task templates, or composition-level policy, where a Trello, Linear, Jira, or
custom deployment can replace them without forking the scheduler.
