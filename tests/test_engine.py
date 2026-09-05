from __future__ import annotations

from pathlib import Path

from orchestra.engine import Engine, EngineConfig
from orchestra.models import (
    OK,
    Activity,
    HealthReport,
    StartResult,
    TaskObservation,
    WorkItem,
)
from orchestra.state import FileStateStore, write_json_atomic


class FakeBoard:
    name = "board"

    def __init__(self, items):
        self.items = items
        self.error = None

    def fetch(self):
        if self.error:
            raise self.error
        return list(self.items)

    def health(self):
        return HealthReport(OK, f"{len(self.items)} item(s)")


class FakeSource:
    name = "source"

    def __init__(self):
        self.observations = {}
        self.error = None

    def observe(self, items):
        if self.error:
            raise self.error
        return dict(self.observations)

    def health(self):
        return HealthReport(OK, "observed")


class FakeRuntime:
    name = "runtime"

    def __init__(self, store):
        self.store = store
        self.alive = set()
        self.starts = []
        self.stops = []
        self.fail = False

    def is_alive(self, task_dir):
        return task_dir in self.alive

    def start(self, task_dir, prompt, resume, sequence):
        session_id = self.store.session_id(task_dir, self.name)
        self.starts.append((task_dir, prompt, session_id, resume, sequence))
        if self.fail:
            return StartResult(False, "injected failure")
        write_json_atomic(
            self.store.state_path(task_dir, "turn.json"),
            {
                "sequence": sequence,
                "prompt": prompt,
                "resumed": resume,
                "started_at": 100,
                "pid": 123,
            },
        )
        self.store.state_path(task_dir, "status.json").unlink(missing_ok=True)
        self.alive.add(task_dir)
        return StartResult(True)

    def stop(self, snapshot, *, force=False):
        self.stops.append((snapshot.key, force))
        self.alive.discard(snapshot.directory)

    def health(self):
        return HealthReport(OK, "ready")

    def complete(self, task_dir, exit_code=0):
        turn = self.store.turn(task_dir)
        write_json_atomic(
            self.store.state_path(task_dir, "status.json"),
            {"sequence": turn["sequence"], "exit_code": exit_code},
        )
        self.alive.discard(task_dir)


class ExplodingChannel:
    name = "broken-channel"

    def publish(self, report):
        raise RuntimeError("boom")

    def health(self):
        return HealthReport(OK, "unused")


def work(key="TASK-1", priority=100):
    return WorkItem(key, f"Title {key}", f"https://board.test/{key}", priority=priority)


def make_engine(tmp_path, items, *, max_turns=3, channels=()):
    store = FileStateStore(tmp_path / "var")
    board = FakeBoard(items)
    source = FakeSource()
    runtime = FakeRuntime(store)
    engine = Engine(
        board=board,
        activity_sources=[source],
        runtime=runtime,
        channels=list(channels),
        store=store,
        config=EngineConfig(
            max_concurrent_turns=max_turns,
            stall_after_seconds=0,
            bot_identities=frozenset({"bot"}),
        ),
        clock=lambda: 100,
    )
    return engine, store, board, source, runtime


def test_claims_once_then_stays_quiet_without_activity(tmp_path):
    engine, store, _, _, runtime = make_engine(tmp_path, [work()])
    first = engine.tick()
    directory = store.task_dir("TASK-1")
    assert first.actions == ("fired TASK-1 (claim)",)
    assert len(runtime.starts) == 1
    pinned_session = runtime.starts[0][2]

    runtime.complete(directory)
    second = engine.tick()
    assert not any(action.startswith("fired") for action in second.actions)
    assert len(runtime.starts) == 1
    assert store.session_id(directory, runtime.name) == pinned_session


def test_external_activity_resumes_same_session_and_advances_after_spawn(tmp_path):
    engine, store, _, source, runtime = make_engine(tmp_path, [work()])
    engine.tick()
    directory = store.task_dir("TASK-1")
    session_id = runtime.starts[0][2]
    runtime.complete(directory)
    activity = Activity(
        stream="github:org/repo:1:comments",
        cursor=7,
        kind="comment",
        author="reviewer",
        url="https://github.test/org/repo/pull/1#comment-7",
        directed=True,
    )
    source.observations = {"TASK-1": TaskObservation((activity,))}

    report = engine.tick()

    assert "fired TASK-1 (activity)" in report.actions
    assert runtime.starts[-1][2] == session_id
    assert runtime.starts[-1][3] is True
    assert store.seen(directory) == {activity.stream: 7}


def test_failed_spawn_does_not_consume_activity(tmp_path):
    engine, store, _, source, runtime = make_engine(tmp_path, [work()])
    engine.tick()
    directory = store.task_dir("TASK-1")
    runtime.complete(directory)
    activity = Activity("stream", 2, "comment", "human", "https://event", directed=True)
    source.observations = {"TASK-1": TaskObservation((activity,))}
    runtime.fail = True

    report = engine.tick()

    assert "fire failed TASK-1: injected failure" in report.actions
    assert store.seen(directory) == {}


def test_board_outage_preserves_claim_but_empty_plate_stands_it_down(tmp_path):
    engine, store, board, _, runtime = make_engine(tmp_path, [work()])
    engine.tick()
    directory = store.task_dir("TASK-1")
    runtime.complete(directory)

    board.error = RuntimeError("offline")
    outage = engine.tick()
    assert "board: assignment unknown; preserving every claim" in outage.actions
    assert not runtime.stops
    assert not store.state_path(directory, "stopping.json").exists()

    board.error = None
    board.items = []
    empty = engine.tick()
    assert "stood down TASK-1" in empty.actions
    assert store.state_path(directory, "stopping.json").exists()


def test_priority_and_concurrency_are_deterministic(tmp_path):
    engine, _, _, _, runtime = make_engine(
        tmp_path, [work("LOW", 50), work("HIGH", 1)], max_turns=1
    )

    report = engine.tick()

    assert runtime.starts[0][0].name == "HIGH"
    assert report.actions[-1] == "deferred at concurrency cap: LOW"


def test_channel_failure_cannot_prevent_a_turn(tmp_path):
    engine, _, _, _, runtime = make_engine(
        tmp_path, [work()], channels=[ExplodingChannel()]
    )

    report = engine.tick()

    assert len(runtime.starts) == 1
    assert "broken-channel: notification failed: boom" in report.actions
