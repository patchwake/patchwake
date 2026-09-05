"""File-backed task state and atomic claim operations."""

from __future__ import annotations

import fcntl
import json
import os
import re
import shutil
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Mapping

from .models import RunSnapshot, WaitCondition, WorkItem
from .state_machine import derive_state

STATE_DIR = ".orchestra"
SAFE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
TEXT_TEMPLATE_SUFFIXES = {".md", ".txt", ".json", ".toml", ".yaml", ".yml"}
START_GRACE_SECONDS = 30


class ClaimConflict(RuntimeError):
    pass


class TickAlreadyRunning(RuntimeError):
    pass


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def write_json_atomic(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(
        json.dumps(dict(value), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)


def lock_is_held(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        handle = path.open("a")
    except OSError:
        return False
    with handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return True
        fcntl.flock(handle, fcntl.LOCK_UN)
        return False


class FileStateStore:
    """The complete durable contract for a disposable scheduler tick."""

    def __init__(self, root: Path, template_dir: Path | None = None):
        self.root = Path(root)
        self.work_dir = self.root / "work"
        self.cache_dir = self.root / "cache"
        self.template_dir = Path(template_dir) if template_dir else None

    @contextmanager
    def tick_lock(self) -> Iterator[None]:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self.cache_dir / "tick.lock"
        with path.open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise TickAlreadyRunning("another orchestra tick is active") from error
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def task_dir(self, key: str) -> Path:
        self._validate_key(key)
        return self.work_dir / key

    def state_path(self, task_dir: Path, *parts: str) -> Path:
        return Path(task_dir).joinpath(STATE_DIR, *parts)

    def claims(self) -> dict[str, Path]:
        if not self.work_dir.is_dir():
            return {}
        return {
            path.name: path
            for path in sorted(self.work_dir.iterdir())
            if path.is_dir()
            and not path.name.startswith(".")
            and SAFE_KEY.fullmatch(path.name)
        }

    def claim(self, item: WorkItem) -> Path:
        """Stage and atomically rename a per-task workspace into existence."""

        self._validate_key(item.key)
        self.work_dir.mkdir(parents=True, exist_ok=True)
        target = self.task_dir(item.key)
        if target.exists():
            raise ClaimConflict(item.key)
        staging = self.work_dir / (
            f".staging-{item.key}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        )
        try:
            if self.template_dir and self.template_dir.is_dir():
                shutil.copytree(self.template_dir, staging)
            else:
                staging.mkdir(parents=True)
            self._substitute_templates(staging, item)
            state_dir = self.state_path(staging)
            state_dir.mkdir(parents=True, exist_ok=True)
            now = time.time()
            write_json_atomic(
                state_dir / "task.json",
                {
                    "key": item.key,
                    "title": item.title,
                    "url": item.url,
                    "description": item.description,
                    "priority": item.priority,
                    "metadata": dict(item.metadata),
                    "claimed_at": now,
                },
            )
            os.rename(staging, target)
        except FileExistsError as error:
            shutil.rmtree(staging, ignore_errors=True)
            raise ClaimConflict(item.key) from error
        except OSError as error:
            shutil.rmtree(staging, ignore_errors=True)
            if target.exists():
                raise ClaimConflict(item.key) from error
            raise
        return target

    def tidy_staging(self) -> list[str]:
        removed: list[str] = []
        if not self.work_dir.is_dir():
            return removed
        for path in self.work_dir.iterdir():
            if path.is_dir() and path.name.startswith(".staging-"):
                shutil.rmtree(path, ignore_errors=True)
                removed.append(path.name)
        return removed

    def work_item(self, task_dir: Path) -> WorkItem | None:
        value = read_json(self.state_path(task_dir, "task.json"))
        if not value:
            return None
        try:
            return WorkItem(
                key=str(value["key"]),
                title=str(value.get("title") or ""),
                url=str(value.get("url") or ""),
                description=str(value.get("description") or ""),
                priority=int(value.get("priority") or 100),
                metadata=value.get("metadata") or {},
            )
        except (KeyError, TypeError, ValueError):
            return None

    def bootstrap_prompt(self, task_dir: Path) -> str:
        try:
            return (Path(task_dir) / "PROMPT.md").read_text(encoding="utf-8").strip()
        except OSError:
            return "Read AGENTS.md and SYSTEM.md, then begin the assigned task."

    def session_path(self, task_dir: Path, runtime_name: str) -> Path:
        self._validate_namespace(runtime_name)
        return self.state_path(task_dir, "sessions", f"{runtime_name}.id")

    def session_ready_path(self, task_dir: Path, runtime_name: str) -> Path:
        self._validate_namespace(runtime_name)
        return self.state_path(task_dir, "sessions", f"{runtime_name}.ready")

    def session_id(
        self,
        task_dir: Path,
        runtime_name: str = "default",
        *,
        create: bool = True,
    ) -> str:
        path = self.session_path(task_dir, runtime_name)
        try:
            current = path.read_text(encoding="utf-8").strip()
        except OSError:
            current = ""
        if current or not create:
            return current
        current = str(uuid.uuid4())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(current + "\n", encoding="utf-8")
        return current

    def write_session_id(
        self, task_dir: Path, runtime_name: str, session_id: str
    ) -> None:
        path = self.session_path(task_dir, runtime_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_text(session_id.strip() + "\n", encoding="utf-8")
        os.replace(temporary, path)

    def mark_session_ready(
        self, task_dir: Path, runtime_name: str, session_id: str
    ) -> None:
        path = self.session_ready_path(task_dir, runtime_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json_atomic(path, {"session_id": session_id})

    def session_ready(
        self, task_dir: Path, runtime_name: str, session_id: str
    ) -> bool:
        value = read_json(self.session_ready_path(task_dir, runtime_name)) or {}
        return bool(session_id) and value.get("session_id") == session_id

    def turn(self, task_dir: Path) -> dict[str, Any]:
        return read_json(self.state_path(task_dir, "turn.json")) or {}

    def status(self, task_dir: Path) -> dict[str, Any] | None:
        return read_json(self.state_path(task_dir, "status.json"))

    def seen(self, task_dir: Path) -> dict[str, float]:
        value = read_json(self.state_path(task_dir, "seen.json")) or {}
        streams = value.get("streams") or {}
        return {str(key): float(cursor) for key, cursor in streams.items()}

    def write_seen(self, task_dir: Path, streams: Mapping[str, float]) -> None:
        write_json_atomic(
            self.state_path(task_dir, "seen.json"),
            {"version": 1, "streams": dict(streams)},
        )

    def waits(self, task_dir: Path) -> tuple[WaitCondition, ...]:
        value = read_json(self.state_path(task_dir, "waits.json")) or {}
        waits: list[WaitCondition] = []
        for row in value.get("waits") or []:
            try:
                waits.append(
                    WaitCondition(
                        name=str(row["name"]),
                        url=str(row.get("url") or ""),
                        since=float(row.get("since") or 0),
                        ref=str(row.get("ref") or ""),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        return tuple(waits)

    def write_waits(
        self, task_dir: Path, waits: tuple[WaitCondition, ...]
    ) -> None:
        write_json_atomic(
            self.state_path(task_dir, "waits.json"),
            {
                "version": 1,
                "waits": [
                    {
                        "name": wait.name,
                        "url": wait.url,
                        "since": wait.since,
                        "ref": wait.ref,
                    }
                    for wait in waits
                ],
            },
        )

    def restart_info(self, task_dir: Path) -> tuple[int, float]:
        value = read_json(self.state_path(task_dir, "restarts.json")) or {}
        return int(value.get("count") or 0), float(value.get("last_at") or 0)

    def record_restart(self, task_dir: Path, count: int, at: float) -> None:
        write_json_atomic(
            self.state_path(task_dir, "restarts.json"),
            {"count": count, "last_at": at},
        )

    def record_state(self, task_dir: Path, state: str) -> None:
        path = self.state_path(task_dir, "state")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(state + "\n", encoding="utf-8")

    def recorded_state(self, task_dir: Path) -> str:
        try:
            return self.state_path(task_dir, "state").read_text().strip()
        except OSError:
            return ""

    def mark_stopping(self, task_dir: Path, at: float) -> None:
        path = self.state_path(task_dir, "stopping.json")
        if not path.exists():
            write_json_atomic(path, {"at": at})

    def clear_stopping(self, task_dir: Path) -> None:
        self.state_path(task_dir, "stopping.json").unlink(missing_ok=True)
        self.state_path(task_dir, "state").unlink(missing_ok=True)

    def mark_gave_up(self, task_dir: Path, at: float) -> None:
        path = self.state_path(task_dir, "gave-up")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(at) + "\n", encoding="utf-8")

    def inspect(
        self,
        key: str,
        task_dir: Path,
        waits: tuple[WaitCondition, ...],
        alive: bool,
        now: float,
    ) -> RunSnapshot:
        turn = self.turn(task_dir)
        status = self.status(task_dir)
        stopping = read_json(self.state_path(task_dir, "stopping.json")) or {}
        stopping_at = float(stopping.get("at") or 0)
        gave_up = self.state_path(task_dir, "gave-up").is_file()
        started_at = float(turn.get("started_at") or 0)
        starting = bool(started_at and now - started_at < START_GRACE_SECONDS)
        try:
            log_mtime = self.state_path(task_dir, "agent.log").stat().st_mtime
        except OSError:
            log_mtime = 0.0
        silent_for = (
            now - max(log_mtime, started_at)
            if alive and (log_mtime or started_at)
            else 0.0
        )
        restarts, last_restart_at = self.restart_info(task_dir)
        return RunSnapshot(
            key=key,
            directory=task_dir,
            state=derive_state(
                alive=alive,
                stopping=bool(stopping),
                gave_up=gave_up,
                turn=turn,
                status=status,
                waits=bool(waits),
                starting=starting,
            ),
            alive=alive,
            turn=turn,
            status=status,
            waits=waits,
            silent_for=max(0.0, silent_for),
            stopping_at=stopping_at,
            restarts=restarts,
            last_restart_at=last_restart_at,
        )

    def _substitute_templates(self, root: Path, item: WorkItem) -> None:
        values = {
            "TASK_ID": item.key,
            "TASK_TITLE": item.title,
            "TASK_URL": item.url,
            "TASK_DESCRIPTION": item.description,
        }
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in TEXT_TEMPLATE_SUFFIXES:
                continue
            try:
                original = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            rendered = original
            for name, value in values.items():
                rendered = rendered.replace("{{" + name + "}}", value)
            if rendered != original:
                path.write_text(rendered, encoding="utf-8")

    @staticmethod
    def _validate_key(key: str) -> None:
        if not SAFE_KEY.fullmatch(key):
            raise ValueError(
                "task keys must be 1-128 safe path characters: letters, digits, "
                "dot, underscore, or hyphen"
            )

    @staticmethod
    def _validate_namespace(value: str) -> None:
        if not SAFE_KEY.fullmatch(value):
            raise ValueError(f"unsafe runtime session namespace: {value!r}")
