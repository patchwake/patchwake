import json
import time
from pathlib import Path

from orchestra.models import WorkItem
from orchestra.runtime import (
    ClaudeCodeRuntime,
    ClaudeRuntimeConfig,
    CodexCliRuntime,
    CodexRuntimeConfig,
)
from orchestra.state import FileStateStore
import pytest


def test_claude_runtime_worker_records_a_completed_turn(tmp_path: Path):
    fake_claude = tmp_path / "fake-claude"
    fake_claude.write_text(
        "#!/usr/bin/env python3\n"
        "import json\n"
        "print(json.dumps({'type': 'result', 'total_cost_usd': 0.25, "
        "'is_error': False, 'usage': {'input_tokens': 2}, 'num_turns': 1}))\n"
    )
    fake_claude.chmod(0o755)
    store = FileStateStore(tmp_path / "var")
    directory = store.claim(WorkItem("TASK-1", "Title", "https://task"))
    runtime = ClaudeCodeRuntime(
        store,
        ClaudeRuntimeConfig(executable=str(fake_claude)),
    )

    started = runtime.start(
        directory,
        "Do the work",
        False,
        1,
    )
    deadline = time.time() + 3
    status_path = store.state_path(directory, "status.json")
    while time.time() < deadline and not status_path.exists():
        time.sleep(0.01)

    assert started.ok
    status = json.loads(status_path.read_text())
    assert status["sequence"] == 1
    assert status["exit_code"] == 0
    assert status["total_cost_usd"] == 0.25
    assert status["is_error"] is False
    assert store.session_id(directory, runtime.name, create=False)


def test_codex_runtime_captures_thread_and_resumes_it(tmp_path: Path, monkeypatch):
    capture = tmp_path / "arguments.jsonl"
    fake_codex = tmp_path / "fake-codex"
    fake_codex.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "with open(os.environ['CAPTURE'], 'a') as fh:\n"
        "    fh.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        "print(json.dumps({'type': 'thread.started', "
        "'thread_id': '0199a213-81c0-7800-8aa1-bbab2a035a53'}))\n"
        "print(json.dumps({'type': 'turn.started'}))\n"
        "print(json.dumps({'type': 'turn.completed', "
        "'usage': {'input_tokens': 3, 'output_tokens': 1}}))\n"
    )
    fake_codex.chmod(0o755)
    monkeypatch.setenv("CAPTURE", str(capture))
    store = FileStateStore(tmp_path / "var")
    directory = store.claim(WorkItem("TASK-1", "Title", "https://task"))
    (directory / "SYSTEM.md").write_text("Never push to main.\n")
    runtime = CodexCliRuntime(
        store,
        CodexRuntimeConfig(
            executable=str(fake_codex),
            passthrough_env=("CAPTURE",),
        ),
    )

    first = runtime.start(directory, "Start", False, 1)
    _wait_for_sequence(store, directory, 1)
    thread_id = store.session_id(directory, runtime.name, create=False)

    second = runtime.start(directory, "Continue", True, 2)
    _wait_for_sequence(store, directory, 2)
    invocations = [json.loads(line) for line in capture.read_text().splitlines()]

    assert first.ok and second.ok
    assert thread_id == "0199a213-81c0-7800-8aa1-bbab2a035a53"
    assert "resume" not in invocations[0]
    assert "--json" in invocations[0]
    assert invocations[0][invocations[0].index("--sandbox") + 1] == "workspace-write"
    assert "sandbox_workspace_write.network_access=true" in invocations[0]
    assert 'approval_policy="never"' in invocations[0]
    assert "resume" in invocations[1]
    assert thread_id in invocations[1]
    assert "Never push to main." in invocations[1][-1]


def _wait_for_sequence(store: FileStateStore, directory: Path, sequence: int) -> None:
    deadline = time.time() + 3
    while time.time() < deadline:
        status = store.status(directory)
        if status and status.get("sequence") == sequence:
            return
        time.sleep(0.01)
    raise AssertionError(f"turn {sequence} did not complete")


def test_codex_runtime_rejects_unsafe_policy_values():
    with pytest.raises(ValueError, match="approval policy"):
        CodexRuntimeConfig(approval_policy='never" -c unsafe=true')
