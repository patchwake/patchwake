import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, FileStateStore, health, OK } from "patchwake";
import { TrelloBoard } from "./dist/workflow/adapters.js";
import { buildEngine } from "./dist/workflow/orchestrator.js";

test("fixture assignment is normalized and a dry tick never starts an agent", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "patchwake-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const board = new TrelloBoard({
    key: "fixture",
    token: "fixture",
    boardId: "fixture",
    readyListIds: ["ready"],
    http: {
      get: () => [
        [
          {
            id: "fixture",
            shortLink: "task1",
            name: "Fixture task",
            desc: "",
            url: "https://trello.test/c/task1",
            idList: "ready",
            labels: [{ name: "repo:acme/widgets" }],
          },
        ],
        new Headers(),
      ],
    },
  });
  const items = await board.fetch();
  assert.equal(items[0].key, "TRELLO-task1");
  assert.equal(items[0].metadata.repository, "acme/widgets");
  const configured = buildEngine({ root, env: {} });
  const store = new FileStateStore(join(root, "var"));
  const engine = new Engine({
    board,
    store,
    activitySources: [],
    channels: [],
    config: configured.config,
    runtime: {
      name: "fixture",
      health: () => health(OK, "fixture"),
      isAlive: () => false,
      start: () => assert.fail("Dry runs must not start agent turns"),
      stop: () => assert.fail("Dry runs must not stop agent turns"),
    },
  });
  const report = await engine.tick({ dryRun: true });
  assert.ok(report.actions.length > 0);
  assert.deepEqual(store.claims(), {});
});

test("missing board credentials are an error, not an empty plate", async () => {
  const board = new TrelloBoard({
    key: "",
    token: "",
    boardId: "",
    readyListIds: [],
  });
  await assert.rejects(board.fetch(), /TRELLO_KEY/);
});
