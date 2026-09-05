---
name: build-orchestrator
description: Build or adapt a task-driven agent orchestrator from the Orchestra repository. Use when composing a custom board, code-host activity source, agent runtime, notification channel, or unattended per-task workflow; do not use for ordinary application features unrelated to orchestration.
---

# Build an Orchestra workflow

Use the repository as a set of composable ports and tested lifecycle policy.
Prefer a thin composition plus new adapters over copying or specializing the
engine.

## Start from the live contracts

1. Read `docs/architecture.md` and `docs/customizing.md` in the repository.
2. Read `orchestra/ports.py`, `orchestra/models.py`, and the composition closest
   to the requested providers under `examples/`.
3. Read [references/contracts.md](references/contracts.md) when implementing or
   changing an adapter or runtime.
4. Read [references/validation.md](references/validation.md) before enabling
   side effects or declaring the workflow complete.

## Shape the workflow

Identify four independent choices: the board that defines assignment, the
sources that emit wake signals, the runtime that owns a stable session per task,
and reporting channels. Ask for a missing choice only when it changes external
behavior materially; otherwise use the stock file store, a stock CLI runtime,
console/audit channels, and explicit conventions documented in the new example.
Choose Claude Code or Codex CLI when requested; do not infer the agent engine
from the board or code host.

Keep provider authentication and normalization in adapters. Keep scheduling,
retries, concurrency, and cursor decisions in the core engine. Put business
workflow rules—board transitions, review gates, merge policy, repository
selection—in a task template or an application-level policy module rather than
making them universal.

## Implement narrowly

- Return stable `WorkItem` keys; never use mutable titles as identity.
- Emit pointer-only `Activity` values with fully qualified stream keys and
  monotonic cursors. Reduce comment text to `directed` at ingest and discard it.
- Treat a board exception as unknown and an empty result as authoritative.
- Expose health from the component instance that performed the real work.
- Pass secrets into agent turns only through an explicit allowlist.
- Keep session creation and resume semantics inside the runtime adapter. Use a
  distinct session namespace for each agent engine.
- Add the provider composition under `examples/<workflow>/` when it is an
  example, or in the user's application when it is a deployment.
- Change the core only when the requested behavior cannot be expressed through
  an existing port; accompany a core change with invariant-focused tests.

Use `examples/trello_github/` as a shape, not as policy to cargo-cult. Preserve
the user's provider conventions and authorization boundaries.

## Finish with evidence

Run the repository test suite and any adapter-specific tests. Exercise a dry
tick with representative provider fixtures or a safe read-only account. Report
which assignment query, task-to-repository convention, wake policy, credential
allowlist, concurrency cap, and scheduler command the workflow uses.
