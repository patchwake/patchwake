const form = document.querySelector("#workflow-form");
const promptOutput = document.querySelector("#workflow-prompt");
const status = document.querySelector("#copy-status");

function updatePrompt() {
  const { board, runtime, channel, concurrency } = Object.fromEntries(
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
      ? "Reuse the Trello/GitHub example"
      : `Reuse Patchwake's engine, file store, and GitHub activity adapter;\nadd the ${board} board adapter`;
  const healthAdapter =
    channel === "Console"
      ? " and use the\nincluded console channel."
      : ` and add the\n${channel} health adapter.`;
  promptOutput.textContent = `Read skills/build-orchestrator/SKILL.md and build my workflow:

- ${assignments[board]}
- Run ${runtime} to implement the task and open a pull request.
- Resume the same session when reviewers request changes or CI fails.
- ${reporting} Never merge automatically.
- Run at most ${concurrency} agent turn${concurrency === "1" ? "" : "s"} at once; check for work every five minutes.

Create examples/my_workflow/orchestrator.ts with --dry-run and
--status options. ${composition}${healthAdapter} Keep workflow rules in task templates.

Document the required environment variables and explicitly
allowlist credentials needed by the agent. Add tests and scheduler
instructions; validate with fixtures first.`;
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
    "# From the repository root\nnpm ci\nnpm run build\nnpm test",
    "Install dependencies, compile the workflow, and run the tests.",
  ],
  preview: [
    "# After your agent creates my_workflow\nnode dist/examples/my_workflow/orchestrator.js --dry-run",
    "Read provider state and preview decisions without claiming tasks or starting agent turns.",
  ],
  run: [
    "# Run one tick, then inspect task state\nnode dist/examples/my_workflow/orchestrator.js\nnode dist/examples/my_workflow/orchestrator.js --status",
    "Start or resume eligible tasks. Agent turns continue after the tick exits.",
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
