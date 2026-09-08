import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
if (process.env.CAPTURE)
  appendFileSync(
    process.env.CAPTURE,
    JSON.stringify({
      args: process.argv.slice(2),
      allowed: process.env.ALLOWED_SECRET,
      blocked: process.env.BLOCKED_SECRET,
      pid: process.pid,
    }) + "\n",
  );
if (["sleep", "state-error"].includes(process.env.FAKE_MODE)) {
  const descendant = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  if (process.env.CAPTURE)
    appendFileSync(
      process.env.CAPTURE,
      JSON.stringify({ descendant: descendant.pid }) + "\n",
    );
  process.on("SIGTERM", () => {});
  if (process.env.FAKE_MODE === "state-error")
    emit({
      type: "thread.started",
      thread_id: "thread-with-failed-persistence",
    });
  setInterval(() => {}, 1000);
} else if (process.env.FAKE_MODE === "crash") {
  process.stderr.write("injected failure\n");
  process.exitCode = 7;
} else if (process.env.PATCHWAKE_RUNTIME === "claude-code") {
  emit({
    type: "result",
    total_cost_usd: 0.25,
    is_error: false,
    usage: { input_tokens: 2 },
    num_turns: 1,
  });
} else {
  emit({
    type: "thread.started",
    thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53",
  });
  if (process.env.FAKE_MODE === "error")
    emit({ type: "turn.failed", error: { message: "injected failure" } });
  else
    process.stdout.write(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    );
}
