import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireLock,
  ClaimConflict,
  FileStateStore,
  lockIsHeld,
  TickAlreadyRunning,
  writeJsonAtomic,
} from "../patchwake/state.js";
import { workItem } from "../patchwake/models.js";
import { temporary, waitFor, work } from "./helpers.js";

test("claims atomically, substitutes only text templates, and keeps sessions namespaced", (t) => {
  const root = temporary(t),
    template = join(root, "template");
  mkdirSync(template);
  writeFileSync(
    join(template, "PROMPT.md"),
    "Work on {{TASK_ID}}: {{TASK_DESCRIPTION}}",
  );
  writeFileSync(
    join(template, "run.ts"),
    "const value = '{{TASK_DESCRIPTION}}';\n",
  );
  const store = new FileStateStore(join(root, "var"), template);
  const item = workItem({
    ...work(),
    priority: 0,
    description: "$(touch should-not-run) {{TASK_TITLE}}",
  });
  const directory = store.claim(item);
  assert.equal(
    readFileSync(join(directory, "PROMPT.md"), "utf8"),
    "Work on TASK-1: $(touch should-not-run) {{TASK_TITLE}}",
  );
  assert.equal(
    readFileSync(join(directory, "run.ts"), "utf8"),
    "const value = '{{TASK_DESCRIPTION}}';\n",
  );
  assert.deepEqual(store.workItem(directory), item);
  const session = store.sessionId(directory, "test-runtime");
  assert.ok(session);
  assert.equal(store.sessionId(directory, "test-runtime"), session);
  assert.equal(store.sessionId(directory, "other-runtime", false), "");
  assert.equal(
    readdirSync(store.workDir).filter((name) => name.startsWith(".staging-"))
      .length,
    0,
  );
});
test("second claim conflicts and unsafe keys and namespaces are rejected", (t) => {
  const store = new FileStateStore(join(temporary(t), "var"));
  store.claim(work());
  assert.throws(() => store.claim(work()), ClaimConflict);
  assert.throws(() => store.claim(work("../escape")), /safe path/);
  assert.throws(() => store.claim(work("TASK\n")), /safe path/);
  assert.throws(
    () => store.sessionId(store.taskDir("TASK-1"), "../../escape"),
    /namespace/,
  );
});
test("tick lock rejects overlapping async ticks and releases after exceptions", async (t) => {
  const store = new FileStateStore(join(temporary(t), "var"));
  await store.withTickLock(async () => {
    await assert.rejects(
      store.withTickLock(() => {}),
      TickAlreadyRunning,
    );
  });
  await assert.rejects(
    store.withTickLock(() => {
      throw new Error("injected");
    }),
    /injected/,
  );
  await store.withTickLock(() => {});
});
test("OS locks release on process death and stale lock files do not imply liveness", async (t) => {
  const path = join(temporary(t), "turn.lock");
  assert.equal(lockIsHeld(path), false);
  const release = acquireLock(path);
  assert.equal(lockIsHeld(path), true);
  release();
  assert.equal(lockIsHeld(path), false);
  const child = fork(
    fileURLToPath(
      new URL("../../tests/fixtures/lock-holder.mjs", import.meta.url),
    ),
    [path, new URL("../patchwake/state.js", import.meta.url).href],
    { silent: true },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  await once(child, "message");
  assert.equal(lockIsHeld(path), true);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  await waitFor(() => !lockIsHeld(path), "lock release after crash");
});
test("reads durable JSON records with snake_case keys and Unix-second timestamps", (t) => {
  const store = new FileStateStore(join(temporary(t), "var")),
    directory = store.claim(work());
  writeJsonAtomic(store.statePath(directory, "turn.json"), {
    version: 1,
    sequence: 4,
    pid: 123,
    started_at: 1_700_000_000,
    prompt: "Continue",
    resumed: true,
    runtime: "codex-cli",
  });
  writeJsonAtomic(store.statePath(directory, "status.json"), {
    version: 1,
    sequence: 4,
    exit_code: 0,
    finished_at: 1_700_000_100,
    is_error: false,
  });
  store.writeSessionId(directory, "codex-cli", "existing-thread");
  store.markSessionReady(directory, "codex-cli", "existing-thread");
  writeJsonAtomic(store.statePath(directory, "seen.json"), {
    version: 1,
    streams: { comments: 42 },
  });
  writeJsonAtomic(store.statePath(directory, "waits.json"), {
    version: 1,
    waits: [
      { name: "CI", url: "https://ci", since: 1_700_000_050, ref: "r#1" },
    ],
  });
  writeJsonAtomic(store.statePath(directory, "restarts.json"), {
    count: 2,
    last_at: 1_700_000_010,
  });
  const snapshot = store.inspect(
    "TASK-1",
    directory,
    store.waits(directory),
    false,
    1_700_000_200,
  );
  assert.equal(snapshot.state, "WAITING");
  assert.equal(snapshot.turn.started_at, 1_700_000_000);
  assert.equal(snapshot.lastRestartAt, 1_700_000_010);
  assert.equal(snapshot.restarts, 2);
  assert.equal(
    store.sessionId(directory, "codex-cli", false),
    "existing-thread",
  );
  assert.equal(
    store.sessionReady(directory, "codex-cli", "existing-thread"),
    true,
  );
  assert.deepEqual(store.seen(directory), { comments: 42 });
});
