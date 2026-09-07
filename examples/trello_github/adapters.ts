/** Read-only Trello and GitHub transports and normalization. */
import {
  health,
  ERROR,
  OK,
  WARNING,
  observation,
  workItem,
} from "../../orchestra/models.js";
import type {
  Activity,
  HealthReport,
  TaskObservation,
  WaitCondition,
  WorkItem,
} from "../../orchestra/models.js";
import type {
  ActivitySource,
  Awaitable,
  Board,
} from "../../orchestra/ports.js";
import { isRecord, record, string } from "../../orchestra/json.js";

export interface HttpClient {
  get(url: string): Awaitable<readonly [unknown, Headers]>;
}
export class JsonHttp implements HttpClient {
  constructor(
    private readonly headers: Record<string, string> = {},
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async get(url: string): Promise<readonly [unknown, Headers]> {
    const safeUrl = url.split("?")[0];
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: { Accept: "application/json", ...this.headers },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch {
      throw new Error(`GET ${safeUrl}: transport failed or timed out`);
    }
    if (!response.ok)
      throw new Error(`GET ${safeUrl}: HTTP ${response.status}`);
    try {
      return [(await response.json()) as unknown, response.headers];
    } catch {
      throw new Error(`GET ${safeUrl}: invalid JSON response`);
    }
  }
}
export function timestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}
export function mentions(body: string, login: string): boolean {
  if (!body || !login) return false;
  const unquoted = body
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![A-Za-z0-9_.-])@${escaped}(?![A-Za-z0-9_-])`,
    "i",
  ).test(unquoted);
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord))
    throw new Error("expected a JSON array of objects");
  return value;
}
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid provider event id");
  return value;
}

export interface TrelloBoardConfig {
  key: string;
  token: string;
  boardId: string;
  readyListIds: Iterable<string>;
  http?: HttpClient;
}
export class TrelloBoard implements Board {
  readonly name = "trello";
  private current = health(OK, "not observed yet");
  private readonly http: HttpClient;
  private readonly readyListIds: ReadonlySet<string>;
  constructor(private readonly config: TrelloBoardConfig) {
    this.http = config.http ?? new JsonHttp();
    this.readyListIds = new Set([...config.readyListIds].filter(Boolean));
  }
  async fetch(): Promise<WorkItem[]> {
    const missing = Object.entries({
      TRELLO_KEY: this.config.key,
      TRELLO_TOKEN: this.config.token,
      TRELLO_BOARD_ID: this.config.boardId,
      TRELLO_READY_LIST_IDS: this.readyListIds.size,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) {
      this.current = health(ERROR, `missing ${missing.join(", ")}`);
      throw new Error(this.current.message);
    }
    const query = new URLSearchParams({
      key: this.config.key,
      token: this.config.token,
      fields: "id,shortLink,name,desc,url,idList,labels,pos,dateLastActivity",
    });
    const [page] = await this.http.get(
      `https://api.trello.com/1/boards/${encodeURIComponent(this.config.boardId)}/cards?${query}`,
    );
    const items = rows(page)
      .filter((row) => this.readyListIds.has(string(row.idList)))
      .map((row) => TrelloBoard.item(row));
    this.current = health(OK, `${items.length} assigned card(s)`);
    return items;
  }
  health(): HealthReport {
    return this.current;
  }
  static item(row: Record<string, unknown>): WorkItem {
    const labels = Array.isArray(row.labels)
      ? row.labels.map((label) => string(record(label).name))
      : [];
    const repository =
      labels
        .find((label) => label.toLowerCase().startsWith("repo:"))
        ?.slice(5)
        .trim() ?? "";
    let priority = 100;
    for (const label of labels) {
      if (label.toLowerCase().startsWith("priority:")) {
        const text = label.slice(label.indexOf(":") + 1).trim();
        if (/^[+-]?\d+$/.test(text) && Number.isSafeInteger(Number(text)))
          priority = Number(text);
      }
    }
    const stable = string(row.shortLink) || string(row.id);
    if (!stable) throw new Error("Trello card has no stable id");
    return workItem({
      key: `TRELLO-${stable}`,
      title: string(row.name),
      description: string(row.desc),
      url: string(row.url),
      priority,
      metadata: {
        trello_card_id: row.id,
        trello_list_id: row.idList ?? "",
        repository,
        branch: `agent-TRELLO-${stable}`,
      },
    });
  }
}

