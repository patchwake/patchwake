# Plan: describe Patchwake as a blueprint for agent supervisors

Task: [TRELLO-zfkoSooJ](https://trello.com/c/zfkoSooJ/3-rephrase-patchwake-description-as-a-blueprint-to-build-agent-supervisors-to-implement-custom-workflows)

Specification: [SPEC.md](SPEC.md)

Status: Awaiting plan approval. No implementation has been performed.

## Repository findings

- `README.md` contains the primary project description and source/setup guides.
- `site/index.html` contains the landing-page title, description metadata, hero,
  explanatory sections, and static onboarding content.
- `site/app.js` controls onboarding tabs and the example carousel. Its commands
  and prompts are outside this copy change and do not need modification.
- `site/README.md` documents local preview with `npm run site:dev` and the
  existing GitHub Pages publication path.
- `.github/workflows/deploy-pages.yml` publishes the four public site assets on
  relevant changes to `main`; no deployment configuration change is needed.
- `docs/architecture.md` already describes the supervisor role, and
  `docs/customizing.md` explains composition through adapters and task templates.
- There is no root `AGENTS.md` or separate contribution guide in this checkout.
  The README's contributor guidance and build-orchestrator skill were inspected.

## Approval gate

Publish only `docs/tasks/TRELLO-zfkoSooJ/SPEC.md` and this plan on
`agent-TRELLO-zfkoSooJ` in a draft PR targeting `main`. Move the Trello card to
Review and end the planning turn.

A human repository owner or collaborator with write, maintain, or admin
permission must post a new top-level PR comment mentioning the authenticated
bot and explicitly approving the plan. The PR description will provide the
actual bot login. Approval applies to the latest published spec and plan; no
commit SHA or version reference is needed.

Before implementation on a later turn, check whether the PR has already been
merged or closed, then verify the approval comment, author permissions,
publication order, and subsequent feedback at GitHub. Move the assigned card
back to Doing only when authorized work begins. Any revision to either planning
document requires fresh approval before implementation continues.

## Implementation steps after approval

1. Update the README headline and introduction with the approved blueprint and
   supervisor positioning. Explain that users build a supervisor for their own
   workflow by composing Patchwake's engine, adapters, and task instructions.
   Retain the concrete start/resume example and website link. Align the short
   “How it works” explanation only if needed.
2. Update `site/index.html` title, description metadata, hero headline, and hero
   explanation to express the same message. Adjust supporting prose in the run
   introduction, moving-parts introduction, and closing call to action only
   where it improves consistency. Keep the existing markup structure, classes,
   IDs, accessibility attributes, links, commands, and prompts; adjust headline
   line breaks or span placement within its existing markup if needed.
3. Read the two surfaces together to verify consistent terminology and factual
   claims. Check that “blueprint” still conveys a working engine and editable
   starting project, and that custom integrations remain clearly identified.
4. Validate the text, local preview, and repository checks below. Review the
   final diff, commit and push only the approved changes to the existing PR,
   record validation and the approval-comment URL in its description, mark it
   ready for review, and return the card to Review. Leave merging to a human.

## Expected files

| File | Expected change |
| --- | --- |
| `README.md` | Project positioning and brief supervisor explanation |
| `site/index.html` | Matching page metadata, hero, and supporting copy |
| `docs/tasks/TRELLO-zfkoSooJ/SPEC.md` | Proposal published before implementation |
| `docs/tasks/TRELLO-zfkoSooJ/PLAN.md` | This implementation and validation plan |

No other files are expected to change. A need for a redesign, runtime change,
or broader messaging surface requires a planning revision and fresh approval.

## Validation strategy

- Planning phase: inspect the documents and `git diff --check`; verify that only
  the two planning documents are staged. Application checks can wait until
  implementation because this turn changes no executable or landing-page files.
- Implementation phase: install pinned dependencies with `npm ci` if needed,
  then run `npm run check`. This includes the required `npm run build`,
  `npm run typecheck`, `npm run format:check`, `npm test`, and packaging checks.
  Also run `node --check site/app.js`, matching repository CI.
- Use the existing fixture tests. Add no tests that merely assert the wording,
  and run no real provider ticks or agent workers as part of validation.
- Preview with `npm run site:dev` at the documented `/patchwake/` path. Inspect
  narrow (approximately 375 px) and wide (approximately 1440 px) layouts for
  headline wrapping, overflow, readability, and calls to action. Spot-check
  navigation, tabs, carousel, and the default view without JavaScript; preserve
  existing accessibility behavior. Stop the preview when inspection is complete.
- Review Markdown, verify existing links and command blocks are preserved, and
  run `git diff --check`. Report check failures accurately; do not expand this
  copy task to fix unrelated baseline failures without renewed scope approval.

## Risks and mitigations

- “Supervisor” may be unfamiliar: explain it immediately through starting and
  resuming agents and coordinating custom workflows.
- “Blueprint” may sound like documentation alone: mention the reusable engine,
  editable project, and concrete starter without promising new integrations.
- The longer headline may wrap poorly: inspect both viewport sizes and adjust
  copy or existing line breaks within this scope. Request approval before any
  layout redesign becomes necessary.
- Similar language elsewhere may invite scope expansion: focus on the requested
  README and GitHub Pages description; preserve package metadata and other docs.

## Migration and rollback

No data, configuration, dependency, or API migration is required. A human merge
will use the existing Pages deployment workflow. To roll back, revert the
implementation copy commit through normal review; the existing workflow will
republish the previous site content after that revert is merged. Keep planning
history and local task/session state intact.
