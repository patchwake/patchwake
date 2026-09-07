import test from "node:test";
import assert from "node:assert/strict";
import {
  activityPrompt,
  advanceSeen,
  freshActivities,
  sortCandidates,
} from "../orchestra/policy.js";
import type { Activity } from "../orchestra/models.js";

const event = (overrides: Partial<Activity> = {}): Activity => ({
  stream: "github:r:1:comments",
  cursor: 1,
  kind: "comment",
  author: "human",
  url: "https://example.test/comment/1",
  ref: "org/repo#1",
  directed: true,
  ...overrides,
});
test("new activity filters equal cursors, self events and undirected comments; unknown direction wakes", () => {
  const events = [
    event(),
    event({ cursor: 3, author: "bot" }),
    event({ cursor: 4, directed: false }),
    event({ cursor: 5, directed: null }),
  ];
  assert.deepEqual(
    freshActivities(
      events,
      { "github:r:1:comments": 1 },
      new Set(["bot"]),
      true,
    ),
    [events[3]],
  );
  assert.deepEqual(freshActivities(events, {}, new Set(), false), events);
});
test("cursor advancement is monotonic, independent per stream and safe for arbitrary stream keys", () => {
  assert.deepEqual(
    advanceSeen({ a: 4 }, [
      event({ cursor: 3, stream: "a" }),
      event({ cursor: 2, stream: "b" }),
    ]),
    { a: 4, b: 2 },
  );
  assert.deepEqual(
    advanceSeen({}, [event({ stream: "__proto__", cursor: 7 })]),
    JSON.parse('{"__proto__":7}'),
  );
});
test("pointer prompt groups duplicates and orders remote locations by earliest cursor", () => {
  const prompt = activityPrompt([
    event({ cursor: 4 }),
    event({ cursor: 2 }),
    event({ cursor: 1, ref: "other#2", thread: "review" }),
  ]);
  assert.match(prompt, /2 comment event\(s\) from human/);
  assert.ok(prompt.indexOf("other#2") < prompt.indexOf("org/repo#1"));
  assert.match(prompt, /https:\/\/example.test\/comment\/1/);
  assert.match(prompt, /Read the authoritative content/);
});
test("retries precede activity and new claims; equal priorities use stable keys", () => {
  assert.deepEqual(
    sortCandidates([
      { key: "Z", kind: "claim", priority: 1 },
      { key: "A", kind: "bootstrap", priority: 1 },
      { key: "B", kind: "activity", priority: 100 },
      { key: "C", kind: "retry", priority: 1000 },
    ]).map((value) => value.key),
    ["C", "B", "A", "Z"],
  );
});
