/** File-backed state. All timestamps on disk are Unix seconds, never milliseconds. */
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import fsExt from "fs-ext";
import type {
  CompletionRecord,
  RunSnapshot,
  TurnRecord,
  WaitCondition,
  WorkItem,
} from "./models.js";
import { workItem } from "./models.js";
import { hasCode, isRecord, number, record, string } from "./json.js";
import { deriveState } from "./state-machine.js";

export const STATE_DIR = ".patchwake";
export const START_GRACE_SECONDS = 30;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$(?![\s\S])/;
const TEMPLATE_SUFFIXES = new Set([
  ".md",
  ".txt",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
]);
export class ClaimConflict extends Error {}
export class TickAlreadyRunning extends Error {}
export class LockBusy extends Error {}
export const nowSeconds = (): number => Date.now() / 1000;

export function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : null;
  } catch (error) {
    if (hasCode(error, "ENOENT") || error instanceof SyntaxError) return null;
    throw error;
  }
}
export function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export function writeJsonAtomic(path: string, value: object): void {
  writeTextAtomic(path, JSON.stringify(value, null, 2) + "\n");
}

/** Never delete lock files: a replacement inode would allow two owners. */
export function openLock(path: string): number {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    fsExt.flockSync(fd, "exnb");
  } catch (error) {
    closeSync(fd);
    if (hasCode(error, "EAGAIN", "EWOULDBLOCK"))
      throw new LockBusy(`lock held: ${path}`);
    throw error;
  }
  return fd;
}
export function acquireLock(path: string): () => void {
  const fd = openLock(path);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      closeSync(fd);
    }
  };
}
export function lockIsHeld(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  try {
    fsExt.flockSync(fd, "exnb");
    return false;
  } catch (error) {
    if (hasCode(error, "EAGAIN", "EWOULDBLOCK")) return true;
    throw error;
  } finally {
    closeSync(fd);
  }
}
function readText(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if (hasCode(error, "ENOENT")) return "";
    throw error;
  }
}

export class FileStateStore {
  readonly root: string;
  readonly workDir: string;
  readonly cacheDir: string;
  readonly templateDir: string | undefined;

