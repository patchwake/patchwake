# Specification: describe Patchwake as a blueprint for agent supervisors

Task: [TRELLO-zfkoSooJ](https://trello.com/c/zfkoSooJ/3-rephrase-patchwake-description-as-a-blueprint-to-build-agent-supervisors-to-implement-custom-workflows)

Status: Awaiting plan approval.

## Problem

The README introduces Patchwake with “Put your coding agents to work. Keep
them moving.” The GitHub Pages hero uses similar language and describes building
custom workflows around agents. Neither introduction explicitly presents
Patchwake as a blueprint for building agent supervisors, as requested by this
task. Readers should immediately understand what they build with Patchwake and
how that supervisor relates to their agents and workflow.

## Intended behavior and proposed wording

Use this shared positioning in the README and GitHub Pages introduction:

> Patchwake is a blueprint for building agent supervisors that implement your
> custom workflows.

Proposed headline:

> A blueprint for building agent supervisors.

Explain the term in the surrounding copy: users compose an engine, adapters,
and task instructions into a supervisor that starts and resumes existing agents
according to their workflow. The agents perform the tasks; the supervisor
coordinates their lifecycle. Keep the concrete Trello + GitHub starter and
Claude Code/Codex CLI examples as evidence of how to apply the blueprint.

“Blueprint” describes a reusable starting point backed by an actual engine,
editable starter, and extension contracts. It must not imply that Patchwake is
only a design document or that every mentioned integration is bundled.

The page title and description metadata should communicate the same positioning.
Supporting introductory text may be adjusted for clarity and consistency while
retaining accurate descriptions of deterministic coordination, resumable
sessions, local execution, and customizable adapters and instructions.

## Scope

- `README.md`: lead headline, introductory paragraphs, and directly related
  explanatory prose in “How it works” if needed for a consistent definition.
- `site/index.html`: document title and description metadata, hero headline and
  introductory copy, plus supporting prose in the run introduction, moving-parts
  introduction, and closing call to action where needed to reinforce the same
  message.
- This task's `SPEC.md` and `PLAN.md` record the proposal and review gate.

Interpret “gh page” as the existing GitHub Pages landing page under `site/`,
published at <https://patchwake.github.io/patchwake/>. The repository's About
description and npm package metadata are outside this proposed scope.

## Non-goals

- No changes to engine code, adapters, task templates, lifecycle rules, approval
  behavior, integrations, dependencies, or package metadata.
- No redesign, new assets, CSS or JavaScript behavior changes, or new features.
- No changes to setup commands, example prompts, release-availability notices,
  scheduling instructions, licensing, or existing navigation destinations.
- No manual deployment, package release, or automatic merge. Existing Pages
  automation remains responsible for publication after a human merge.

## Acceptance criteria

1. The README introduction and landing-page hero explicitly describe Patchwake
   as a blueprint for building agent supervisors for custom workflows.
2. Readers can distinguish the supervisor's coordination role from the agent's
   task execution role without prior familiarity with Patchwake terminology.
3. The HTML title and meta description agree with the visible positioning.
4. Copy remains consistent with the current engine, generated workflow project,
   bundled integrations, and custom-adapter requirements. It makes no new
   capability, compatibility, or performance promises.
5. Existing links, commands, prompts, accessibility attributes, carousel, video,
   tabs, and responsive layout remain functional. The longer headline wraps
   legibly at narrow and wide viewport sizes.
6. The implementation diff is limited to the approved copy and these planning
   documents. Repository validation is run and its actual outcome recorded.

## Constraints

- Work in `patchwake/patchwake` on `agent-TRELLO-zfkoSooJ` and reuse the task PR.
- Before plan approval, change only this specification and its companion plan.
- Follow the existing source architecture and the inspected
  `skills/build-orchestrator/SKILL.md`; this task does not alter a workflow.
- Keep `.env`, `var/`, credentials, generated outputs, and local session state
  out of commits. Do not edit `node_modules`.
- Use local fixtures for validation; never run real orchestrator ticks as tests.
- Human plan approval and human merging are separate gates.

## Open questions and approval assumptions

No technical blocker was found during source inspection. The proposed scope
interprets “gh page” as GitHub Pages, not repository About metadata. The reviewer
should request a planning revision if a different surface or positioning is
intended. Approval of the plan confirms this interpretation and the proposed
blueprint/supervisor message; editorial adjustments within that message are
allowed during implementation.
