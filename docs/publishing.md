# Publishing Patchwake

Patchwake ships as two public npm packages from this repository:

| Package | Contents | Consumer |
| --- | --- | --- |
| `patchwake` | Compiled engine and worker, types, source contracts, docs, skills, task templates, bundled CLI | Workflow projects and existing TypeScript applications |
| `create-patchwake` | Dependency-free initializer and a prepared editable starter | `npm create patchwake@latest my-workflow` |

Both manifests use the same version. The generator pins that exact engine version
in each new project. `scripts/prepare-create.mjs` builds its template from the
current example, docs, skills, and task templates during `npm pack`; the prepared
template is ignored by Git. There is no second editable copy of the adapters.

## Validate before publishing

Use Node.js 22+ on Linux/macOS, a current npm, Python, and a C/C++ toolchain.
CI tests Node 22 and 24 on Linux and macOS, using npm 11 and Python 3.12.
If an old npm fails with `No module named distutils` on recent Python, update
npm or use `npx --yes npm@11 ci` and `npx --yes npm@11 run check`.

```sh
npm ci
npm run check
mkdir -p .release
npm pack --pack-destination .release
npm pack ./packages/create-patchwake --pack-destination .release
```

`npm run check` builds, typechecks, checks formatting, runs unit tests, and runs
`scripts/test-packaging.mjs`. The packaging check creates actual tarballs, installs
the initializer outside the repository, generates a project without installation,
substitutes the local library tarball, installs normal dependencies, and runs its
build, types, and fixture tests. It checks the installed executable, template and
source inclusion, overwrite refusal, and a detached fake-agent turn plus resume.
It never calls Trello/GitHub or starts an authenticated coding agent.

The native `fs-ext` addon still builds on installation. We retain its OS-backed
locks because worker liveness and tick exclusion depend on them. Prebuilt native
binaries or an alternative locking implementation are outside this release.

## One-time npm setup

The packages were not present on the public registry when this setup was written.
Patchwake is MIT licensed. npm account ownership and trusted publishing still
require account setup. Before first publication:

1. Confirm ownership/availability of `patchwake` and `create-patchwake` with the
   npm account that will maintain them. If names must change, update both
   manifests, the generator's dependency name, imports, docs, and website together.
2. Verify both manifests declare `MIT` and both packed packages include `LICENSE`.
   The generator also preserves the notice as `PATCHWAKE-LICENSE` in generated
   projects for the copied starter code, templates, and documentation.
3. Merge the reviewed setup and run all validation from a clean checkout of
   `main`. Inspect the packed file lists (`tar -tzf .release/<package>.tgz`).
   `output/`, `.env`, and runtime state are excluded from the packages.
4. Authenticate locally with `npm login` and publish the **library first**, then
   the initializer, replacing `0.3.0` below if the release version changes:

   ```sh
   npm publish .release/patchwake-0.3.0.tgz --access public
   npm publish .release/create-patchwake-0.3.0.tgz --access public
   ```

   These commands perform the public release; they are not part of PR validation.
   Bootstrap locally using the npm account's normal authentication/2FA flow.
5. Create a GitHub Actions environment named `npm`. Configure reviewers/release
   tag restrictions to match the project's release policy. For **each npm
   package**, add a GitHub Actions trusted publisher with owner `patchwake`,
   repository `patchwake`, workflow filename `publish.yml`, and environment `npm`.
   Allow direct `npm publish` for this workflow. No long-lived npm token is needed
   for subsequent releases. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
6. Verify the public flow in a fresh directory:

   ```sh
   npm create patchwake@latest release-smoke
   cd release-smoke
   npm test
   npm run status
   ```

   This does not require provider credentials. Edit `.env` and authenticate an
   agent only for a deliberate live workflow rehearsal.
7. Remove the first-release availability notes from the main README, site HTML,
   generator README, and customization guide after both packages are available.
   Publish release notes on GitHub. Pages deploys on merge independently of npm.

## Subsequent releases

1. Change `version` in `package.json` and
   `packages/create-patchwake/package.json` together; update `package-lock.json`
   with `npm install --package-lock-only`. Use stable `X.Y.Z` versions for this
   workflow. The generator template is regenerated when packing.
2. Open a PR with release notes and pass CI. Merge it to `main`.
3. From the reviewed commit, push the matching version tag:

   ```sh
   git tag v0.3.1
   git push origin v0.3.1
   ```

4. `.github/workflows/publish.yml` runs the full Linux/macOS validation, checks
   that the tagged commit is on `main` and both versions match the tag, builds
   both tarballs, then publishes the library followed by the generator with
   provenance through npm's OIDC trusted publisher.
5. Verify the published initializer and add GitHub release notes before announcing.

Publication of two packages is not atomic. On retry, `scripts/release.mjs` skips
an existing version only when its registry integrity matches the local tarball;
other registry errors or different contents fail the release. If only the library
published, fix the external failure and rerun the same workflow. If contents must
change, publish a new matched version pair; npm versions cannot be overwritten.
Do not move a release tag. The script supports stable releases only; introduce an
explicit prerelease channel before publishing prereleases.

## State-path migration and upgrades

The bundled `patchwake-trello-github` executable now defaults to the current working
directory, not the installed package directory. `--root` overrides
`PATCHWAKE_ROOT`. Source-checkout users running from the repository root retain
their existing `var/` path. Existing schedulers that run from elsewhere should
pass `--root /absolute/path/to/existing/workspace` before upgrading; verify
`--status` sees the same tasks. Never create a second state directory for a live
workflow: that loses the existing claim and overlap-lock boundary.

Generated projects resolve their default root relative to their built composition,
so an absolute scheduler command works independently of cwd. Local task templates
win over bundled defaults. Engine upgrades do not overwrite generated workflows,
.env, var, or copied docs/skills. Pause new ticks and let detached turns finish
before replacing installed engine files, then validate the upgraded workflow.
