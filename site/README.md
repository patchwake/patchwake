# Patchwake landing page

Published at https://patchwake.github.io/patchwake/.

Source for the GitHub Pages landing page. No build step, external
assets, analytics, or live integration calls are required. The workflow builder
generates a prompt locally in the browser.

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

The onboarding flow uses `npm create patchwake@latest` and prompts an agent to
edit `workflow/` in the generated project. Keep the HTML default prompt/commands
and their JavaScript equivalents aligned. Until both npm packages are released,
the page explicitly links to the source-install fallback. Remove the availability
note only after verifying the public initializer command; see
`docs/publishing.md`. The npm release workflow and Pages deployment are separate.
