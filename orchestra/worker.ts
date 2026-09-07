/** Internal detached worker. FD 4 inherits the parent's already-held turn lock. */
import {
  closeSync,
  createReadStream,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, hasCode, isRecord } from "./json.js";
import { nowSeconds, writeJsonAtomic, writeTextAtomic } from "./state.js";

export function buildCommand(env: NodeJS.ProcessEnv = process.env): {
  executable: string;
  args: string[];
} {
  let standing = "";
  try {
    standing = readFileSync(
      env.ORCHESTRA_SYSTEM_PROMPT_FILE ?? "SYSTEM.md",
      "utf8",
    );
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  let extra: unknown;
  try {
    extra = JSON.parse(env.ORCHESTRA_EXTRA_ARGS ?? "[]");
  } catch {
    extra = [];
  }
  const extraArgs =
    Array.isArray(extra) &&
    extra.every((value: unknown) => typeof value === "string")
      ? (extra as string[])
      : [];
  const prompt = env.ORCHESTRA_PROMPT ?? "";
  const sessionId = env.ORCHESTRA_SESSION_ID ?? "";
  if (env.ORCHESTRA_RUNTIME === "claude-code") {
    const args = [
      "-p",
      prompt,
      env.ORCHESTRA_RESUME === "1" ? "--resume" : "--session-id",
      sessionId,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      env.ORCHESTRA_PERMISSION_MODE ?? "default",
    ];
    if (env.ORCHESTRA_MODEL) args.push("--model", env.ORCHESTRA_MODEL);
    args.push(...extraArgs);
    if (standing) args.push("--append-system-prompt", standing);
    return { executable: env.ORCHESTRA_AGENT_BIN ?? "claude", args };
  }
  const args = ["exec"];
  if (env.ORCHESTRA_CODEX_DANGEROUS_BYPASS === "1")
    args.push("--dangerously-bypass-approvals-and-sandbox");
  else {
    args.push("--sandbox", env.ORCHESTRA_CODEX_SANDBOX ?? "workspace-write");
    if ((env.ORCHESTRA_CODEX_NETWORK_ACCESS ?? "1") === "1")
      args.push("-c", "sandbox_workspace_write.network_access=true");
    if (env.ORCHESTRA_CODEX_APPROVAL_POLICY)
      args.push(
        "-c",
        `approval_policy=${JSON.stringify(env.ORCHESTRA_CODEX_APPROVAL_POLICY)}`,
      );
  }
  args.push("--json", "--color", "never");
  if ((env.ORCHESTRA_CODEX_SKIP_GIT_CHECK ?? "1") === "1")
    args.push("--skip-git-repo-check");
  if (env.ORCHESTRA_MODEL) args.push("--model", env.ORCHESTRA_MODEL);
  args.push(...extraArgs);
  if (env.ORCHESTRA_RESUME === "1") args.push("resume", sessionId);
  args.push(
    standing.trim()
      ? `Standing instructions for this turn:\n\n${standing.trim()}\n\nTask prompt:\n\n${prompt}`
      : prompt,
  );
  return { executable: env.ORCHESTRA_AGENT_BIN ?? "codex", args };
}
function notify(message: object): void {
  if (process.connected && process.send) process.send(message, () => {});
}
async function main(): Promise<number> {
  const stateDir = ".orchestra",
    logPath = join(stateDir, "agent.log");
  const sequence = Number(process.env.ORCHESTRA_TURN_SEQUENCE ?? 0);
  const result = {
    version: 1,
    sequence,
    exit_code: null as number | null,
    finished_at: 0,
    total_cost_usd: null as number | null,
    last_turn_cost_usd: null as number | null,
    usage: null as unknown,
    num_turns: null as number | null,
    is_error: null as boolean | null,
    api_error_status: null as unknown,
  };
  const isClaude = process.env.ORCHESTRA_RUNTIME === "claude-code";
  const consume = (line: string): void => {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(event)) return;
    if (isClaude && event.type === "result") {
      const cost =
        typeof event.total_cost_usd === "number" ? event.total_cost_usd : null;
      if (cost !== null)
        result.total_cost_usd = (result.total_cost_usd ?? 0) + cost;
      result.last_turn_cost_usd = cost;
      result.usage = event.usage ?? null;
      result.num_turns =
        typeof event.num_turns === "number" ? event.num_turns : null;
      result.is_error = event.is_error == null ? null : Boolean(event.is_error);
      result.api_error_status = event.api_error_status ?? null;
    } else if (!isClaude) {
      if (
        event.type === "thread.started" &&
        typeof event.thread_id === "string" &&
        event.thread_id
      ) {
        const sessionPath = process.env.ORCHESTRA_SESSION_PATH,
          readyPath = process.env.ORCHESTRA_SESSION_READY_PATH;
        if (!sessionPath || !readyPath)
          throw new Error("session paths missing");
        writeTextAtomic(sessionPath, event.thread_id + "\n");
        writeJsonAtomic(readyPath, { session_id: event.thread_id });
      } else if (event.type === "turn.completed")
        result.usage = event.usage ?? null;
      else if (event.type === "turn.failed" || event.type === "error") {
        result.is_error = true;
        result.api_error_status = event.type;
      }
    }
  };
  // Preserve Claude's accumulated cost across the append-only history, without
  // reusing a previous turn's success/error/usage when this turn emits no result.
  if (isClaude) {
    try {
      const lines = createInterface({
        input: createReadStream(logPath),
        crlfDelay: Infinity,
      });
      for await (const line of lines) consume(line);
      result.last_turn_cost_usd = null;
      result.usage = null;
      result.num_turns = null;
      result.is_error = null;
      result.api_error_status = null;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  } else result.is_error = false;
  const logFd = openSync(logPath, "a");
  // The group receives SIGTERM together. Keep the wrapper's lock until the
  // agent exits, so an agent ignoring SIGTERM can still be killed after grace.
  const keepLock = (): void => {};
  process.on("SIGTERM", keepLock);
  try {
    const command = buildCommand();
    const child = spawn(command.executable, command.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.once("spawn", () => notify({ type: "started" }));
    const decoder = new StringDecoder("utf8");
    let pending = "";
    const fatalStreamError = (error: unknown): never => {
      result.exit_code = 1;
      result.finished_at = nowSeconds();
      result.is_error = true;
      result.api_error_status = errorMessage(error);
      try {
        writeJsonAtomic(join(stateDir, "status.json"), result);
      } catch {
        /* A full or unavailable disk may prevent recording the failure. */
      }
      // This internal worker is the detached group leader. Terminate its whole
      // group before its lock can be released and leave no untracked agents.
      process.kill(-process.pid, "SIGKILL");
      process.exit(1);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        writeSync(logFd, chunk);
        pending += decoder.write(chunk);
        let index: number;
        while ((index = pending.indexOf("\n")) !== -1) {
          consume(pending.slice(0, index));
          pending = pending.slice(index + 1);
        }
      } catch (error) {
        fatalStreamError(error);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        writeSync(logFd, chunk);
      } catch (error) {
        fatalStreamError(error);
      }
    });
    const code = await new Promise<number>((resolveCode, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) =>
        resolveCode(exitCode ?? (signal ? 128 : 1)),
      );
    });
    pending += decoder.end();
    if (pending) consume(pending);
    result.exit_code = code;
    result.finished_at = nowSeconds();
    writeJsonAtomic(join(stateDir, "status.json"), result);
    return code;
  } catch (error) {
    result.exit_code = 1;
    result.finished_at = nowSeconds();
    result.is_error = true;
    result.api_error_status = errorMessage(error);
    writeJsonAtomic(join(stateDir, "status.json"), result);
    notify({ type: "failed", detail: errorMessage(error) });
    return 1;
  } finally {
    process.off("SIGTERM", keepLock);
    closeSync(logFd);
    closeSync(4);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      notify({ type: "failed", detail: errorMessage(error) });
      console.error(errorMessage(error));
      process.exitCode = 1;
    });
}
