import test from "node:test";
import assert from "node:assert/strict";
import {
  GitHubActivitySource,
  JsonHttp,
  mentions,
  TrelloBoard,
} from "../examples/trello_github/adapters.js";
import type { HttpClient } from "../examples/trello_github/adapters.js";
import { buildEngine } from "../examples/trello_github/orchestrator.js";
import { ClaudeCodeRuntime, CodexCliRuntime } from "../orchestra/runtime.js";
import { workItem } from "../orchestra/models.js";
import { temporary, work } from "./helpers.js";
class FixtureHttp implements HttpClient {
  readonly calls: string[] = [];
  constructor(
    readonly respond: (url: URL) => unknown | readonly [unknown, Headers],
  ) {}
  get(url: string): readonly [unknown, Headers] {
    this.calls.push(url);
    const value = this.respond(new URL(url));
    return Array.isArray(value) && value[1] instanceof Headers
      ? (value as unknown as readonly [unknown, Headers])
      : [value, new Headers()];
  }
}
const card = {
  id: "abcdef",
  shortLink: "xyZ12",
  name: "Do work",
  desc: "Details",
  url: "https://trello.test/c/xyZ12",
  idList: "ready",
  labels: [{ name: "repo:acme/widgets" }, { name: "priority:7" }],
};
const mapped = workItem({
  ...work(),
  metadata: { repository: "acme/widgets", branch: "agent-TASK-1" },
});
const pull = {
  number: 1,
  html_url: "https://github.test/acme/widgets/pull/1",
  updated_at: "2026-01-01T00:00:00Z",
  head: { sha: "abc" },
  state: "open",
};
test("Trello labels define repository and priority; only configured lists are assigned", async () => {
  const item = TrelloBoard.item(card);
  assert.equal(item.key, "TRELLO-xyZ12");
  assert.equal(item.priority, 7);
  assert.equal(item.metadata.repository, "acme/widgets");
  assert.equal(item.metadata.branch, "agent-TRELLO-xyZ12");
  const http = new FixtureHttp(() => [card, { ...card, idList: "backlog" }]);
  const board = new TrelloBoard({
    key: "key",
    token: "token",
    boardId: "board",
    readyListIds: ["ready"],
    http,
  });
  assert.deepEqual(await board.fetch(), [item]);
  assert.equal(http.calls.length, 1);
  assert.equal(
    new URL(http.calls[0] ?? "").searchParams.get("fields")?.includes("labels"),
    true,
  );
});
test("missing/partial credentials and malformed provider responses are errors, never empty assignment", async () => {
  const board = new TrelloBoard({
    key: "",
    token: "token",
    boardId: "board",
    readyListIds: ["ready"],
  });
  await assert.rejects(board.fetch(), /TRELLO_KEY/);
  assert.equal(board.health().status, "ERROR");
  const github = new GitHubActivitySource({ token: "token", botLogin: "" });
  await assert.rejects(github.observe([]), /GITHUB_BOT_LOGIN/);
  const malformed = new TrelloBoard({
    key: "key",
    token: "token",
    boardId: "board",
    readyListIds: ["ready"],
    http: new FixtureHttp(() => ({ error: "offline" })),
  });
  await assert.rejects(malformed.fetch(), /JSON array/);
});
test("pagination and mentions handle quoting, email addresses, and longer logins conservatively", () => {
  assert.equal(
    GitHubActivitySource.nextLink(
      '<https://api.github.test/p2>; rel="next", <https://api.github.test/p4>; rel="last"',
    ),
    "https://api.github.test/p2",
  );
  assert.equal(mentions("please check @build-bot, thanks", "build-bot"), true);
  assert.equal(
    mentions("> earlier @build-bot\nno new request", "build-bot"),
    false,
  );
  assert.equal(mentions("mail build-bot@example.test", "build-bot"), false);
  assert.equal(mentions("hello @build-bot-extra", "build-bot"), false);
});
test("GitHub follows comment and check pagination and reduces bodies to direction", async () => {
  const http = new FixtureHttp((url) => {
    if (url.pathname.endsWith("/pulls")) return [pull];
    if (url.pathname.includes("/issues/"))
      return [
        [{ id: 10, body: "please @bot check this", user: { login: "human" } }],
        new Headers({
          Link: '<https://api.github.test/comments-page-2>; rel="next"',
        }),
      ];
    if (url.pathname === "/comments-page-2")
      return [{ id: 11, body: "unaddressed", user: { login: "human" } }];
    if (url.pathname.endsWith("/comments"))
      return [{ id: 20, body: "inline feedback", user: { login: "reviewer" } }];
    if (url.pathname.endsWith("/reviews"))
      return [
        { id: 30, state: "CHANGES_REQUESTED", body: "review text" },
        { id: 31, state: "PENDING" },
      ];
    if (url.pathname.endsWith("/check-runs"))
      return [
        {
          check_runs: [{ id: 40, status: "completed", conclusion: "success" }],
        },
        new Headers({
          Link: '<https://api.github.test/checks-page-2>; rel="next"',
        }),
      ];
    if (url.pathname === "/checks-page-2")
      return {
        check_runs: [
          {
            id: 41,
            status: "completed",
            conclusion: "failure",
            html_url: "https://ci/failure",
          },
        ],
      };
    throw new Error(`unexpected fixture URL ${url}`);
  });
  const source = new GitHubActivitySource({
    token: "token",
    botLogin: "bot",
    apiUrl: "https://api.github.test",
    http,
  });
  const observed = (await source.observe([mapped]))[mapped.key];
  assert.ok(observed);
  assert.deepEqual(
    observed.activities.map((value) => value.kind),
    [
      "comment",
      "comment",
      "review-comment",
      "review-changes-requested",
      "ci-failed",
    ],
  );
  assert.equal(observed.activities[0]?.directed, true);
  assert.equal(observed.activities[1]?.directed, false);
  assert.equal(observed.activities[2]?.directed, true);
  assert.equal(observed.activities.at(-1)?.cursor, 41);
  assert.equal(
    observed.activities.at(-1)?.stream,
    "github:acme/widgets:1:checks:abc",
  );
  assert.equal(JSON.stringify(observed).includes("please @bot"), false);
  assert.deepEqual(observed.waits, []);
  assert.equal(
    new URL(http.calls[0] ?? "").searchParams.get("head"),
    "acme:agent-TASK-1",
  );
});
test("GitHub reports pending CI waits and merged activity", async () => {
  const http = new FixtureHttp((url) =>
    url.pathname.endsWith("/pulls")
      ? [
          {
            ...pull,
            state: "closed",
            merged_at: "2026-01-02T00:00:00Z",
            closed_at: "2026-01-02T00:00:00Z",
          },
        ]
      : url.pathname.endsWith("/check-runs")
        ? {
            check_runs: [
              {
                id: 1,
                status: "in_progress",
                started_at: "2026-01-01T00:00:00Z",
              },
            ],
          }
        : [],
  );
  const source = new GitHubActivitySource({
    token: "token",
    botLogin: "bot",
    http,
  });
  const result = (await source.observe([mapped]))[mapped.key];
  assert.equal(result?.activities[0]?.kind, "merged");
  assert.equal(result?.waits[0]?.name, "CI");
  assert.equal(
    result?.waits[0]?.since,
    Date.parse("2026-01-01T00:00:00Z") / 1000,
  );
});
test("unmapped tasks are visible in health without querying a fabricated repository", async () => {
  const http = new FixtureHttp(() => {
    throw new Error("should not query");
  });
  const source = new GitHubActivitySource({
    token: "token",
    botLogin: "bot",
    http,
  });
  assert.deepEqual((await source.observe([work()]))["TASK-1"], {
    activities: [],
    waits: [],
  });
  assert.equal(source.health().status, "WARNING");
  assert.equal(http.calls.length, 0);
});
test("pagination rejects foreign origins and loops before issuing a follow-up request", async () => {
  for (const next of [
    "https://evil.test/steal",
    "https://api.github.test/repos/acme/widgets/pulls?state=all&head=acme%3Aagent-TASK-1&per_page=100",
  ]) {
    const http = new FixtureHttp(() => [
      [pull],
      new Headers({ link: `<${next}>; rel="next"` }),
    ]);
    const source = new GitHubActivitySource({
      token: "token",
      botLogin: "bot",
      apiUrl: "https://api.github.test",
      http,
    });
    await assert.rejects(source.observe([mapped]), /pagination/);
    assert.equal(http.calls.length, 1);
  }
});
test("HTTP transport uses GET, timeout and explicit headers and redacts credential queries in errors", async () => {
  const client = new JsonHttp(
    { Authorization: "Bearer fixture" },
    async (_input, init) => {
      assert.equal(init?.method, "GET");
      assert.ok(init?.signal);
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer fixture",
      );
      return new Response("denied", { status: 401 });
    },
  );
  await assert.rejects(
    client.get("https://api.test/cards?key=private-key&token=private-token"),
    (error) =>
      error instanceof Error &&
      error.message === "GET https://api.test/cards: HTTP 401",
  );
});
test("composition selects either runtime, preserves credential allowlists, and rejects unknown engines", (t) => {
  const root = temporary(t);
  assert.ok(
    buildEngine({
      root,
      dryRun: true,
      env: { ORCHESTRA_AGENT_ENGINE: "claude" },
    }).runtime instanceof ClaudeCodeRuntime,
  );
  const codex = buildEngine({
    root,
    dryRun: true,
    env: {
      ORCHESTRA_AGENT_ENGINE: "codex",
      ORCHESTRA_AGENT_ENV: "GITHUB_TOKEN, TRELLO_KEY",
    },
  }).runtime;
  assert.ok(codex instanceof CodexCliRuntime);
  assert.deepEqual(codex.config.passthroughEnv, ["GITHUB_TOKEN", "TRELLO_KEY"]);
  assert.throws(
    () => buildEngine({ root, env: { ORCHESTRA_AGENT_ENGINE: "mystery" } }),
    /must be 'claude' or 'codex'/,
  );
});
