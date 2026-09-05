#!/usr/bin/env python3
"""Detached one-turn wrapper used by :class:`ClaudeCodeRuntime`.

This file intentionally has no package imports so it remains runnable after the
working directory changes to a task workspace.
"""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import time

STATE_DIR = ".orchestra"


def main() -> int:
    os.makedirs(STATE_DIR, exist_ok=True)
    lock = open(os.path.join(STATE_DIR, "turn.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("orchestra worker: another turn holds the lock", file=sys.stderr)
        return 111

    session_id = os.environ["ORCHESTRA_SESSION_ID"]
    session = (
        ["--resume", session_id]
        if os.environ.get("ORCHESTRA_RESUME") == "1"
        else ["--session-id", session_id]
    )
    command = [
        os.environ.get("ORCHESTRA_AGENT_BIN", "claude"),
        "-p",
        os.environ["ORCHESTRA_PROMPT"],
        *session,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        os.environ.get("ORCHESTRA_PERMISSION_MODE", "default"),
    ]
    model = os.environ.get("ORCHESTRA_MODEL")
    if model:
        command += ["--model", model]
    try:
        extra_args = json.loads(os.environ.get("ORCHESTRA_EXTRA_ARGS", "[]"))
    except ValueError:
        extra_args = []
    if isinstance(extra_args, list) and all(isinstance(arg, str) for arg in extra_args):
        command += extra_args
    system_prompt = os.environ.get("ORCHESTRA_SYSTEM_PROMPT_FILE", "SYSTEM.md")
    try:
        with open(system_prompt, encoding="utf-8") as handle:
            command += ["--append-system-prompt", handle.read()]
    except OSError:
        pass

    log_path = os.path.join(STATE_DIR, "agent.log")
    with open(log_path, "ab") as log:
        return_code = subprocess.run(command, stdout=log, stderr=log).returncode

    result = {
        "version": 1,
        "sequence": int(os.environ.get("ORCHESTRA_TURN_SEQUENCE", "0")),
        "exit_code": return_code,
        "finished_at": time.time(),
        "total_cost_usd": None,
        "last_turn_cost_usd": None,
        "usage": None,
        "num_turns": None,
        "is_error": None,
        "api_error_status": None,
    }
    try:
        with open(log_path, "rb") as log:
            for raw in log:
                if not raw.lstrip().startswith(b"{"):
                    continue
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if event.get("type") != "result":
                    continue
                cost = event.get("total_cost_usd")
                if cost is not None:
                    result["total_cost_usd"] = (
                        (result["total_cost_usd"] or 0.0) + float(cost)
                    )
                result["last_turn_cost_usd"] = cost
                result["usage"] = event.get("usage")
                result["num_turns"] = event.get("num_turns")
                result["is_error"] = event.get("is_error")
                result["api_error_status"] = event.get("api_error_status")
    except OSError:
        pass

    temporary = os.path.join(STATE_DIR, "status.json.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, os.path.join(STATE_DIR, "status.json"))
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
