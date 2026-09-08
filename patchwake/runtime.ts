/** Detached CLI turns. The child inherits the OS lock before intent is published. */
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  statSync,
  rmSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { health, OK, ERROR, WARNING } from "./models.js";
import type {
  HealthReport,
  RunSnapshot,
  StartResult,
  TurnRecord,
} from "./models.js";
import type { AgentRuntime } from "./ports.js";
import {
  FileStateStore,
  LockBusy,
  lockIsHeld,
  nowSeconds,
  openLock,
  writeJsonAtomic,
} from "./state.js";
import { errorMessage, hasCode, isRecord } from "./json.js";

export const BASE_ENV_NAMES = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SSH_AUTH_SOCK",
] as const;
interface CommonRuntimeConfig {
  readonly executable?: string;
  readonly model?: string;
  readonly passthroughEnv?: readonly string[];
  readonly baseEnvNames?: readonly string[];
  readonly extraArgs?: readonly string[];
  readonly systemPromptFile?: string;
}
export interface ClaudeRuntimeConfig extends CommonRuntimeConfig {
  readonly permissionMode?: string;
}
export interface CodexRuntimeConfig extends CommonRuntimeConfig {
  readonly sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  readonly networkAccess?: boolean;
  readonly approvalPolicy?:
    "" | "never" | "on-request" | "untrusted" | "unless-trusted";
  readonly dangerouslyBypassApprovalsAndSandbox?: boolean;
  readonly skipGitRepoCheck?: boolean;
}
function findExecutable(name: string): string | null {
  const paths =
    isAbsolute(name) || name.includes("/")
      ? [resolve(name)]
      : (process.env.PATH ?? "")
          .split(delimiter)
          .map((directory) => resolve(directory, name));
  for (const path of paths) {
    try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return path;
    } catch (error) {
      if (!hasCode(error, "ENOENT", "EACCES", "ENOTDIR")) throw error;
    }
  }
  return null;
}

abstract class DetachedCliRuntime implements AgentRuntime {
  abstract readonly name: string;
  protected current = health(OK, "ready");
  constructor(readonly store: FileStateStore) {}
  health(): HealthReport {
    return this.current;
  }
  isAlive(taskDir: string): boolean {
    return lockIsHeld(this.store.statePath(taskDir, "turn.lock"));
  }
  abstract start(
    taskDir: string,
    prompt: string,
    resume: boolean,
    sequence: number,
  ): Promise<StartResult>;

