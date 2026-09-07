# Moving from Python to TypeScript

The 0.2 implementation replaces the Python package with a strict TypeScript ESM
package. Node.js 22+ on macOS or Linux is required. Install with `npm ci`, compile
with `npm run build`, and verify with `npm test` and `npm run typecheck`.

## Existing deployments

1. Pause the old scheduler and let any active Python turns finish before
   replacing its checkout. Keep its worker scripts available until those turns
   have ended.
2. Keep the existing `var/` directory, task templates, and credential environment.
   Install dependencies and build the TypeScript checkout.
3. Run `npm start -- --status`, then `npm start -- --dry-run`, and inspect the
   task identities, assignments, routing, and proposed actions.
4. Replace the Python scheduler command with an absolute Node executable and
   `dist/examples/trello_github/orchestrator.js`. Resume one finite tick per
   interval on the same persistent host.

No state conversion is necessary. `task.json`, `turn.json`, `status.json`,
`seen.json`, `waits.json`, `restarts.json`, and session readiness files keep their
existing keys and meanings. Timestamps remain Unix seconds. The `claude-code`
and `codex-cli` session namespaces are unchanged. The native `fs-ext` binding
uses the same `flock` mechanism and lock paths as Python's `fcntl.flock`.
Keep state on durable local storage with OS file-lock support.

The new worker inherits the turn lock before startup and acknowledges actual
agent process creation before a cursor is consumed. It also holds the lock
through graceful shutdown until its child exits. Startup-grace tasks reserve
concurrency slots. These changes close startup/shutdown gaps while preserving
the observe → decide → act lifecycle.

## Extension code

| Python | TypeScript |
|---|---|
| `orchestra.ports` protocols | `orchestra/ports.ts` interfaces |
| `WorkItem(...)` | `workItem({ key, title, url, ... })` |
| `Activity(...)` | An object satisfying `Activity` |
| `TaskObservation(activities, waits)` | `observation(activities, waits)` |
| `HealthReport(OK, message)` | `health(OK, message)` |
| `EngineConfig(...)` | `config: { maxConcurrentTurns: 3, ... }` |
| `Path` | Absolute path strings |
| `is_alive`, `passthrough_env`, `dry_run` | `isAlive`, `passthroughEnv`, `dryRun` |
| `engine.tick()`, `engine.status()` | `await engine.tick()`, `await engine.status()` |

Provider and runtime methods may return a value or a promise. The engine awaits
them and preserves phase ordering. File-state methods are synchronous; tick
locking uses `await store.withTickLock(async () => { ... })` and covers the full
asynchronous invocation. Public snapshots and tick reports use camelCase; files
and audit JSON retain snake_case for compatibility.

Build against the public `agent-orchestra` exports or relative `.js` imports in
TypeScript source. `npm run build` emits JavaScript, declarations, and source
maps under `dist/`. The detached worker resolves relative to its compiled module
and therefore works from each task's separate working directory.

Tests use Node's built-in test runner, provider fixtures, temporary task
directories, and fake agent executables. They require no provider credentials
and perform no remote mutations. Python is not needed for tests or operation;
it may be needed by `node-gyp` while compiling the native lock dependency.
