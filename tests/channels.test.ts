import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HealthChangeChannel,
  healthChanged,
  JsonlAuditChannel,
} from "../orchestra/channels.js";
import { health, ERROR, OK } from "../orchestra/models.js";
import type { HealthReport, TickReport } from "../orchestra/models.js";
import { temporary } from "./helpers.js";
const report = (
  values: Record<string, HealthReport>,
  dryRun = false,
): TickReport => ({
  startedAt: 1,
  finishedAt: 2,
  actions: [],
  snapshots: {},
  health: values,
  degradedSources: [],
  dryRun,
});
test("health policy ignores healthy message churn and reports changed errors", () => {
  assert.equal(
    healthChanged(
      { github: health(OK, "one PR") },
      "github",
      health(OK, "two PRs"),
    ),
    false,
  );
  assert.equal(
    healthChanged(
      { github: health(OK, "one PR") },
      "github",
      health(ERROR, "offline"),
    ),
    true,
  );
  assert.equal(
    healthChanged(
      { github: health(ERROR, "offline") },
      "github",
      health(ERROR, "unauthorized"),
    ),
    true,
  );
});
test("health channel is edge triggered and dry runs are read only", async (t) => {
  const sent: string[] = [],
    path = join(temporary(t), "health.json");
  const channel = new HealthChangeChannel(path, async (message) => {
    sent.push(message);
  });
  await channel.publish(report({ github: health(OK, "one PR") }));
  await channel.publish(report({ github: health(OK, "two PRs") }));
  assert.equal(sent.length, 1);
  const before = readFileSync(path, "utf8");
  await channel.publish(report({ github: health(ERROR, "offline") }, true));
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(sent.length, 1);
});
test("failed health delivery does not consume changes", async (t) => {
  const path = join(temporary(t), "health.json");
  const channel = new HealthChangeChannel(path, async () => {
    throw new Error("offline");
  });
  await assert.rejects(
    channel.publish(report({ github: health(OK, "ready") })),
    /offline/,
  );
  assert.equal(existsSync(path), false);
});
test("audit output retains existing field names and appends; dry run does not write", (t) => {
  const path = join(temporary(t), "audit.jsonl"),
    channel = new JsonlAuditChannel(path);
  channel.publish(report({}, true));
  assert.equal(existsSync(path), false);
  channel.publish(report({}));
  channel.publish(report({}));
  const lines = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line: string) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.started_at, 1);
  assert.deepEqual(lines[0]?.degraded_sources, []);
});