  protected async spawnTurn(
    taskDir: string,
    prompt: string,
    resume: boolean,
    sequence: number,
    config: CommonRuntimeConfig,
    executableName: string,
    workerEnvironment: Record<string, string>,
  ): Promise<StartResult> {
    const executable = findExecutable(executableName);
    if (!executable) {
      const detail = `agent executable not found: ${executableName}`;
      this.current = health(ERROR, detail);
      return { ok: false, detail };
    }
    let lockFd: number;
    try {
      lockFd = openLock(this.store.statePath(taskDir, "turn.lock"));
    } catch (error) {
      if (error instanceof LockBusy)
        return { ok: false, detail: "another turn holds the lock" };
      throw error;
    }
    try {
      const intent: TurnRecord = {
        version: 1,
        sequence,
        pid: 0,
        started_at: nowSeconds(),
        resumed: resume,
        prompt,
        runtime: this.name,
      };
      writeJsonAtomic(this.store.statePath(taskDir, "turn.json"), intent);
      rmSync(this.store.statePath(taskDir, "status.json"), { force: true });
      const env: NodeJS.ProcessEnv = {};
      for (const name of [
        ...(config.baseEnvNames ?? BASE_ENV_NAMES),
        ...(config.passthroughEnv ?? []),
      ]) {
        if (process.env[name] !== undefined) env[name] = process.env[name];
      }
      Object.assign(env, workerEnvironment, {
        PATCHWAKE_RUNTIME: this.name,
        PATCHWAKE_AGENT_BIN: executable,
        PATCHWAKE_PROMPT: prompt,
        PATCHWAKE_RESUME: resume ? "1" : "0",
        PATCHWAKE_TURN_SEQUENCE: String(sequence),
        PATCHWAKE_MODEL: config.model ?? "",
        PATCHWAKE_EXTRA_ARGS: JSON.stringify(config.extraArgs ?? []),
        PATCHWAKE_SYSTEM_PROMPT_FILE: config.systemPromptFile ?? "SYSTEM.md",
      });
      const logFd = openSync(this.store.statePath(taskDir, "spawn.log"), "a");
      let child;
      try {
        child = spawn(
          process.execPath,
          [fileURLToPath(new URL("./worker.js", import.meta.url))],
          {
            cwd: taskDir,
            env,
            detached: true,
            stdio: ["ignore", logFd, logFd, "ipc", lockFd],
          },
        );
      } catch (error) {
        const detail = `spawn failed: ${errorMessage(error)}`;
        this.current = health(WARNING, detail);
        return { ok: false, detail };
      } finally {
        closeSync(logFd);
      }
      const result = await new Promise<StartResult>((resolveResult) => {
        let settled = false;
        const finish = (value: StartResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (child.connected) child.disconnect();
          child.unref();
          resolveResult(value);
        };
        const timer = setTimeout(() => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch (error) {
              if (!hasCode(error, "ESRCH"))
                this.current = health(WARNING, errorMessage(error));
            }
          }
          finish({
            ok: false,
            detail: "worker did not acknowledge agent startup",
          });
        }, 10_000);
        child.once("error", (error) =>
          finish({ ok: false, detail: `spawn failed: ${error.message}` }),
        );
        child.once("exit", (code, signal) =>
          finish({
            ok: false,
            detail: `worker exited before startup: ${code ?? signal}`,
          }),
        );
        child.once("message", (message: unknown) => {
          if (isRecord(message) && message.type === "started")
            finish({ ok: true });
          else
            finish({
              ok: false,
              detail:
                isRecord(message) && typeof message.detail === "string"
                  ? message.detail
                  : "invalid worker acknowledgement",
            });
        });
        // Register errors before writing the PID, since spawn failure is asynchronous.
        try {
          writeJsonAtomic(this.store.statePath(taskDir, "turn.json"), {
            ...intent,
            pid: child.pid ?? 0,
          });
        } catch (error) {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              /* It may already have exited. */
            }
          }
          finish({
            ok: false,
            detail: `could not persist worker PID: ${errorMessage(error)}`,
          });
        }
      });
      this.current = result.ok
        ? health(OK, `started task turn ${sequence}`)
        : health(WARNING, result.detail ?? "spawn failed");
      return result;
    } finally {
      closeSync(lockFd);
    }
  }
  stop(
    snapshot: RunSnapshot,
    { force = false }: { force?: boolean } = {},
  ): void {
    const pid = snapshot.turn.pid ?? 0;
    // A stale PID without a held lock must never be signalled.
    if (pid <= 0 || !this.isAlive(snapshot.directory)) return;
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    } catch (error) {
      if (hasCode(error, "ESRCH")) return;
      if (hasCode(error, "EPERM", "EACCES")) {
        this.current = health(
          WARNING,
          `could not stop pid ${pid}: ${errorMessage(error)}`,
        );
        return;
      }
      throw error;
    }
  }
}
export class ClaudeCodeRuntime extends DetachedCliRuntime {
  readonly name = "claude-code";
  constructor(
    store: FileStateStore,
    readonly config: ClaudeRuntimeConfig = {},
  ) {
    super(store);
  }
  start(
    taskDir: string,
    prompt: string,
    resume: boolean,
    sequence: number,
  ): Promise<StartResult> {
    const sessionId = this.store.sessionId(taskDir, this.name);
    const transcript = join(
      homedir(),
      ".claude",
      "projects",
      resolve(taskDir).replaceAll("/", "-"),
      `${sessionId}.jsonl`,
    );
    return this.spawnTurn(
      taskDir,
      prompt,
      resume || existsSync(transcript),
      sequence,
      this.config,
      this.config.executable ?? "claude",
      {
        PATCHWAKE_SESSION_ID: sessionId,
        PATCHWAKE_PERMISSION_MODE: this.config.permissionMode ?? "default",
      },
    );
  }
}
export class CodexCliRuntime extends DetachedCliRuntime {
  readonly name = "codex-cli";
  constructor(
    store: FileStateStore,
    readonly config: CodexRuntimeConfig = {},
  ) {
    super(store);
    if (
      !["read-only", "workspace-write", "danger-full-access"].includes(
        config.sandbox ?? "workspace-write",
      )
    )
      throw new Error(`invalid Codex sandbox: ${config.sandbox}`);
    if (
      !["", "never", "on-request", "untrusted", "unless-trusted"].includes(
        config.approvalPolicy ?? "never",
      )
    )
      throw new Error(
        `unsupported Codex approval policy: ${config.approvalPolicy}`,
      );
  }
  start(
    taskDir: string,
    prompt: string,
    _resume: boolean,
    sequence: number,
  ): Promise<StartResult> {
    const sessionId = this.store.sessionId(taskDir, this.name, false);
    const resume = this.store.sessionReady(taskDir, this.name, sessionId);
    return this.spawnTurn(
      taskDir,
      prompt,
      resume,
      sequence,
      this.config,
      this.config.executable ?? "codex",
      {
        PATCHWAKE_SESSION_ID: sessionId,
        PATCHWAKE_SESSION_PATH: this.store.sessionPath(taskDir, this.name),
        PATCHWAKE_SESSION_READY_PATH: this.store.sessionReadyPath(
          taskDir,
          this.name,
        ),
        PATCHWAKE_CODEX_SANDBOX: this.config.sandbox ?? "workspace-write",
        PATCHWAKE_CODEX_NETWORK_ACCESS:
          (this.config.networkAccess ?? true) ? "1" : "0",
        PATCHWAKE_CODEX_APPROVAL_POLICY: this.config.approvalPolicy ?? "never",
        PATCHWAKE_CODEX_DANGEROUS_BYPASS: this.config
          .dangerouslyBypassApprovalsAndSandbox
          ? "1"
          : "0",
        PATCHWAKE_CODEX_SKIP_GIT_CHECK:
          (this.config.skipGitRepoCheck ?? true) ? "1" : "0",
      },
    );
  }
}
