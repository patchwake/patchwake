#!/usr/bin/env python3
"""Detached Codex CLI turn with streaming session capture."""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import time

STATE_DIR = ".orchestra"


def _replace_text(path: str, value: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = f"{path}.{os.getpid()}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(value.rstrip() + "\n")
    os.replace(temporary, path)


def _mark_session(session_id: str) -> None:
    session_path = os.environ["ORCHESTRA_SESSION_PATH"]
    ready_path = os.environ["ORCHESTRA_SESSION_READY_PATH"]
    _replace_text(session_path, session_id)
    _replace_text(ready_path, json.dumps({"session_id": session_id}))


def _prompt() -> str:
    prompt = os.environ["ORCHESTRA_PROMPT"]
    system_file = os.environ.get("ORCHESTRA_SYSTEM_PROMPT_FILE", "SYSTEM.md")
    try:
        with open(system_file, encoding="utf-8") as handle:
            standing = handle.read().strip()
    except OSError:
        standing = ""
    if not standing:
        return prompt
    return (
        f"Standing instructions for this turn:\n\n{standing}\n\n"
        f"Task prompt:\n\n{prompt}"
    )


def _command() -> list[str]:
    command = [os.environ.get("ORCHESTRA_AGENT_BIN", "codex"), "exec"]
    if os.environ.get("ORCHESTRA_CODEX_DANGEROUS_BYPASS") == "1":
        command.append("--dangerously-bypass-approvals-and-sandbox")
    else:
        command += [
            "--sandbox",
            os.environ.get("ORCHESTRA_CODEX_SANDBOX", "workspace-write"),
        ]
        if os.environ.get("ORCHESTRA_CODEX_NETWORK_ACCESS", "1") == "1":
            command += ["-c", "sandbox_workspace_write.network_access=true"]
        approval_policy = os.environ.get("ORCHESTRA_CODEX_APPROVAL_POLICY")
        if approval_policy:
            command += ["-c", f'approval_policy="{approval_policy}"']
    command += ["--json", "--color", "never"]
    if os.environ.get("ORCHESTRA_CODEX_SKIP_GIT_CHECK", "1") == "1":
        command.append("--skip-git-repo-check")
    model = os.environ.get("ORCHESTRA_MODEL")
    if model:
        command += ["--model", model]
    try:
        extra_args = json.loads(os.environ.get("ORCHESTRA_EXTRA_ARGS", "[]"))
    except ValueError:
        extra_args = []
    if isinstance(extra_args, list) and all(isinstance(arg, str) for arg in extra_args):
        command += extra_args
    if os.environ.get("ORCHESTRA_RESUME") == "1":
        command += ["resume", os.environ["ORCHESTRA_SESSION_ID"]]
    command.append(_prompt())
    return command


def main() -> int:
    os.makedirs(STATE_DIR, exist_ok=True)
    lock = open(os.path.join(STATE_DIR, "turn.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("orchestra codex worker: another turn holds the lock", file=sys.stderr)
        return 111

    log_path = os.path.join(STATE_DIR, "agent.log")
    process = subprocess.Popen(
        _command(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    usage = None
    is_error = False
    error_type = None
    with open(log_path, "ab") as log:
        assert process.stdout is not None
        for raw in process.stdout:
            log.write(raw)
            log.flush()
            try:
                event = json.loads(raw)
            except ValueError:
                continue
            event_type = event.get("type")
            if event_type == "thread.started" and event.get("thread_id"):
                _mark_session(str(event["thread_id"]))
            elif event_type == "turn.completed":
                usage = event.get("usage")
            elif event_type in {"turn.failed", "error"}:
                is_error = True
                error_type = event_type
    return_code = process.wait()
    result = {
        "version": 1,
        "sequence": int(os.environ.get("ORCHESTRA_TURN_SEQUENCE", "0")),
        "exit_code": return_code,
        "finished_at": time.time(),
        "total_cost_usd": None,
        "last_turn_cost_usd": None,
        "usage": usage,
        "num_turns": None,
        "is_error": is_error,
        "api_error_status": error_type,
    }
    temporary = os.path.join(STATE_DIR, "status.json.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, os.path.join(STATE_DIR, "status.json"))
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
