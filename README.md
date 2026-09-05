# Orchestra

Orchestra is a small, provider-neutral foundation for supervising one long-lived
agent session per task. A scheduler runs a short **tick** repeatedly:

```text
board + activity sources -> observe -> decide -> act -> notification channels
                                      |
                                      `-> one resumable agent session per task
```

It extracts the reusable mechanics from a production YouTrack + GitLab/GitHub +
Slack worker without carrying those product choices into the core. Boards, code
hosts, agent runtimes, and notification destinations are ports. The repository
includes Claude Code and Codex CLI runtimes plus a concrete Trello + GitHub
example.

## What the core gives you

- atomic task claiming into an isolated directory;
- a runtime-namespaced session id and append-only log per task;
- cursor-based activity wakeups with self-event and mention filtering;
- bounded concurrency, deterministic priority, crash backoff, and stall kills;
- conservative outage behavior: an unreadable board is unknown, never empty;
- notification channels that run last and cannot steer the fleet;
- file-backed state that makes each cron invocation disposable;
- a dry-run path and pure policy functions that are easy to test.

The core uses only the Python standard library and targets Python 3.10+.

## Repository tour

```text
orchestra/                    reusable models, ports, state, policy, engine
templates/task/               default per-task agent workspace
examples/trello_github/       a real composition using Trello and GitHub
skills/build-orchestrator/    instructions for agents extending this repo
tests/                        executable invariants for the foundation
docs/                         architecture and extension guide
```

## Try it

Run the tests without installing the package:

```bash
python -m pytest
```

Preview the Trello + GitHub composition after copying `.env.example` values
into your environment:

```bash
python -m examples.trello_github.orchestrator --dry-run
```

Select the agent implementation independently from the board and code host:

```bash
export ORCHESTRA_AGENT_ENGINE=codex  # or claude
```

Run one real tick:

```bash
python -m examples.trello_github.orchestrator
```

Schedule that command with cron, a systemd timer, GitHub Actions, or any other
single-run scheduler. `var/tick.lock` prevents overlapping invocations.

## Build your own workflow

Start with [docs/customizing.md](docs/customizing.md); the extraction boundary is
documented in [docs/extraction.md](docs/extraction.md). In Codex, invoke the
repository skill:

```text
$build-orchestrator Build an orchestrator that reads Linear issues, observes
GitHub pull requests, runs Claude Code, and reports health to Teams.
```

The intended customization surface is composition, not inheritance: implement
the small protocols in `orchestra/ports.py`, choose or implement an
`AgentRuntime`, assemble everything with `Engine`, and keep provider-specific
policy in the adapter or task template that owns it.
