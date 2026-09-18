# Implementation plan: Cleanup the README

Task: [TRELLO-Y7EbkAzX](https://trello.com/c/Y7EbkAzX/2-cleanup-the-readme)
Specification: [SPEC.md](SPEC.md)

## Approval and prerequisite

This is a proposal, awaiting human plan approval. Only this plan and SPEC.md
are changed in the initial draft PR. Resolve the specification's incoming-link
question in the PR before implementation. If the human requests link migration,
revise both documents as needed and request fresh approval of that scope.

On resumption, read the task instructions and live assignment, check whether
the PR was merged or closed, then verify a new top-level human comment mentioning
`@patchwa` and approving the latest published plan. Verify the author's repository
write/maintain/admin permission, publication order, and subsequent feedback.
Record the approval URL in the same PR. Move the card to Doing before editing.

## Implementation steps

1. Re-read root `README.md` at the current branch head and confirm the retained
   introduction, Distribution and releases, and License sections.
2. Preserve the introductory copy and make its existing website call to action
   explicitly direct readers to getting started, documentation, examples, and
   further information. Keep the website as the primary general documentation
   destination.
3. Delete the standalone video and all intervening sections before Distribution
   and releases. Preserve the contents of Distribution and releases and License,
   including their supporting links and command example. Avoid unrelated edits.
4. Inspect the Markdown structure and retained links. Confirm the final README
   has only the two requested second-level sections, no orphaned internal anchors,
   and no accidental loss of retained distribution or license information.
5. Run the validation below, review the complete diff, commit the approved
   implementation, and push to the existing branch/PR. Update its description
   with the approval URL, changes, validation, and any agreed link follow-up.
   Mark it ready for human review and move the card to Review. Never merge it.

## Expected files

- `README.md`: the only proposed implementation file.
- `docs/tasks/TRELLO-Y7EbkAzX/SPEC.md` and `PLAN.md`: planning documents published
  before implementation; leave unchanged after approval unless returning to
  the approval gate.

No new tests, workflow edits, generated artifacts, or configuration changes are
needed for this Markdown cleanup.

## Validation strategy

- Review the rendered Markdown or equivalent structure inspection, heading list,
  links, and final diff against the specification. Compare the retained
  distribution/license text with its pre-change version.
- Verify the website URL responds successfully and retained repository links
  exist. Recheck the known incoming links and record the human's resolution;
  do not claim a repository-wide link check passes while those links are stale.
- Install locked dependencies with `npm ci` if needed, then run the repository's
  `npm run check`: build, typecheck, format check, fixture tests, and packaging
  validation. This includes the required `npm run build`, `npm run typecheck`,
  and `npm test`. Run `node --check site/app.js` as in CI.
- Use existing fixture tests only. Never run `npm start`, real ticks, authenticated
  agent runs, package publication, or website deployment as validation.
- Check `git diff --check` and the staged file list. Do not commit `.env`, `var/`,
  build outputs, package tarballs, or dependency changes.

## Risks and mitigation

- Removing README sections invalidates known incoming links from the website
  and first-task guide. Human resolution is a prerequisite, as described in
  SPEC.md; any expanded implementation scope needs revised plan approval.
- Readers rely more heavily on the website. Keep the website link prominent and
  preserve direct publishing and license references in the retained sections.
- Native `fs-ext` installation needs Python and a compiler. Report environment
  failures with exact check results; do not change dependencies to fix them.

## Migration and rollback

No runtime, data, or package migration is needed. Incoming-link migration is
not included unless explicitly resolved through an updated approved plan.
Revert the README implementation commit to restore the previous documentation
layout if needed. Retain planning history and leave merging to a human.
