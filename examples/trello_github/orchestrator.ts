#!/usr/bin/env node
/** Executable Trello + GitHub composition. One invocation performs one tick. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";
import {
  ConsoleChannel,
  HealthChangeChannel,
  JsonlAuditChannel,
} from "../../patchwake/channels.js";
import { Engine } from "../../patchwake/engine.js";
import { ClaudeCodeRuntime, CodexCliRuntime } from "../../patchwake/runtime.js";
import type { CodexRuntimeConfig } from "../../patchwake/runtime.js";
import type { AgentRuntime } from "../../patchwake/ports.js";
import { FileStateStore, TickAlreadyRunning } from "../../patchwake/state.js";
import { errorMessage } from "../../patchwake/json.js";
import { GitHubActivitySource, TrelloBoard } from "./adapters.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const text = env[name];
  return text !== undefined &&
    /^[+-]?\d+$/.test(text.trim()) &&
    Number.isSafeInteger(Number(text))
    ? Math.max(0, Number(text))
    : fallback;
}
const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
export function buildEngine({
  dryRun = false,
  root = ROOT,
  env = process.env,
}: {
  dryRun?: boolean;
  root?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Engine {
  const store = new FileStateStore(
    join(root, "var"),
    join(root, "templates", "task"),
  );
  const board = new TrelloBoard({
    key: env.TRELLO_KEY ?? "",
    token: env.TRELLO_TOKEN ?? "",
    boardId: env.TRELLO_BOARD_ID ?? "",
    readyListIds: list(env.TRELLO_READY_LIST_IDS),
  });
  const github = new GitHubActivitySource({
    token: env.GITHUB_TOKEN ?? "",
    botLogin: env.GITHUB_BOT_LOGIN ?? "",
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
  });
  const engineName = (env.PATCHWAKE_AGENT_ENGINE ?? "claude").toLowerCase();
  const common = {
    model: env.PATCHWAKE_MODEL ?? "",
    passthroughEnv: list(env.PATCHWAKE_AGENT_ENV),
  };
  let runtime: AgentRuntime;
  if (engineName === "claude")
    runtime = new ClaudeCodeRuntime(store, {
      ...common,
      executable: env.CLAUDE_BIN ?? "claude",
      permissionMode: env.PATCHWAKE_PERMISSION_MODE ?? "default",
    });
  else if (engineName === "codex") {
    const sandbox = env.PATCHWAKE_CODEX_SANDBOX ?? "workspace-write";
    if (
      sandbox !== "read-only" &&
      sandbox !== "workspace-write" &&
      sandbox !== "danger-full-access"
    )
      throw new Error(`invalid Codex sandbox: ${sandbox}`);
    const config: CodexRuntimeConfig = {
      ...common,
      executable: env.CODEX_BIN ?? "codex",
      sandbox,
      networkAccess: (env.PATCHWAKE_CODEX_NETWORK_ACCESS ?? "1") === "1",
      dangerouslyBypassApprovalsAndSandbox:
        env.PATCHWAKE_CODEX_DANGEROUS_BYPASS === "1",
    };
    runtime = new CodexCliRuntime(store, config);
  } else
    throw new Error(
      `PATCHWAKE_AGENT_ENGINE must be 'claude' or 'codex', not '${engineName}'`,
    );
  return new Engine({
    board,
    activitySources: [github],
    runtime,
    store,
    channels: [
      new ConsoleChannel(),
      new JsonlAuditChannel(join(root, "var", "logs", "ticks.jsonl")),
      new HealthChangeChannel(join(store.cacheDir, "health.json")),
    ],
    config: {
      maxConcurrentTurns: integer(env, "PATCHWAKE_MAX_TURNS", 3),
      stallAfterSeconds: integer(env, "PATCHWAKE_STALL_AFTER", 900),
      maxRestarts: integer(env, "PATCHWAKE_MAX_RESTARTS", 5),
      requireDirectedActivity: (env.PATCHWAKE_REQUIRE_DIRECTED ?? "1") === "1",
      botIdentities: new Set([env.GITHUB_BOT_LOGIN ?? ""].filter(Boolean)),
      dryRun,
    },
  });
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean" },
      status: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: patchwake-trello-github [--dry-run] [--status]\nRun one Trello + GitHub orchestration tick.",
    );
    return 0;
  }
  const engine = buildEngine({ dryRun: values["dry-run"] ?? false });
  if (values.status) {
    for (const [key, snapshot] of Object.entries(await engine.status()).sort(
      ([a], [b]) => (a < b ? -1 : 1),
    ))
      console.log(`${key}\t${snapshot.state}`);
    return 0;
  }
  try {
    await engine.tick();
  } catch (error) {
    if (error instanceof TickAlreadyRunning) {
      console.log(error.message);
      return 2;
    }
    throw error;
  }
  return 0;
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    });
}