export interface GitHubActivityConfig {
  token: string;
  botLogin: string;
  apiUrl?: string;
  http?: HttpClient;
}
export class GitHubActivitySource implements ActivitySource {
  readonly name = "github";
  private current = health(OK, "not observed yet");
  private readonly http: HttpClient;
  private readonly apiUrl: string;
  constructor(private readonly config: GitHubActivityConfig) {
    this.apiUrl = (config.apiUrl ?? "https://api.github.com").replace(
      /\/+$/,
      "",
    );
    this.http =
      config.http ??
      new JsonHttp({
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agent-orchestra-example",
      });
  }
  async observe(
    items: readonly WorkItem[],
  ): Promise<Record<string, TaskObservation>> {
    const missing = Object.entries({
      GITHUB_TOKEN: this.config.token,
      GITHUB_BOT_LOGIN: this.config.botLogin,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) {
      this.current = health(ERROR, `missing ${missing.join(", ")}`);
      throw new Error(this.current.message);
    }
    const result = new Map<string, TaskObservation>();
    let pullsSeen = 0,
      unmapped = 0;
    for (const item of items) {
      const repository = string(item.metadata.repository),
        branch = string(item.metadata.branch) || `agent-${item.key}`;
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        unmapped++;
        result.set(item.key, observation());
        continue;
      }
      const owner = repository.split("/")[0] ?? "";
      const pulls = await this.pages(`/repos/${repository}/pulls`, {
        state: "all",
        head: `${owner}:${branch}`,
        per_page: "100",
      });
      const pull = pulls.reduce<Record<string, unknown> | undefined>(
        (latest, row) =>
          !latest || timestamp(row.updated_at) > timestamp(latest.updated_at)
            ? row
            : latest,
        undefined,
      );
      if (!pull) {
        result.set(item.key, observation());
        continue;
      }
      pullsSeen++;
      result.set(item.key, await this.observePull(repository, pull));
    }
    this.current = unmapped
      ? health(
          WARNING,
          `observed ${pullsSeen} pull request(s); ${unmapped} task(s) lack a repo:owner/name label`,
        )
      : health(OK, `observed ${pullsSeen} pull request(s)`);
    return Object.fromEntries(result);
  }
  health(): HealthReport {
    return this.current;
  }
  private async observePull(
    repository: string,
    pull: Record<string, unknown>,
  ): Promise<TaskObservation> {
    const pullNumber = id(pull.number),
      ref = `${repository}#${pullNumber}`,
      activities: Activity[] = [];
    const pullUrl = string(pull.html_url);
    for (const row of await this.pages(
      `/repos/${repository}/issues/${pullNumber}/comments`,
      { per_page: "100" },
    )) {
      activities.push({
        stream: `github:${repository}:${pullNumber}:issue-comments`,
        cursor: id(row.id),
        kind: "comment",
        author: string(record(row.user).login),
        url: string(row.html_url) || pullUrl,
        ref,
        directed: mentions(string(row.body), this.config.botLogin),
      });
    }
    for (const row of await this.pages(
      `/repos/${repository}/pulls/${pullNumber}/comments`,
      { per_page: "100" },
    )) {
      activities.push({
        stream: `github:${repository}:${pullNumber}:review-comments`,
        cursor: id(row.id),
        kind: "review-comment",
        author: string(record(row.user).login),
        url: string(row.html_url) || pullUrl,
        ref,
        directed: true,
      });
    }
    for (const row of await this.pages(
      `/repos/${repository}/pulls/${pullNumber}/reviews`,
      { per_page: "100" },
    )) {
      const state = string(row.state).toLowerCase();
      if (!["approved", "changes_requested", "commented"].includes(state))
        continue;
      activities.push({
        stream: `github:${repository}:${pullNumber}:reviews`,
        cursor: id(row.id),
        kind: `review-${state.replaceAll("_", "-")}`,
        author: string(record(row.user).login),
        url: string(row.html_url) || pullUrl,
        ref,
        directed: true,
      });
    }
    if (pull.state === "closed")
      activities.push({
        stream: `github:${repository}:${pullNumber}:state`,
        cursor: timestamp(pull.closed_at || pull.updated_at),
        kind: pull.merged_at ? "merged" : "closed",
        author: "",
        url: pullUrl,
        ref,
      });
    const head = string(record(pull.head).sha);
    const waits: WaitCondition[] = [];
    if (head) {
      const checks = await this.checkRuns(repository, head),
        active = checks.filter((row) => row.status !== "completed");
      if (active.length)
        waits.push({
          name: "CI",
          url: pullUrl,
          since: Math.min(
            ...active.map((row) => timestamp(row.started_at || row.created_at)),
          ),
          ref,
        });
      else if (checks.length) {
        const failures = checks.filter(
          (row) =>
            !["success", "neutral", "skipped"].includes(string(row.conclusion)),
        );
        const chosen = failures.length ? failures : checks;
        const latest = chosen.reduce<Record<string, unknown> | undefined>(
          (a, b) => (!a || id(b.id) > id(a.id) ? b : a),
          undefined,
        );
        if (latest)
          activities.push({
            stream: `github:${repository}:${pullNumber}:checks:${head}`,
            cursor: id(latest.id),
            kind: failures.length ? "ci-failed" : "ci-passed",
            author: "",
            url: string(latest.html_url) || pullUrl,
            ref,
          });
      }
    }
    return observation(activities, waits);
  }
  private async checkRuns(
    repository: string,
    head: string,
  ): Promise<Record<string, unknown>[]> {
    return this.paginate(
      `${this.apiUrl}/repos/${repository}/commits/${encodeURIComponent(head)}/check-runs?per_page=100`,
      (value) => rows(record(value).check_runs),
    );
  }
  private async pages(
    path: string,
    query: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    return this.paginate(
      `${this.apiUrl}${path}?${new URLSearchParams(query)}`,
      rows,
    );
  }
  private async paginate(
    firstUrl: string,
    extract: (page: unknown) => Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [],
      visited = new Set<string>();
    let url = firstUrl;
    while (url) {
      if (new URL(url).origin !== new URL(this.apiUrl).origin)
        throw new Error("GitHub pagination changed API origin");
      if (visited.has(url)) throw new Error("GitHub pagination cycle");
      visited.add(url);
      const [page, headers] = await this.http.get(url);
      result.push(...extract(page));
      url = GitHubActivitySource.nextLink(headers.get("link") ?? "");
    }
    return result;
  }
  static nextLink(header: string): string {
    for (const part of header.split(",")) {
      const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"/.exec(part);
      if (match?.[2] === "next") return match[1] ?? "";
    }
    return "";
  }
}
