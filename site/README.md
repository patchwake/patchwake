# Patchwake landing page

Published at https://patchwake.github.io/patchwake/.

Source for the GitHub Pages landing page. No build step, analytics, or live
integration calls are required. The demo loads an external YouTube player.

From the repository root:

```sh
npm run site:dev
```

Open http://127.0.0.1:4173/patchwake/. Set `PATCHWAKE_SITE_PORT` to change the port.
The preview serves only the four public assets, not repository files.

`index.html`, `style.css`, `app.js`, and `mark.svg` are the deployment artifact.
Relative asset URLs support the GitHub Pages `/patchwake/` project path.
`.github/workflows/deploy-pages.yml` publishes those four files when site files
or the workflow change on `main`, and can also be run manually. Preview tooling,
repository files, and local design explorations are excluded from the artifact.

GitHub source and documentation links point to the public organization repository,
`patchwake/patchwake`. Other adapters mentioned on the page are explicitly
identified as custom implementations, not bundled integrations.

The hero carousel shares one diagram between the included Trello + GitHub +
Codex CLI starter and a Jira + GitLab + Claude Code example. The second example
explicitly requires custom Jira and GitLab adapters, with spec, plan, and review
gates implemented through custom task instructions rather than built-in engine
approval gates. Its draft merge request holds the spec and plan. The carousel
starts automatically and rotates every seven seconds. It pauses on hover or
while the tab is hidden, and stops for the rest of the page visit on keyboard
focus or selection of 1 or 2. There is no Play/Pause control. Reduced-motion
preferences disable automatic rotation by default. Without JavaScript, the Trello diagram remains
visible and carousel controls stay hidden.

A responsive video player follows the hero with the 30-second Patchwake demo.
It uses YouTube's privacy-enhanced embed, loads lazily, and does not autoplay.
Nearby links lead to Get started and the video on YouTube.

`docs/first-task.md` bridges workflow creation and the first running task. It is
also copied into generated projects. The run panel follows the intro, before
the moving parts. It covers Create, Customize, Preview, Run, and Schedule.
Customize directs users to open their project in a coding agent and includes
an editable example prompt invoking `skills/build-orchestrator/SKILL.md`.
The main calls to action link to this setup section. Scheduler details belong
in the generated project's README. The bundled Trello adapter requires list
IDs, not names or automatic Ready lookup.

The onboarding flow uses `npm create patchwake@latest` and prompts an agent to
edit `workflow/` in the generated project. Keep the HTML default prompt/commands
and their JavaScript equivalents aligned. Until both npm packages are released,
the page explicitly links to the source-install fallback. Remove the availability
note only after verifying the public initializer command; see
`docs/publishing.md`. The npm release workflow and Pages deployment are separate.
