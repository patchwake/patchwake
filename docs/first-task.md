# Your first Trello + GitHub task

Start here after your coding agent has adapted and fixture-tested your workflow
project. These commands run from the generated project. For an engine source
checkout, use the [source setup commands](https://github.com/patchwake/patchwake#try-it-from-source).

The first milestone is one small card producing a PR. After that works, install
recurring ticks. The included starter uses explicit Trello list IDs. Ready-list
name lookup, movement between workflow lists, and plan approval are customizations your coding agent can add;
follow your workflow's README when its behavior differs from this guide.

## 1. Set up the board

Create one open list called **Ready**. **Backlog** and **Done** are optional for
your own organization. The starter selects cards by configured list membership,
not by member assignment or list name.

Add one small task to Ready, with clear acceptance criteria and exactly one
repository label such as `repo:your-org/your-repo`. Use a repository the agent can
clone, push a branch to, and open PRs in.

For this basic setup, keep the card in a configured list during planning, implementation, and review
so later activity can resume the task. Moving it out removes the assignment on
the next successful board observation; it is not an immediate kill switch for
a running turn. Put the same rule in your task templates so the agent does not
move the card out while it still needs feedback.
For a board that reflects progress, use the
[optional list lifecycle](#optional-move-cards-as-work-progresses) below instead.

## 2. Configure Trello access and list IDs

The workflow needs both an API key and a user token. In the
[Power-Up admin portal](https://trello.com/apps/admin), select or create a
Power-Up and find its API key under Trello Auth. Authorize a token using that
key. Read access is sufficient for observation; task agents that update cards
also need write access. See [Trello authorization](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/).

Edit your local `.env`:

```dotenv
TRELLO_KEY=your_api_key
TRELLO_TOKEN=your_token_for_that_key
TRELLO_BOARD_ID=your_board_short_link_or_full_id
```

The board short link is the segment immediately after `/b/` in its URL:
`https://trello.com/b/AbCd1234/my-board` gives `AbCd1234`. Trello accepts board
short links in place of full board IDs. See [Trello object definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/).

**`TRELLO_READY_LIST_IDS` expects IDs, never the text `Ready`.** To find them,
run this read-only command from your workflow project. It loads credentials from
`.env` and prints only open list names and IDs:

```sh
node --env-file=.env --input-type=module <<'NODE'
const { TRELLO_KEY: key, TRELLO_TOKEN: token, TRELLO_BOARD_ID: board } = process.env;
if (!key || !token || !board) throw new Error("Set Trello key, token, and board in .env first.");
const url = new URL(`https://api.trello.com/1/boards/${encodeURIComponent(board)}/lists`);
url.search = new URLSearchParams({ key, token, filter: "open", fields: "name" });
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Trello returned HTTP ${response.status}`);
  const lists = await response.json();
  for (const list of lists) console.log(`${list.name}: ${list.id}`);
} catch {
  console.error("Could not read lists. Check Trello credentials, board access, and network.");
  process.exitCode = 1;
}
NODE
```

This uses Trello's [list lookup endpoint](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-lists-get).
Copy the ID beside Ready into `.env`; separate multiple IDs with commas.

```dotenv
TRELLO_READY_LIST_IDS=paste_the_ready_list_id_here
```

Leave it blank **only if your customized adapter explicitly supports automatic
lookup**. The bundled starter reports missing configuration for an empty value.

## 3. Give the agent a GitHub identity

Set `GITHUB_BOT_LOGIN` to the account the agent uses, and `GITHUB_TOKEN` to a
token belonging to that same account. Agent-authored activity is filtered out
to avoid self-triggered turns. If you want your PR comments to wake the agent,
use a different account for the human reviewer.

A machine user is a regular GitHub account dedicated to automation. Create the
account, invite it to the target repositories with write access, and accept the
invitations while signed in as that account. See [GitHub account types](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts).

Generate a token from the agent account under **Settings → Developer settings →
Personal access tokens**. Choose access that allows repository reads, branch
pushes, PRs and comments, plus reading checks and commit statuses. Token choice
depends on repository ownership and organization policy: fine-grained tokens
have collaborator limitations, and a classic token may be needed with the `repo`
scope for repository access. Follow
[GitHub's token guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
for the applicable permissions, expiration, and organization authorization.

```dotenv
GITHUB_BOT_LOGIN=your-agent-account
GITHUB_TOKEN=token_from_your_agent_account
PATCHWAKE_AGENT_ENGINE=codex
PATCHWAKE_MAX_TURNS=1
PATCHWAKE_REQUIRE_DIRECTED=1
PATCHWAKE_AGENT_ENV=GITHUB_TOKEN,TRELLO_KEY,TRELLO_TOKEN
```

Install and authenticate your chosen agent CLI under the operating-system user
that will run the scheduler. Install `git` and, if your task instructions use it,
GitHub CLI (`gh`). Ensure the agent's GitHub API and git operations use the
configured agent identity. `GITHUB_BOT_LOGIN` alone does not authenticate anything.

Review `PATCHWAKE_AGENT_ENV`: it explicitly passes the listed credentials into
agent turns. Remove Trello credentials if your task instructions do not require
direct Trello access. The runtime also preserves basic process environment and
can use local CLI authentication. Keep `.env` and `var/` out of source control.

## 4. Preview, then launch one task

After the coding agent has adapted and tested the workflow, run:

```sh
npm run build
npm run typecheck
npm test
npm run dry-run
```

Inspect the report: Trello should detect your card, and components that were
observed should report healthy access. A dry run performs provider reads and
writes a local tick lock, but does not claim tasks or start agents. A successful
exit alone does not prove healthy observation. GitHub activity reads can depend
on existing local claims, so an empty dry run does not prove that every GitHub
permission or agent command will work.

When the report is healthy and the card is detected:

```sh
npm start
npm run status
```

**`npm start` runs one tick.** Agent work continues after that command exits.
Status reads local state; it does not poll GitHub or resume work. After feedback
or approval arrives, run `npm start` again, or let a scheduler run the next tick.

Inspect the PR and local task logs under `var/work/`. The starter also writes a
tick audit to `var/logs/ticks.jsonl`. Once the first task works, follow
[Schedule on a persistent host](../README.md#schedule-on-a-persistent-host) in a
generated project. In a source checkout, use the
[source scheduler instructions](https://github.com/patchwake/patchwake#try-it-from-source).

## Optional: review a plan before coding

Ask your coding agent to add this workflow before claiming your first task:

```text
Read skills/build-orchestrator/SKILL.md and add plan approval to my workflow.

Keep the task in its assigned Trello list through planning and review.
Write SPEC.md and PLAN.md, open a draft PR with both, and stop before coding.
Require a new top-level PR comment from a human repository owner or collaborator
with write, maintain, or admin permission, using a different account from the bot:
@<bot-login> approve plan

Do not require the human to supply a commit SHA or document version. On resumption,
read the authoritative comment, verify the author's repository permission, and
use the PR timeline and document history to confirm approval follows publication
of the current spec and plan. If that order is unclear, request fresh approval.
Changes to either planning document require fresh approval. Implementation-only
commits preserve approval of unchanged documents. Withdrawn approval or scope
changes pause coding. CI events, bot comments, and unrelated comments do not
authorize coding. Spec-only approval does not authorize implementation.
After approval, resume the same session to implement the plan. Never merge
automatically. Include the exact approval command in the draft PR.

Implement the rules in templates/task/ and preserve PR-comment wakeups.
Validate comment resumption and self-comment filtering with fixtures.
Document that this is an agent-followed rule, not an engine-enforced gate.
```

Review the spec and plan from your human account, then post the approval command
shown in the PR with the actual bot login. Post a new comment rather than editing
an old one; comment edits do not create a new wake event in this adapter. Keep
the card assigned and run another tick. The agent resumes the same session.
With the basic setup it stays in Ready; with the lifecycle below it waits in Review.

The stock directed-wakeup setting requires top-level PR comments to mention
`GITHUB_BOT_LOGIN`; comments from that account are ignored. The engine schedules
turns from activity, while the task instructions tell the agent how to verify
approval. A fixture proving that a comment wakes a session does not prove that
the agent will obey the approval rule. Hard enforcement requires additional
policy and execution boundaries in your custom workflow.

Task templates are copied into task workspaces when claimed. Editing the source
templates does not retrofit existing claims; ask your coding agent to handle
those workspaces explicitly when changing an active workflow.

## Optional: move cards as work progresses

This recipe combines plan approval with a board that shows the current phase.
Ask your coding agent to add it to your workflow; simply configuring every list
as a Ready list in the bundled starter would also admit unclaimed cards from
those lists, which is a different assignment policy.

| List | Meaning |
| --- | --- |
| Ready | Entry queue for new tasks. |
| Doing | Agent is planning, implementing, or addressing feedback. |
| Review | Waiting for plan approval or code review. |
| Done | Agent verified that a human merged the task PR. |

The adapter admits new work only from Ready and retains **existing local claims**
in Doing and Review. Unclaimed cards in Doing/Review are ignored. Missing or
ambiguous required lists must produce an observation error that preserves
existing claims. Backlog, Done, other lists, and archived cards are outside the
assignment set. Preserving local state is essential to retaining these sessions.

Add this to your workflow-building prompt:

```text
Add a Ready → Doing → Review → Done Trello lifecycle.
Resolve open lists by exact name on the configured board. Require unique Doing,
Review, and Done lists; allow explicit IDs to disambiguate duplicate Ready lists.
Only claim new cards in Ready. Retain existing local claims in Doing and Review;
ignore unclaimed cards already there. Preserve the task's branch and session.

Keep observers read-only. In task templates, authorize the agent to move only
its own card: Doing before work, Review after publishing the planning draft PR
or finishing implementation, and Doing again while addressing feedback.
After a human merges, deliver a merge wake so the agent can verify completion
and move the card to Done. Check for a merge before any resumed implementation.
A closed but unmerged PR stays in Review. Never merge automatically.

Require Trello read/write credentials for agent moves. Resolve and verify each
move on the card's own board; skip already-applied moves. On failure, report the
blocker and stop. Document how a fresh bot-directed PR comment can retry a failed
move, including after merging. Do not move a card back after a human unassigns it.

List moves alone do not wake an idle session or authorize implementation.
Add fixtures for claim retention, ignored unclaimed cards, list errors, approval
and merge wakes, duplicate ticks, and standing down tasks outside the workflow.
```

When combined with the approval recipe, Review holds both the planning draft PR
and the finished implementation at different stages. A human approval or passing
CI does not move a card to Done. The agent performs the moves; fixtures can prove
the adapter retains the session and delivers wakes, but do not execute or prove
real agent-driven Trello transitions. Validate one small task before scheduling.

## If nothing happens

| Symptom | Check |
| --- | --- |
| Missing Trello configuration | Both key and token are set; the starter also needs at least one list ID. |
| Ready has cards but none are detected | The configured IDs belong to that board's open lists. A name such as `Ready` is not an ID. |
| Healthy board with zero cards | Add a small card to a configured list. An empty board has no work to launch. |
| Agent cannot open a PR | Repository label, agent-account access, token permissions, git authentication, and required CLI availability. |
| Approval comment does not resume work | A later tick ran, the card is still assigned, the comment mentions the bot, and its author is a different account. |
| Works manually but not under cron | Absolute paths, `.env` loading, CLI directories on `PATH`, scheduler user, awake host, and `scheduler.log`. |
