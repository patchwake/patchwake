# Specification: Cleanup the README

Task: [TRELLO-Y7EbkAzX](https://trello.com/c/Y7EbkAzX/2-cleanup-the-readme)

## Problem

The root README mixes the product introduction with lengthy onboarding,
scheduling, architecture, and contribution instructions. The requested cleanup
keeps the introduction, Distribution and releases, and License, and makes the
website the primary destination for other documentation.

## Intended behavior

The root `README.md` presents the existing Patchwake title, license link,
tagline, and introductory explanation, followed by a clear link to
<https://patchwake.github.io/patchwake/> for getting started, documentation,
examples, and further information. Its only second-level sections are
`Distribution and releases` and `License`, in their existing order.

Keep the distribution and license content, including package descriptions,
CLI state-location behavior, the status command example, publishing guidance,
and attribution requirements. Keep the direct publishing-guide and LICENSE
links where they support these retained sections.

Remove the standalone video section and all sections from `Start your own
workflow` through `Extend the engine or add a source example`. Do not replace
these sections with another documentation index or embedded tutorial.

## Scope and non-goals

Implementation scope is the root `README.md`. The task's SPEC.md and PLAN.md
record the agreed work. Existing documentation, other READMEs, website files,
workflow templates, engine code, dependencies, configuration, and tests remain
outside the proposed implementation scope. This task does not change releases,
runtime behavior, package availability claims, or licensing terms, and does not
publish packages or deploy the website.

## Acceptance criteria

- The title, introductory product explanation, and prominent website link remain.
- The only second-level headings are `Distribution and releases` and `License`.
- The standalone video, onboarding, scheduler, customization, architecture,
  repository-tour, source-install, and extension sections are removed.
- Distribution and license content retain their current meaning and examples.
- Retained README links resolve, with no internal links to removed headings.
- The implementation diff is limited to the approved scope and contains no
  credentials, `.env`, runtime state, generated files, or dependency changes.
- Required repository checks pass, or an existing/environmental failure is
  documented for human review without expanding this task's scope.
- The inbound-link question below is resolved by a human in the PR before
  implementation; a scope change requires updated documents and fresh approval.

## Constraints

Use branch `agent-TRELLO-Y7EbkAzX` in `patchwake/patchwake` and one draft PR.
Publish this specification and the implementation plan before changing the
README. Implementation requires a new top-level human PR comment mentioning
`@patchwa` and explicitly approving the latest plan. No commit reference is
required. Use fixtures for validation; never run real orchestrator ticks.
Never merge automatically.

## Open question: incoming links to removed sections

Repository inspection found links to `#try-it-from-source` in
`site/index.html` and `docs/first-task.md`, and a relative link to
`../README.md#schedule-on-a-persistent-host` in `docs/first-task.md` (that guide
is also copied into generated projects, where the relative target differs).
Removing the source README sections makes their source-repository targets
obsolete. The website currently responds successfully, but some onboarding
paths from it would still lead to the removed README source instructions.

The proposed scope remains README-only. A human must confirm in the PR whether
handling these incoming links in a separate follow-up is acceptable, or whether
this task should include a narrowly scoped documentation/link migration. The
latter requires revising this specification and plan and obtaining fresh plan
approval before implementation. Do not silently leave this question unresolved
or expand into a website/documentation rewrite.
