from pathlib import Path

import pytest

from orchestra.models import WorkItem
from orchestra.state import ClaimConflict, FileStateStore, TickAlreadyRunning


def item(key="TASK-1", description="description"):
    return WorkItem(
        key=key,
        title="Fix the thing",
        url="https://board.test/TASK-1",
        description=description,
        metadata={"repository": "org/repo"},
    )


def test_claim_is_atomic_and_substitutes_only_data_templates(tmp_path: Path):
    template = tmp_path / "template"
    template.mkdir()
    (template / "PROMPT.md").write_text("Work on {{TASK_ID}}: {{TASK_DESCRIPTION}}")
    (template / "run.py").write_text("VALUE = '{{TASK_DESCRIPTION}}'\n")
    store = FileStateStore(tmp_path / "var", template)

    directory = store.claim(item(description="$(touch should-not-run)"))

    assert (directory / "PROMPT.md").read_text() == (
        "Work on TASK-1: $(touch should-not-run)"
    )
    assert (directory / "run.py").read_text() == "VALUE = '{{TASK_DESCRIPTION}}'\n"
    assert store.work_item(directory) == item(description="$(touch should-not-run)")
    first_session = store.session_id(directory, "test-runtime")
    assert first_session
    assert store.session_id(directory, "test-runtime") == first_session
    assert store.session_id(directory, "other-runtime", create=False) == ""
    assert not list(store.work_dir.glob(".staging-*"))


def test_second_claim_conflicts_and_unsafe_keys_are_rejected(tmp_path: Path):
    store = FileStateStore(tmp_path / "var")
    store.claim(item())
    with pytest.raises(ClaimConflict):
        store.claim(item())
    with pytest.raises(ValueError):
        store.claim(item("../escape"))


def test_tick_lock_rejects_overlap(tmp_path: Path):
    store = FileStateStore(tmp_path / "var")
    with store.tick_lock():
        with pytest.raises(TickAlreadyRunning):
            with store.tick_lock():
                pass
