import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "patchwake-packaging-"));
const npmCli = process.env.npm_execpath;
const npm = (args, cwd = root) =>
  execFileSync(
    npmCli ? process.execPath : "npm",
    npmCli ? [npmCli, ...args] : args,
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
function pack(cwd) {
  // npm's lifecycle output differs across npm versions. Query the tarball
  // inventory separately instead of parsing mixed build output as JSON.
  npm(["pack", "--pack-destination", temporary], cwd);
  const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  return join(temporary, `${manifest.name}-${manifest.version}.tgz`);
}
function run(args, cwd, env = {}) {
  return execFileSync(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
try {
  const library = pack(root);
  const creator = pack(resolve(root, "packages/create-patchwake"));
  const runner = join(temporary, "runner");
  mkdirSync(runner);
  writeFileSync(
    join(runner, "package.json"),
    '{"name":"packaging-runner","private":true}\n',
  );
  npm(["install", "--no-audit", "--no-fund", creator], runner);
  const cli = join(runner, "node_modules/create-patchwake/index.mjs");
  const workflow = join(temporary, "my-workflow");
  assert.match(run([cli, "--help"], runner), /npm create patchwake/);
  npm(["exec", "--", "create-patchwake", workflow, "--no-install"], runner);
  assert.ok(!existsSync(join(workflow, "node_modules")));
  const manifest = JSON.parse(
    readFileSync(join(workflow, "package.json"), "utf8"),
  );
  const version = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  assert.equal(manifest.dependencies.patchwake, version);
  for (const file of [
    ".gitignore",
    ".env",
    ".env.example",
    "AGENTS.md",
    "templates/task/AGENTS.md",
    "docs/customizing.md",
    "skills/build-orchestrator/SKILL.md",
    "workflow/orchestrator.ts",
    "workflow/adapters.ts",
  ]) {
    assert.ok(
      existsSync(join(workflow, file)),
      `Missing scaffold file: ${file}`,
    );
  }
  const before = readFileSync(join(workflow, ".env"), "utf8");
  const refusal = spawnSync(process.execPath, [cli, workflow, "--no-install"], {
    encoding: "utf8",
  });
  assert.equal(refusal.status, 1);
  assert.match(refusal.stderr, /not empty/);
  assert.equal(readFileSync(join(workflow, ".env"), "utf8"), before);
  const hidden = join(temporary, "hidden-only");
  mkdirSync(hidden);
  writeFileSync(join(hidden, ".keep"), "preserve");
  assert.equal(
    spawnSync(process.execPath, [cli, hidden, "--no-install"]).status,
    1,
  );

  // Verify the default install/build path and recovery instructions without
  // asking the registry for the not-yet-published Patchwake version.
  const npmSpy = join(temporary, "npm-spy.mjs");
  const calls = join(temporary, "npm-calls.jsonl");
  writeFileSync(
    npmSpy,
    `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');\nprocess.exitCode = Number(process.env.FIXTURE_EXIT || 0);\n`,
  );
  const automatic = join(temporary, "automatic");
  run([cli, automatic], runner, { npm_execpath: npmSpy });
  const invocations = readFileSync(calls, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    invocations.map((call) => call.args),
    [["install"], ["run", "build"]],
  );
  assert.ok(
    invocations.every(
      (call) =>
        resolve(call.cwd) === resolve(automatic) ||
        call.cwd.endsWith("/automatic"),
    ),
  );
  const failedProject = join(temporary, "failed-install");
  const failedInstall = spawnSync(process.execPath, [cli, failedProject], {
    cwd: runner,
    encoding: "utf8",
    env: { ...process.env, npm_execpath: npmSpy, FIXTURE_EXIT: "1" },
  });
  assert.equal(failedInstall.status, 1);
  assert.match(failedInstall.stderr, /Your project is saved/);
  assert.ok(existsSync(join(failedProject, "workflow/orchestrator.ts")));

  // Substitute the exact local release artifact, never a registry version of
  // Patchwake. All other dependencies come from the normal npm configuration.
  npm(
    ["install", "--no-audit", "--no-fund", "--save-exact", library],
    workflow,
  );
  npm(["test"], workflow);
  npm(["run", "typecheck"], workflow);
  npm(["run", "status"], workflow);
  const installed = join(workflow, "node_modules/patchwake");
  const inventory = execFileSync("tar", ["-tzf", library], {
    encoding: "utf8",
  });
  for (const path of [
    "dist/patchwake/worker.js",
    "dist/patchwake/index.d.ts",
    "patchwake/ports.ts",
    "templates/task/SYSTEM.md",
    "skills/build-orchestrator/SKILL.md",
  ]) {
    assert.ok(
      inventory.includes(`package/${path}`),
      `Missing package asset: ${path}`,
    );
  }
  assert.ok(!inventory.includes("package/.env\n"));
  assert.ok(!inventory.includes("package/var/"));
  assert.ok(!inventory.includes("package/output/"));
  // Installed CLI runs via npm's executable link, with state outside package.
  const unrelated = join(temporary, "unrelated");
  mkdirSync(unrelated);
  const workspace = join(temporary, "cli-workspace");
  const ignored = join(temporary, "ignored-env-root");
  const bin = join(workflow, "node_modules/.bin/patchwake-trello-github");
  assert.match(
    execFileSync(bin, ["--help"], { cwd: unrelated, encoding: "utf8" }),
    /--root/,
  );
  const noCredentials = {
    TRELLO_KEY: "",
    TRELLO_TOKEN: "",
    GITHUB_TOKEN: "",
    GITHUB_BOT_LOGIN: "",
    PATCHWAKE_AGENT_ENGINE: "claude",
  };
  const dryReport = run([bin, "--dry-run", "--root", workspace], unrelated, {
    ...noCredentials,
    PATCHWAKE_ROOT: ignored,
  });
  assert.match(dryReport, /assignment unknown/);
  assert.ok(existsSync(join(workspace, "var/cache/tick.lock")));
  run([bin, "--status", "--root", workspace], unrelated, {
    PATCHWAKE_ROOT: ignored,
  });
  assert.ok(!existsSync(ignored));
  run([bin, "--status"], unrelated, { PATCHWAKE_ROOT: "" });
  run([bin, "--dry-run"], unrelated, { ...noCredentials, PATCHWAKE_ROOT: "" });
  assert.ok(existsSync(join(unrelated, "var/cache/tick.lock")));
  const generated = join(workflow, "dist/workflow/orchestrator.js");
  run([generated, "--dry-run"], unrelated, {
    ...noCredentials,
    PATCHWAKE_ROOT: "",
  });
  assert.ok(existsSync(join(workflow, "var/cache/tick.lock")));
  assert.ok(!existsSync(join(installed, "var")));
  assert.ok(!existsSync(join(runner, "node_modules/create-patchwake/var")));

  // Exercise the published worker in a detached turn and resume using the
  // repository's existing fake CLI, not a real authenticated agent.
  writeFileSync(
    join(workflow, "worker-smoke.mjs"),
    `
    import assert from 'node:assert/strict';
    import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { FileStateStore, ClaudeCodeRuntime, workItem } from 'patchwake';
    const fake = join(process.cwd(), 'fake-agent.mjs');
    writeFileSync(fake, '#!' + process.execPath + '\\n' + readFileSync(${JSON.stringify(resolve(root, "tests/fixtures/fake-agent.mjs"))}, 'utf8'));
    chmodSync(fake, 0o755);
    process.env.CAPTURE = join(process.cwd(), 'capture.jsonl');
    process.env.FAKE_MODE = 'complete';
    const store = new FileStateStore(join(process.cwd(), 'worker-state'), join(process.cwd(), 'templates/task'));
    const directory = store.claim(workItem({key:'SMOKE-1', title:'Packaged worker', url:'https://fixture.test/1'}));
    assert.ok(readFileSync(join(directory, 'AGENTS.md'), 'utf8').includes('SMOKE-1'));
    const runtime = new ClaudeCodeRuntime(store, {executable:fake, passthroughEnv:['CAPTURE','FAKE_MODE']});
    for (const sequence of [1, 2]) {
      assert.equal((await runtime.start(directory, 'Fixture only', sequence > 1, sequence)).ok, true);
      const deadline = Date.now() + 15000;
      while ((store.status(directory)?.sequence !== sequence || runtime.isAlive(directory)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(store.status(directory)?.sequence, sequence);
      assert.equal(store.status(directory)?.exit_code, 0);
      assert.equal(runtime.isAlive(directory), false);
    }
    const calls = readFileSync(process.env.CAPTURE, 'utf8').trim().split('\\n').map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].args.includes('--resume'));
  `,
  );
  run([join(workflow, "worker-smoke.mjs")], workflow);
  // The installed package remains untouched across workflow and worker runs.
  assert.ok(!readdirSync(installed).includes("var"));
  console.log(
    `Packaging smoke passed: ${version}; generated project, fixtures, installed CLI, detached worker and resume.`,
  );
  console.log(
    `Library SHA-512: ${createHash("sha512").update(readFileSync(library)).digest("base64")}`,
  );
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
