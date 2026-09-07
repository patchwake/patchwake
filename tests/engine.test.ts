import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Engine } from "../orchestra/engine.js";
import { health, observation, OK } from "../orchestra/models.js";
import type { Activity } from "../orchestra/models.js";
import { writeJsonAtomic } from "../orchestra/state.js";
import { FakeSource, makeEngine, work } from "./helpers.js";

const activity: Activity = {
  stream: "github:org/repo:1:comments",
  cursor: 7,
  kind: "comment",
  author: "reviewer",
  url: "https://event",
  directed: true,
};
test("task keys matching Object prototype properties retain ordinary assignment semantics", async (t) => {
  const { engine, runtime, board } = makeEngine(t, [
    work("constructor"),
    work("toString"),
  ]);
  await engine.tick();
  assert.equal(runtime.starts.length, 2);
  board.items = [];
  await engine.tick();
  assert.equal(runtime.starts.length, 2);
  assert.equal(runtime.stops.length, 2);
});
test("claims once then stays quiet without activity", async (t) => {
  const { engine, store, runtime } = makeEngine(t);
  assert.deepEqual((await engine.tick()).actions, ["fired TASK-1 (claim)"]);
  const directory = store.taskDir("TASK-1"),
    session = runtime.starts[0]?.sessionId;
  runtime.complete(directory);
  assert.ok(
    !(await engine.tick()).actions.some((action) => action.startsWith("fired")),
  );
  assert.equal(runtime.starts.length, 1);
  assert.equal(store.sessionId(directory, runtime.name), session);
});
test("activity resumes the same session and consumes cursors after spawn", async (t) => {
  const { engine, store, runtime, source } = makeEngine(t);
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  runtime.complete(directory);
  source.observations = { "TASK-1": observation([activity]) };
  assert.ok((await engine.tick()).actions.includes("fired TASK-1 (activity)"));
  assert.equal(runtime.starts[1]?.sessionId, runtime.starts[0]?.sessionId);
  assert.equal(runtime.starts[1]?.resume, true);
  assert.equal(runtime.starts[1]?.sequence, 2);
  assert.deepEqual(store.seen(directory), { [activity.stream]: 7 });
  runtime.complete(directory);
  await engine.tick();
  assert.equal(runtime.starts.length, 2);
});
test("failed spawn consumes neither activity nor retry ledger", async (t) => {
  const { engine, store, runtime, source } = makeEngine(t);
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  runtime.complete(directory);
  source.observations = { "TASK-1": observation([activity]) };
  runtime.fail = true;
  assert.ok(
    (await engine.tick()).actions.includes(
      "fire failed TASK-1: injected failure",
    ),
  );
  assert.deepEqual(store.seen(directory), {});
  assert.deepEqual(store.restartInfo(directory), { count: 0, lastAt: 0 });
});
test("board outage preserves running work and creates nothing; successful empty assignment stops it", async (t) => {
  const { engine, store, runtime, board } = makeEngine(t);
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  board.items = [work("TASK-2")];
  board.error = new Error("offline");
  assert.ok(
    (await engine.tick()).actions.includes(
      "board: assignment unknown; preserving every claim",
    ),
  );
  assert.equal(runtime.starts.length, 1);
  assert.equal(runtime.stops.length, 0);
  assert.equal(existsSync(store.statePath(directory, "stopping.json")), false);
  board.error = null;
  board.items = [];
  await engine.tick();
  assert.deepEqual(runtime.stops, [{ key: "TASK-1", force: false }]);
});
test("empty board stands down idle tasks, and reassignment clears stopping", async (t) => {
  const { engine, store, runtime, board, source } = makeEngine(t);
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  runtime.complete(directory);
  board.items = [];
  assert.ok((await engine.tick()).actions.includes("stood down TASK-1"));
  board.items = [work()];
  source.observations = { "TASK-1": observation([activity]) };
  const report = await engine.tick();
  assert.ok(report.actions.includes("re-armed TASK-1"));
  assert.ok(report.actions.includes("fired TASK-1 (activity)"));
});
test("priority and concurrency are deterministic", async (t) => {
  const { engine, runtime } = makeEngine(
    t,
    [work("LOW", 50), work("HIGH", 1)],
    { config: { maxConcurrentTurns: 1 } },
  );
  const report = await engine.tick();
  assert.equal(basename(runtime.starts[0]?.directory ?? ""), "HIGH");
  assert.equal(report.actions.at(-1), "deferred at concurrency cap: LOW");
});
test("failed claims do not use a concurrency slot", async (t) => {
  const { engine, runtime } = makeEngine(t, [work("A"), work("B")], {
    config: { maxConcurrentTurns: 1 },
  });
  runtime.fail = true;
  await engine.tick();
  assert.equal(runtime.starts.length, 2);
});
test("channel failures cannot prevent turns or later channels", async (t) => {
  const calls: string[] = [];
  const { engine, runtime } = makeEngine(t, [work()], {
    channels: [
      {
        name: "broken-channel",
        publish() {
          calls.push("broken");
          throw new Error("boom");
        },
        health() {
          return health(OK, "unused");
        },
      },
      {
        name: "last",
        publish(report) {
          calls.push("last");
          assert.equal(report.health["broken-channel"]?.status, "WARNING");
        },
        health() {
          return health(OK, "done");
        },
      },
    ],
  });
  const report = await engine.tick();
  assert.equal(runtime.starts.length, 1);
  assert.ok(
    report.actions.includes("broken-channel: notification failed: boom"),
  );
  assert.deepEqual(calls, ["broken", "last"]);
});
test("partial source outage freezes wait presentation while healthy activity can wake", async (t) => {
  const { store, board, runtime, source } = makeEngine(t);
  const broken = new FakeSource("other");
  const engine = new Engine({
    store,
    board,
    runtime,
    activitySources: [source, broken],
    channels: [],
    config: { stallAfterSeconds: 0 },
  });
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  runtime.complete(directory);
  store.writeWaits(directory, [
    { name: "CI", url: "https://ci", since: 10, ref: "org/repo#1" },
  ]);
  const before = readFileSync(store.statePath(directory, "waits.json"), "utf8");
  broken.error = new Error("offline");
  source.observations = { "TASK-1": observation([activity]) };
  const report = await engine.tick();
  assert.deepEqual(report.degradedSources, ["other"]);
  assert.equal(report.snapshots["TASK-1"]?.waits[0]?.name, "CI");
  assert.equal(
    readFileSync(store.statePath(directory, "waits.json"), "utf8"),
    before,
  );
  assert.ok(report.actions.includes("fired TASK-1 (activity)"));
});
test("self/undirected activity stays quiet and initial observations are consumed once", async (t) => {
  const { engine, source, runtime, store } = makeEngine(t);
  source.observations = {
    "TASK-1": observation([
      activity,
      { ...activity, stream: "self", cursor: 9, author: "bot" },
    ]),
  };
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  assert.match(runtime.starts[0]?.prompt ?? "", /https:\/\/event/);
  assert.deepEqual(store.seen(directory), { [activity.stream]: 7, self: 9 });
  runtime.complete(directory);
  source.observations = {
    "TASK-1": observation([
      { ...activity, cursor: 10, author: "bot" },
      { ...activity, cursor: 11, directed: false },
    ]),
  };
  await engine.tick();
  assert.equal(runtime.starts.length, 1);
});
test("retry preserves prompt and sequence, backs off, then gives up", async (t) => {
  const { engine, store, runtime, time } = makeEngine(t, [work()], {
    config: { maxRestarts: 2 },
  });
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  runtime.complete(directory, 1);
  await engine.tick();
  assert.equal(runtime.starts[1]?.prompt, runtime.starts[0]?.prompt);
  assert.equal(runtime.starts[1]?.sequence, 1);
  assert.equal(store.restartInfo(directory).count, 1);
  runtime.complete(directory, 1);
  assert.match(
    (await engine.tick()).actions.join("\n"),
    /backoff has 120s left/,
  );
  time.now = 221;
  await engine.tick();
  assert.equal(store.restartInfo(directory).count, 2);
  runtime.complete(directory, 1);
  assert.match(
    (await engine.tick()).actions.join("\n"),
    /gave up TASK-1 after 2 restart/,
  );
  assert.equal((await engine.status())["TASK-1"]?.state, "GAVE_UP");
});
test("stall kill and expired stop grace signal the process group forcibly", async (t) => {
  const { engine, runtime, board, time } = makeEngine(t, [work()], {
    config: { stallAfterSeconds: 900, stopGraceSeconds: 120 },
  });
  await engine.tick();
  runtime.ignoreStops = true;
  board.items = [];
  await engine.tick();
  time.now = 221;
  await engine.tick();
  assert.deepEqual(runtime.stops.slice(0, 2), [
    { key: "TASK-1", force: false },
    { key: "TASK-1", force: true },
  ]);
  board.items = [work()];
  time.now = 222;
  await engine.tick();
  time.now = 1101;
  assert.match(
    (await engine.tick()).actions.join("\n"),
    /killed TASK-1: silent for 1001s/,
  );
});
test("startup grace reserves a slot and does not start a duplicate turn", async (t) => {
  const { engine, store, runtime, source } = makeEngine(
    t,
    [work(), work("TASK-2")],
    { config: { maxConcurrentTurns: 1 } },
  );
  const directory = store.claim(work());
  writeJsonAtomic(store.statePath(directory, "turn.json"), {
    sequence: 1,
    started_at: 99,
    pid: 10,
  });
  source.observations = { "TASK-1": observation([activity]) };
  await engine.tick();
  assert.equal(runtime.starts.length, 0);
});
test("dry run plans without changing claims, cursors, waits, or agent state", async (t) => {
  const { engine, store, runtime, source } = makeEngine(t);
  assert.match(
    (await engine.tick({ dryRun: true })).actions.join("\n"),
    /would claim and fire/,
  );
  assert.deepEqual(store.claims(), {});
  assert.equal(runtime.starts.length, 0);
  await engine.tick();
  const directory = store.taskDir("TASK-1");
  runtime.complete(directory);
  source.observations = {
    "TASK-1": observation([activity], [{ name: "CI", url: "https://ci" }]),
  };
  const before = readFileSync(store.statePath(directory, "turn.json"), "utf8");
  await engine.tick({ dryRun: true });
  assert.equal(runtime.starts.length, 1);
  assert.deepEqual(store.seen(directory), {});
  assert.deepEqual(store.waits(directory), []);
  assert.equal(
    readFileSync(store.statePath(directory, "turn.json"), "utf8"),
    before,
  );
});
