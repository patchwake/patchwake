const steps = {
  build: [
    "# Create your editable workflow project\nnpm create patchwake@latest my-workflow\ncd my-workflow",
    "Create a project with a pinned engine dependency. Next, choose Customize to build your workflow with your coding agent.",
  ],
  customize: [
    `Read skills/build-orchestrator/SKILL.md and build my workflow:

- Pick up Trello cards in the "Ready" list.
- Use each card's repo:owner/name label for its GitHub repository.
- Run Codex CLI to implement the task and open a pull request.
- Resume the same session for review feedback or CI failures.
- Report health to the console. Never merge automatically.
- Run one agent turn at a time; check for work every five minutes.

Adapt workflow/orchestrator.ts, workflow/adapters.ts, and templates/task/.
Preserve --dry-run and --status. Document setup, the agent credential
allowlist, and scheduling. Add tests and validate with fixtures first.`,
    "Use your agent to build the workflow. Open my-workflow in your coding agent and adapt this example prompt to your workflow. The included build-orchestrator skill guides the changes and validation. Then configure .env and authenticate your agent CLI before Preview.",
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

const examples = [
  {
    label: "Trello, GitHub, and Codex CLI",
    board: "Trello / Ready",
    runtime: "Codex CLI",
    adapters: "Included Trello + GitHub starter",
    action: "implement → open a PR",
    destination: "GitHub / Pull request",
    review: "Code review + CI",
  },
  {
    label: "Jira, GitLab, and Claude Code",
    board: "Jira / Ready",
    runtime: "Claude Code",
    adapters: "Jira + GitLab: custom adapters",
    action: "spec + plan → open a draft MR",
    destination: "GitLab / Merge request",
    review: "Spec + plan + review gates",
  },
];
const carousel = document.querySelector(".blueprint");
const exampleSlide = document.querySelector("#example-slide");
const exampleButtons = [...document.querySelectorAll("[data-example]")];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let exampleIndex = 0;
let rotating = !reducedMotion.matches;
let hovering = false;
let exampleTimer;

function showExample(index) {
  exampleIndex = index;
  const example = examples[index];
  document.querySelector("#example-number").textContent =
    `EXAMPLE / ${String(index + 1).padStart(3, "0")}`;
  for (const field of [
    "board",
    "runtime",
    "adapters",
    "action",
    "destination",
    "review",
  ]) {
    document.querySelector(`#example-${field}`).textContent = example[field];
  }
  exampleSlide.setAttribute(
    "aria-label",
    `${index + 1} of 2: ${example.label}`,
  );
  for (const button of exampleButtons) {
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.example) === index),
    );
  }
}

function updateRotation() {
  window.clearInterval(exampleTimer);
  const running = rotating && !hovering && !document.hidden;
  exampleSlide.setAttribute("aria-live", running ? "off" : "polite");
  if (running) {
    exampleTimer = window.setInterval(
      () => showExample((exampleIndex + 1) % examples.length),
      7000,
    );
  }
}

for (const button of exampleButtons) {
  button.addEventListener("click", () => {
    rotating = false;
    updateRotation();
    showExample(Number(button.dataset.example));
  });
}
// Stop on keyboard focus so the example stays still while navigating controls.
carousel.addEventListener("focusin", () => {
  rotating = false;
  updateRotation();
});
carousel.addEventListener("mouseenter", () => {
  hovering = true;
  updateRotation();
});
carousel.addEventListener("mouseleave", () => {
  hovering = false;
  updateRotation();
});
document.addEventListener("visibilitychange", updateRotation);
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) rotating = false;
  updateRotation();
});
document.querySelector(".example-controls").hidden = false;
updateRotation();
