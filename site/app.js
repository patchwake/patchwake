const form = document.querySelector("#workflow-form");
const promptOutput = document.querySelector("#workflow-prompt");
const status = document.querySelector("#copy-status");

function updatePrompt() {
  const { board, runtime, channel, concurrency, approval } = Object.fromEntries(
    new FormData(form),
  );
  const assignments = {
    Trello:
      'Pick up Trello cards in the "Ready" list.\n- Use each card\'s repo:owner/name label to select its GitHub repository.',
    Jira: 'Build a Jira adapter for issues assigned to the automation account\n  in "Ready". Use a configured Jira field to map each issue\n  to its GitHub repository.',
    Linear:
      'Build a Linear adapter for issues assigned to the automation account\n  in "Todo". Use a repo:owner/name label for the GitHub repository.',
    "GitHub Issues":
      "Build a GitHub Issues adapter for issues assigned to the automation\n  account and labeled agent-ready. Use the issue's repository.",
  };
  const reporting =
    channel === "Console"
      ? "Report health changes to the console."
      : `Send health changes to ${channel}.`;
  const composition =
    board === "Trello"
      ? "Reuse the Trello/GitHub starter"
      : `Reuse Patchwake's engine, file store, and GitHub activity adapter;\nadd the ${board} board adapter`;
  const healthAdapter =
    channel === "Console"
      ? " and use the\nincluded console channel."
      : ` and add the\n${channel} health adapter.`;
  const taskFlow =
    approval === "plan"
      ? `Run ${runtime} to write SPEC.md and PLAN.md, open a draft PR, and stop.
- Before coding, require a new PR comment from a configured human approver:
  @<bot-login> approve plan. Do not require a commit SHA or version.
- Verify the author's repository permission and that approval follows publication
  of the current spec and plan. Ask for fresh approval if the order is unclear.
- Planning changes require fresh approval; CI activity is not approval.
- Resume the same session to implement the approved plan.`
      : `Run ${runtime} to implement the task and open a pull request.`;
  const approvalSetup =
    approval === "plan"
      ? `
Implement the approval convention in task templates, with PR-comment wakeups.
Document the human approver configuration and separate agent GitHub identity.
Test comment resumption and self-comment filtering with fixtures; document
that the approval rule is agent-followed, not an engine-enforced gate.
${
  board === "Trello"
    ? `
Use Ready → Doing → Review → Done. Claim new cards only from Ready; retain
existing local claims in Doing and Review, ignoring unclaimed cards there.
The agent moves its card to Doing for work and Review for human feedback.
After a human merges, a merge wake lets the agent verify completion and move
the card to Done. A closed, unmerged PR stays in Review. Never auto-merge.
Keep observers read-only. Require Trello read/write access for agent moves,
validate required lists, and test claim retention, merge wakes, and outages.
List moves alone must not wake an idle session or authorize implementation.
`
    : ""
}
`
      : "";
  promptOutput.textContent = `Read skills/build-orchestrator/SKILL.md and build my workflow:

- ${assignments[board]}
- ${taskFlow}
- Resume the same session when reviewers request changes or CI fails.
- Keep tasks assigned while planning, implementation, or review is pending.
- ${reporting} Never merge automatically.
- Run at most ${concurrency} agent turn${concurrency === "1" ? "" : "s"} at once; check for work every five minutes.

Adapt workflow/orchestrator.ts and workflow/adapters.ts; preserve
--dry-run and --status. ${composition}${healthAdapter} Keep workflow rules in task templates.
${approvalSetup}
Document board setup, repository mapping, credentials, and the agent credential
allowlist. Explain list IDs versus names and any automatic lookup you add.
Add fixture tests and validate them before live provider reads.

Include a first-task walkthrough and five-minute scheduler instructions with
absolute executable paths, PATH, .env loading, logs, and host-awake requirements.
Explain that npm start runs one tick and later activity needs another tick.`;
  status.textContent = "";
}
form.addEventListener("change", updatePrompt);
form.addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#copy-prompt").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(promptOutput.textContent);
    status.textContent = "Prompt copied.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(promptOutput);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    promptOutput.focus();
    status.textContent = "Prompt selected. Press Ctrl+C or ⌘C to copy.";
  }
});

const steps = {
  build: [
    "# Create your editable workflow project\nnpm create patchwake@latest my-workflow\ncd my-workflow",
    "Create a project with a pinned engine dependency. Open it in your coding agent and use the workflow prompt above.",
  ],
  preview: [
    "# Configure .env and add one small task to Ready\nnpm run build\nnpm run typecheck\nnpm test\nnpm run dry-run",
    "Check component health and confirm the card is detected. A successful exit alone does not prove provider access. No tasks are claimed or agents started.",
  ],
  run: [
    "# Run one tick, then inspect task state\nnpm start\nnpm run status",
    "Run one tick to start or resume eligible tasks. Agent turns continue after it exits. Run another tick after a review or plan approval, or enable the scheduler.",
  ],
  schedule: [
    "# Ask your coding agent to fill in paths for this host\n# Follow README.md: Schedule on a persistent host\ncommand -v node\ncommand -v codex  # or claude\ncommand -v gh\ncrontab -e\n# After adding the documented five-minute entry:\ncrontab -l\ntail -f scheduler.log",
    "Install the cron entry from your workflow README after the first task works. It must load .env and include the agent CLI on PATH. Keep the host awake and var/ on local storage.",
  ],
};
const tabs = [...document.querySelectorAll("[data-step]")];
function selectStep(tab) {
  for (const item of tabs) {
    item.setAttribute("aria-selected", String(item === tab));
    item.tabIndex = item === tab ? 0 : -1;
  }
  document.querySelector("#command-code").textContent =
    steps[tab.dataset.step][0];
  document.querySelector("#command-description").textContent =
    steps[tab.dataset.step][1];
  document.querySelector("#run-code").setAttribute("aria-labelledby", tab.id);
}
for (const tab of tabs) {
  tab.addEventListener("click", () => selectStep(tab));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tabs[next].focus();
    selectStep(tabs[next]);
  });
}
updatePrompt();
