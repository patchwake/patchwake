# create-patchwake

Create an editable agent workflow with Patchwake as a pinned npm dependency:

```sh
npm create patchwake@latest my-workflow
cd my-workflow
```

Open the generated project in your coding agent and read
`skills/build-orchestrator/SKILL.md`. Customize the Trello/GitHub starter, edit
`.env`, install and authenticate your agent CLI, then run `npm test`,
`npm run dry-run`, and `npm start`. See the generated README for scheduling.

Requires Node.js 22+, Linux or macOS, Python, and a C/C++ toolchain for Patchwake's
native file locks. Use `npm create patchwake@latest my-workflow -- --no-install`
to write files without installing or building. Existing nonempty directories are
never overwritten. The generator does not contact task providers or start agents.

This package and `patchwake` are released together from
[patchwake/patchwake](https://github.com/patchwake/patchwake). Before the first npm
release, use that repository's source installation and packaging smoke test.