  constructor(root: string, templateDir?: string) {
    this.root = resolve(root);
    this.workDir = join(this.root, "work");
    this.cacheDir = join(this.root, "cache");
    this.templateDir =
      templateDir === undefined ? undefined : resolve(templateDir);
  }
  async withTickLock<T>(run: () => T | Promise<T>): Promise<T> {
    let release: () => void;
    try {
      release = acquireLock(join(this.cacheDir, "tick.lock"));
    } catch (error) {
      if (error instanceof LockBusy)
        throw new TickAlreadyRunning("another patchwake tick is active");
      throw error;
    }
    try {
      return await run();
    } finally {
      release();
    }
  }
  taskDir(key: string): string {
    this.validateKey(key);
    return join(this.workDir, key);
  }
  statePath(taskDir: string, ...parts: string[]): string {
    return join(taskDir, STATE_DIR, ...parts);
  }
  claims(): Record<string, string> {
    if (!existsSync(this.workDir)) return {};
    return Object.fromEntries(
      readdirSync(this.workDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && SAFE_KEY.test(entry.name))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((entry) => [entry.name, join(this.workDir, entry.name)]),
    );
  }
  claim(item: WorkItem): string {
    const target = this.taskDir(item.key);
    mkdirSync(this.workDir, { recursive: true });
    if (existsSync(target)) throw new ClaimConflict(item.key);
    const staging = join(
      this.workDir,
      `.staging-${item.key}-${process.pid}-${randomUUID()}`,
    );
    try {
      if (this.templateDir && existsSync(this.templateDir))
        cpSync(this.templateDir, staging, { recursive: true });
      else mkdirSync(staging);
      this.substituteTemplates(staging, item);
      writeJsonAtomic(this.statePath(staging, "task.json"), {
        key: item.key,
        title: item.title,
        url: item.url,
        description: item.description,
        priority: item.priority,
        metadata: item.metadata,
        claimed_at: nowSeconds(),
      });
      // A completed claim is nonempty, so rename cannot overwrite a racing winner.
      renameSync(staging, target);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (existsSync(target)) throw new ClaimConflict(item.key);
      throw error;
    }
    return target;
  }
  tidyStaging(): string[] {
    if (!existsSync(this.workDir)) return [];
    const names = readdirSync(this.workDir, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith(".staging-"),
      )
      .map((entry) => entry.name);
    for (const name of names)
      rmSync(join(this.workDir, name), { recursive: true });
    return names;
  }
  workItem(taskDir: string): WorkItem | null {
    const value = readJson(this.statePath(taskDir, "task.json"));
    if (!value || typeof value.key !== "string") return null;
    return workItem({
      key: value.key,
      title: string(value.title),
      url: string(value.url),
      description: string(value.description),
      priority: number(value.priority, 100),
      metadata: record(value.metadata),
    });
  }
  bootstrapPrompt(taskDir: string): string {
    const path = join(taskDir, "PROMPT.md");
    return existsSync(path)
      ? readText(path)
      : "Read AGENTS.md and SYSTEM.md, then begin the assigned task.";
  }
  sessionPath(taskDir: string, runtimeName: string): string {
    this.validateNamespace(runtimeName);
    return this.statePath(taskDir, "sessions", `${runtimeName}.id`);
  }
  sessionReadyPath(taskDir: string, runtimeName: string): string {
    this.validateNamespace(runtimeName);
    return this.statePath(taskDir, "sessions", `${runtimeName}.ready`);
  }
  sessionId(taskDir: string, runtimeName = "default", create = true): string {
    const path = this.sessionPath(taskDir, runtimeName);
    const current = readText(path);
    if (current || !create) return current;
    const id = randomUUID();
    writeTextAtomic(path, id + "\n");
    return id;
  }
  writeSessionId(
    taskDir: string,
    runtimeName: string,
    sessionId: string,
  ): void {
    writeTextAtomic(
      this.sessionPath(taskDir, runtimeName),
      sessionId.trim() + "\n",
    );
  }
  markSessionReady(
    taskDir: string,
    runtimeName: string,
    sessionId: string,
  ): void {
    writeJsonAtomic(this.sessionReadyPath(taskDir, runtimeName), {
      session_id: sessionId,
    });
  }
  sessionReady(
    taskDir: string,
    runtimeName: string,
    sessionId: string,
  ): boolean {
    return (
      Boolean(sessionId) &&
      readJson(this.sessionReadyPath(taskDir, runtimeName))?.session_id ===
        sessionId
    );
  }
  turn(taskDir: string): TurnRecord {
    const row = readJson(this.statePath(taskDir, "turn.json"));
    if (!row || Object.keys(row).length === 0) return {};
    return {
      version: number(row.version, 1),
      sequence: number(row.sequence),
      prompt: string(row.prompt),
      pid: number(row.pid),
      started_at: number(row.started_at),
      resumed: row.resumed !== false,
      runtime: string(row.runtime),
    };
  }
  status(taskDir: string): CompletionRecord | null {
    const row = readJson(this.statePath(taskDir, "status.json"));
    if (!row) return null;
    return {
      version: number(row.version, 1),
      sequence: number(row.sequence, -1),
      exit_code: typeof row.exit_code === "number" ? row.exit_code : null,
      finished_at: number(row.finished_at),
      total_cost_usd:
        typeof row.total_cost_usd === "number" ? row.total_cost_usd : null,
      last_turn_cost_usd:
        typeof row.last_turn_cost_usd === "number"
          ? row.last_turn_cost_usd
          : null,
      usage: row.usage ?? null,
      num_turns: typeof row.num_turns === "number" ? row.num_turns : null,
      is_error: row.is_error == null ? null : Boolean(row.is_error),
      api_error_status: row.api_error_status ?? null,
    };
  }
  seen(taskDir: string): Record<string, number> {
    const streams = record(
      readJson(this.statePath(taskDir, "seen.json"))?.streams,
    );
    return Object.fromEntries(
      Object.entries(streams).map(([key, value]) => [key, number(value)]),
    );
  }
  writeSeen(taskDir: string, streams: Readonly<Record<string, number>>): void {
    writeJsonAtomic(this.statePath(taskDir, "seen.json"), {
      version: 1,
      streams,
    });
  }
  waits(taskDir: string): WaitCondition[] {
    const rows = readJson(this.statePath(taskDir, "waits.json"))?.waits;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(isRecord)
      .filter((row) => typeof row.name === "string")
      .map((row) => ({
        name: string(row.name),
        url: string(row.url),
        since: number(row.since),
        ref: string(row.ref),
      }));
  }
  writeWaits(taskDir: string, waits: readonly WaitCondition[]): void {
    writeJsonAtomic(this.statePath(taskDir, "waits.json"), {
      version: 1,
      waits: waits.map((wait) => ({
        name: wait.name,
        url: wait.url,
        since: wait.since ?? 0,
        ref: wait.ref ?? "",
      })),
    });
  }
  restartInfo(taskDir: string): { count: number; lastAt: number } {
    const row = readJson(this.statePath(taskDir, "restarts.json"));
    return { count: number(row?.count), lastAt: number(row?.last_at) };
  }
  recordRestart(taskDir: string, count: number, at: number): void {
    writeJsonAtomic(this.statePath(taskDir, "restarts.json"), {
      count,
      last_at: at,
    });
  }
  recordState(taskDir: string, state: string): void {
    writeTextAtomic(this.statePath(taskDir, "state"), state + "\n");
  }
  recordedState(taskDir: string): string {
    return readText(this.statePath(taskDir, "state"));
  }
  markStopping(taskDir: string, at: number): void {
    const path = this.statePath(taskDir, "stopping.json");
    if (!existsSync(path)) writeJsonAtomic(path, { at });
  }
  clearStopping(taskDir: string): void {
    rmSync(this.statePath(taskDir, "stopping.json"), { force: true });
    rmSync(this.statePath(taskDir, "state"), { force: true });
  }
  markGaveUp(taskDir: string, at: number): void {
    writeTextAtomic(this.statePath(taskDir, "gave-up"), `${at}\n`);
  }
  inspect(
    key: string,
    directory: string,
    waits: readonly WaitCondition[],
    alive: boolean,
    now: number,
  ): RunSnapshot {
    const turn = this.turn(directory),
      status = this.status(directory);
    const stopping = readJson(this.statePath(directory, "stopping.json"));
    const startedAt = turn.started_at ?? 0;
    let logMtime = 0;
    try {
      logMtime =
        statSync(this.statePath(directory, "agent.log")).mtimeMs / 1000;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    const restarts = this.restartInfo(directory);
    return {
      key,
      directory,
      alive,
      turn,
      status,
      waits,
      state: deriveState({
        alive,
        stopping: stopping !== null,
        gaveUp: existsSync(this.statePath(directory, "gave-up")),
        turn,
        status,
        waits: waits.length > 0,
        starting: startedAt !== 0 && now - startedAt < START_GRACE_SECONDS,
      }),
      silentFor:
        alive && (logMtime || startedAt)
          ? Math.max(0, now - Math.max(logMtime, startedAt))
          : 0,
      stoppingAt: number(stopping?.at),
      restarts: restarts.count,
      lastRestartAt: restarts.lastAt,
    };
  }
  private substituteTemplates(root: string, item: WorkItem): void {
    const values: Record<string, string> = {
      TASK_ID: item.key,
      TASK_TITLE: item.title,
      TASK_URL: item.url,
      TASK_DESCRIPTION: item.description,
    };
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name),
          stat = lstatSync(path);
        if (stat.isDirectory()) walk(path);
        else if (
          stat.isFile() &&
          TEMPLATE_SUFFIXES.has(extname(path).toLowerCase())
        ) {
          const bytes = readFileSync(path);
          let original: string;
          try {
            original = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            continue;
          }
          // One pass prevents task text containing another placeholder being reinterpreted.
          const rendered = original.replace(
            /\{\{(TASK_ID|TASK_TITLE|TASK_URL|TASK_DESCRIPTION)\}\}/g,
            (match, key: string) => values[key] ?? match,
          );
          if (rendered !== original) writeFileSync(path, rendered);
        }
      }
    };
    walk(root);
  }
  private validateKey(key: string): void {
    if (!SAFE_KEY.test(key))
      throw new Error(
        "task keys must be 1-128 safe path characters: letters, digits, dot, underscore, or hyphen",
      );
  }
  private validateNamespace(value: string): void {
    if (!SAFE_KEY.test(value))
      throw new Error(`unsafe runtime session namespace: ${value}`);
  }
}
