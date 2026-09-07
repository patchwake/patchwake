# Validation checklist

Read this after composing a workflow and before enabling recurring real ticks.

## Automated

- Run `npm ci`, `npm run build`, `npm run typecheck`, `npm run format:check`, and
  `npm test` from the repository root.
- Add fixture-driven tests for provider normalization and pagination.
- Test duplicate events, equal cursors, self-authored events, and missing
  `directed` values.
- Test missing/partial credentials as errors, not empty observations.
- Test a failed runtime start and prove `seen.json` did not advance.
- Test every supported agent engine's first-turn and resume command separately,
  including session-id capture for engines that allocate their own id.
- Test board outage separately from a successful empty assignment response.

## Safe rehearsal

- Run the composition with `--dry-run` against representative read access.
- Confirm task keys, priorities, repository routing, and branch convention.
- Confirm the agent environment contains only explicitly allowed credentials.
- Confirm no provider adapter writes during observation.
- Run one real low-risk task and verify the second quiet tick starts no turn.

## Operations

- Schedule one finite tick; rely on the repository tick lock for overlap.
- Use an absolute Node.js path and the built `dist/examples/trello_github/orchestrator.js` entry point under cron.
- Persist `var/` on durable local storage and exclude it from source control.
- Monitor both component health changes and tasks that reach `GAVE_UP`.
- Document how an operator stops, re-arms, or archives a claim before unattended
  deployment.
