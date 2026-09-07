import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FileStateStore, nowSeconds, readJson } from "../orchestra/state.js";
import { ClaudeCodeRuntime, CodexCliRuntime } from "../orchestra/runtime.js";
import type { CodexRuntimeConfig } from "../orchestra/runtime.js";
import { buildCommand } from "../orchestra/worker.js";
import { temporary, waitFor, work } from "./helpers.js";
import { isRecord } from "../orchestra/json.js";

function environment(t: TestContext, values: Record<string, string>): void {
  const saved = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
function fixture(t: TestContext, mode = "complete") {
  const root = temporary(t),
    fake = join(root, "fake-agent.mjs"),
    capture = join(root, "capture.jsonl");
  writeFileSync(
    fake,
    `#!${process.execPath}\n` +
      readFileSync(
        new URL("../../tests/fixtures/fake-agent.mjs", import.meta.url),
        "utf8",
      ),
  );
  chmodSync(fake, 0o755);
  const store = new FileStateStore(join(root, "var")),
    directory = store.claim(work());
  environment(t, {
    CAPTURE: capture,
    FAKE_MODE: mode,
    ALLOWED_SECRET: "allowed-value",
    BLOCKED_SECRET: "blocked-value",
  });
  const config = {
    executable: fake,
    passthroughEnv: ["CAPTURE", "FAKE_MODE", "ALLOWED_SECRET"],
  };
  const captures = (): Record<string, unknown>[] =>
    readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown)
      .filter(isRecord);
  return { root, store, directory, config, captures, capture };
}
async function completed(
  store: FileStateStore,
  directory: string,
  runtime: ClaudeCodeRuntime | CodexCliRuntime,
  sequence: number,
): Promise<void> {
  await waitFor(
    () =>
      store.status(directory)?.sequence === sequence &&
      !runtime.isAlive(directory),
    `turn ${sequence} completion`,
  );
}
test("Claude first turn and resume keep the same UUID, append logs and accumulate cost", async (t) => {
  const { store, directory, config, captures } = fixture(t);
  writeFileSync(join(directory, "SYSTEM.md"), "Never push to main.\n");
  const runtime = new ClaudeCodeRuntime(store, config);
  assert.equal((await runtime.start(directory, "Start", false, 1)).ok, true);
  await completed(store, directory, runtime, 1);
  const first = store.status(directory);
  assert.equal(first?.exit_code, 0);
  assert.equal(first?.total_cost_usd, 0.25);
  assert.equal(first?.is_error, false);
  assert.deepEqual(first?.usage, { input_tokens: 2 });
  const sessionId = store.sessionId(directory, runtime.name, false);
  assert.ok(sessionId);
  assert.equal((await runtime.start(directory, "Continue", true, 2)).ok, true);
  await completed(store, directory, runtime, 2);
  assert.equal(store.status(directory)?.total_cost_usd, 0.5);
  assert.equal(store.status(directory)?.last_turn_cost_usd, 0.25);
  const calls = captures();
  assert.ok((calls[0]?.args as string[]).includes("--session-id"));
  assert.ok((calls[1]?.args as string[]).includes("--resume"));
  assert.ok((calls[1]?.args as string[]).includes(sessionId));
  assert.ok((calls[1]?.args as string[]).includes("Never push to main.\n"));
  assert.equal(
    readFileSync(store.statePath(directory, "agent.log"), "utf8")
      .trim()
      .split("\n").length,
    2,
  );
});
test("Codex captures its thread, proves readiness, resumes, and preserves the environment allowlist", async (t) => {
  const { store, directory, config, captures } = fixture(t);
  writeFileSync(join(directory, "SYSTEM.md"), "Never push to main.\n");
  const runtime = new CodexCliRuntime(store, config);
  assert.equal(
    (await runtime.start(directory, "Start $(touch should-not-run)", false, 1))
      .ok,
    true,
  );
  await completed(store, directory, runtime, 1);
  const threadId = store.sessionId(directory, runtime.name, false);
  assert.equal(threadId, "0199a213-81c0-7800-8aa1-bbab2a035a53");
  assert.equal(store.sessionReady(directory, runtime.name, threadId), true);
  assert.equal((await runtime.start(directory, "Continue", true, 2)).ok, true);
  await completed(store, directory, runtime, 2);
  const calls = captures(),
    first = calls[0]?.args as string[],
    second = calls[1]?.args as string[];
  assert.equal(first.includes("resume"), false);
  assert.ok(first.includes("--json"));
  assert.equal(first[first.indexOf("--sandbox") + 1], "workspace-write");
  assert.ok(first.includes("sandbox_workspace_write.network_access=true"));
  assert.ok(first.includes('approval_policy="never"'));
  assert.ok(second.includes("resume"));
  assert.ok(second.includes(threadId));
  assert.match(second.at(-1) ?? "", /Never push to main/);
  assert.equal(calls[0]?.allowed, "allowed-value");
  assert.equal(calls[0]?.blocked, undefined);
  assert.deepEqual(store.status(directory)?.usage, {
    input_tokens: 3,
    output_tokens: 1,
  });
});
test("Codex does not resume an id without a matching readiness record", async (t) => {
  const { store, directory, config, captures } = fixture(t);
  store.writeSessionId(directory, "codex-cli", "unproven-id");
  const runtime = new CodexCliRuntime(store, config);
  assert.equal((await runtime.start(directory, "Start", true, 1)).ok, true);
  await completed(store, directory, runtime, 1);
  assert.equal((captures()[0]?.args as string[]).includes("resume"), false);
});
test("Codex error events fail a turn even when the CLI exits zero", async (t) => {
  const { store, directory, config } = fixture(t, "error"),
    runtime = new CodexCliRuntime(store, config);
  assert.equal((await runtime.start(directory, "Start", false, 1)).ok, true);
  await completed(store, directory, runtime, 1);
  assert.equal(store.status(directory)?.exit_code, 0);
  assert.equal(store.status(directory)?.is_error, true);
  assert.equal(
    store.inspect("TASK-1", directory, [], false, nowSeconds()).state,
    "FAILED",
  );
});
test("CLI crashes write completion and release the lock", async (t) => {
  const { store, directory, config } = fixture(t, "crash"),
    runtime = new ClaudeCodeRuntime(store, config);
  assert.equal((await runtime.start(directory, "Start", false, 1)).ok, true);
  await completed(store, directory, runtime, 1);
  assert.equal(store.status(directory)?.exit_code, 7);
});
test("missing executable fails without turn creation", async (t) => {
  const { store, directory } = fixture(t);
  const runtime = new CodexCliRuntime(store, {
    executable: join(directory, "missing-agent"),
  });
  assert.equal((await runtime.start(directory, "Start", false, 1)).ok, false);
  assert.deepEqual(store.turn(directory), {});
  assert.equal(runtime.isAlive(directory), false);
});
test("spawn errors inside the wrapper are acknowledged as failure", async (t) => {
  const { store, directory, root } = fixture(t);
  const fake = join(root, "invalid-interpreter");
  writeFileSync(fake, "#!/no/such/interpreter\n");
  chmodSync(fake, 0o755);
  const runtime = new CodexCliRuntime(store, { executable: fake });
  assert.equal((await runtime.start(directory, "Start", false, 1)).ok, false);
  await waitFor(() => !runtime.isAlive(directory));
  assert.equal(store.status(directory)?.is_error, true);
});
test("live lock rejects duplicate turns; TERM retains liveness and KILL stops the entire group", async (t) => {
  const { store, directory, config, captures, capture } = fixture(t, "sleep"),
    runtime = new CodexCliRuntime(store, config);
  const snapshot = () =>
    store.inspect(
      "TASK-1",
      directory,
      [],
      runtime.isAlive(directory),
      nowSeconds(),
    );
  try {
    assert.equal((await runtime.start(directory, "Start", false, 1)).ok, true);
    await waitFor(() => {
      try {
        return captures().some((row) => typeof row.descendant === "number");
      } catch {
        return false;
      }
    }, "agent descendants");
    assert.equal(runtime.isAlive(directory), true);
    const before = readJson(store.statePath(directory, "turn.json"));
    assert.equal(
      (await runtime.start(directory, "Duplicate", true, 2)).ok,
      false,
    );
    assert.deepEqual(readJson(store.statePath(directory, "turn.json")), before);
    const rows = captures(),
      pid = rows.find((row) => typeof row.pid === "number")?.pid as number;
    const descendant = rows.find((row) => typeof row.descendant === "number")
      ?.descendant as number;
    assert.ok(pid && descendant);
    runtime.stop(snapshot());
    // A responding wrapper must retain the lock while the agent ignores TERM.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(runtime.isAlive(directory), true);
    runtime.stop(snapshot(), { force: true });
    await waitFor(() => !runtime.isAlive(directory), "worker termination");
    for (const target of [pid, descendant])
      await waitFor(() => {
        try {
          process.kill(target, 0);
          return false;
        } catch {
          return true;
        }
      }, `process ${target} termination`);
    assert.equal(readFileSync(capture, "utf8").trim().split("\n").length, 2);
  } finally {
    runtime.stop(snapshot(), { force: true });
    await waitFor(() => !runtime.isAlive(directory), "worker cleanup");
  }
});
test("stream persistence failure terminates the worker and its descendants", async (t) => {
  const { store, directory, config, captures } = fixture(t, "state-error");
  mkdirSync(store.sessionReadyPath(directory, "codex-cli"), {
    recursive: true,
  });
  const runtime = new CodexCliRuntime(store, config);
  await runtime.start(directory, "Start", false, 1);
  await waitFor(
    () =>
      store.status(directory)?.is_error === true && !runtime.isAlive(directory),
    "failed persistence cleanup",
  );
  for (const row of captures()) {
    const pid = row.descendant ?? row.pid;
    if (typeof pid !== "number") continue;
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, "agent cleanup");
  }
});

test("Codex configuration rejects invalid policies and bypass is explicit", (t) => {
  const root = temporary(t),
    store = new FileStateStore(join(root, "var"));
  assert.throws(
    () =>
      new CodexCliRuntime(store, {
        approvalPolicy: 'never" -c unsafe=true',
      } as unknown as CodexRuntimeConfig),
    /approval policy/,
  );
  const system = join(root, "absent.md");
  mkdirSync(join(root, "unused"));
  const safe = buildCommand({
    ORCHESTRA_SYSTEM_PROMPT_FILE: system,
    ORCHESTRA_RUNTIME: "codex-cli",
    ORCHESTRA_PROMPT: "hello",
  });
  assert.ok(safe.args.includes("--sandbox"));
  assert.equal(
    safe.args.includes("--dangerously-bypass-approvals-and-sandbox"),
    false,
  );
  const bypass = buildCommand({
    ORCHESTRA_SYSTEM_PROMPT_FILE: system,
    ORCHESTRA_CODEX_DANGEROUS_BYPASS: "1",
  });
  assert.ok(bypass.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(bypass.args.includes("--sandbox"), false);
});
