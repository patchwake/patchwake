"""Small channels useful in examples and local operation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Mapping

from .models import OK, HealthReport, TickReport
from .state import read_json, write_json_atomic


class ConsoleChannel:
    name = "console"

    def __init__(self):
        self._health = HealthReport(OK, "ready")

    def publish(self, report: TickReport) -> None:
        for action in report.actions:
            print(action)
        if not report.actions:
            print("no actions")
        self._health = HealthReport(OK, f"reported {len(report.actions)} action(s)")

    def health(self) -> HealthReport:
        return self._health


class JsonlAuditChannel:
    """Append one compact, content-free tick record to a local JSONL log."""

    name = "audit-log"

    def __init__(self, path: Path):
        self.path = Path(path)
        self._health = HealthReport(OK, "ready")

    def publish(self, report: TickReport) -> None:
        if report.dry_run:
            self._health = HealthReport(OK, "dry run; audit not written")
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "started_at": report.started_at,
            "finished_at": report.finished_at,
            "dry_run": report.dry_run,
            "actions": report.actions,
            "states": {
                key: snapshot.state for key, snapshot in report.snapshots.items()
            },
            "health": {
                name: {"status": value.status, "message": value.message}
                for name, value in report.health.items()
            },
            "degraded_sources": report.degraded_sources,
        }
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
        self._health = HealthReport(OK, "tick appended")

    def health(self) -> HealthReport:
        return self._health


def health_changed(
    previous: Mapping[str, object], name: str, current: HealthReport
) -> bool:
    row = previous.get(name)
    if not isinstance(row, dict) or row.get("status") != current.status:
        return True
    return current.status != OK and row.get("message") != current.message


class HealthChangeChannel:
    """Report edge-triggered component health changes through any text sink."""

    name = "health"

    def __init__(self, state_path: Path, sink: Callable[[str], None] = print):
        self.state_path = Path(state_path)
        self.sink = sink
        self._health = HealthReport(OK, "ready")

    def publish(self, report: TickReport) -> None:
        if report.dry_run:
            self._health = HealthReport(OK, "dry run; health state not written")
            return
        previous = read_json(self.state_path) or {}
        lines = [
            f"{value.status} {name}: {value.message}"
            for name, value in sorted(report.health.items())
            if health_changed(previous, name, value)
        ]
        if lines:
            self.sink("\n".join(lines))
        write_json_atomic(
            self.state_path,
            {
                name: {"status": value.status, "message": value.message}
                for name, value in report.health.items()
            },
        )
        self._health = HealthReport(OK, f"reported {len(lines)} change(s)")

    def health(self) -> HealthReport:
        return self._health
