"""The extension contracts.

Adapters do transport and normalization. The engine owns scheduling policy.
Channels observe the completed tick and cannot influence its decisions.
"""

from __future__ import annotations

from pathlib import Path
from typing import Mapping, Protocol, Sequence

from .models import (
    HealthReport,
    RunSnapshot,
    StartResult,
    TaskObservation,
    TickReport,
    WorkItem,
)


class Board(Protocol):
    name: str

    def fetch(self) -> Sequence[WorkItem]: ...

    def health(self) -> HealthReport: ...


class ActivitySource(Protocol):
    name: str

    def observe(
        self, items: Sequence[WorkItem]
    ) -> Mapping[str, TaskObservation]: ...

    def health(self) -> HealthReport: ...


class AgentRuntime(Protocol):
    name: str

    def is_alive(self, task_dir: Path) -> bool: ...

    def start(
        self,
        task_dir: Path,
        prompt: str,
        resume: bool,
        sequence: int,
    ) -> StartResult: ...

    def stop(self, snapshot: RunSnapshot, *, force: bool = False) -> None: ...

    def health(self) -> HealthReport: ...


class Channel(Protocol):
    name: str

    def publish(self, report: TickReport) -> None: ...

    def health(self) -> HealthReport: ...
