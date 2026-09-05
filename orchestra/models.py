"""Shared data shapes crossing provider boundaries.

Adapters should normalize remote objects into these deliberately small models.
In particular, an activity contains a pointer to remote content, never the raw
comment body. The agent reads authoritative content at the provider when woken.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

OK = "OK"
WARNING = "WARNING"
ERROR = "ERROR"


@dataclass(frozen=True, slots=True)
class HealthReport:
    status: str
    message: str

    def __post_init__(self) -> None:
        if self.status not in {OK, WARNING, ERROR}:
            raise ValueError(f"unknown health status: {self.status}")


@dataclass(frozen=True, slots=True)
class WorkItem:
    """One board item eligible for orchestration."""

    key: str
    title: str
    url: str
    description: str = ""
    priority: int = 100
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Activity:
    """A content-free wake signal.

    ``stream`` identifies one monotonically increasing provider feed and
    ``cursor`` is its high-water mark. ``directed=None`` means the source has
    no notion of addressing and therefore should wake by default.
    """

    stream: str
    cursor: float
    kind: str
    author: str
    url: str
    ref: str = ""
    thread: str = ""
    directed: bool | None = None


@dataclass(frozen=True, slots=True)
class WaitCondition:
    name: str
    url: str
    since: float = 0.0
    ref: str = ""


@dataclass(frozen=True, slots=True)
class TaskObservation:
    activities: tuple[Activity, ...] = ()
    waits: tuple[WaitCondition, ...] = ()


@dataclass(frozen=True, slots=True)
class RunSnapshot:
    key: str
    directory: Path
    state: str
    alive: bool
    turn: Mapping[str, Any]
    status: Mapping[str, Any] | None
    waits: tuple[WaitCondition, ...] = ()
    silent_for: float = 0.0
    stopping_at: float = 0.0
    restarts: int = 0
    last_restart_at: float = 0.0


@dataclass(frozen=True, slots=True)
class StartResult:
    ok: bool
    detail: str = ""


@dataclass(frozen=True, slots=True)
class TickReport:
    started_at: float
    finished_at: float
    actions: tuple[str, ...]
    snapshots: Mapping[str, RunSnapshot]
    health: Mapping[str, HealthReport]
    degraded_sources: tuple[str, ...] = ()
    dry_run: bool = False
