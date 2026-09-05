"""Pure scheduling and activity policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from .models import Activity


@dataclass(frozen=True, slots=True)
class Candidate:
    priority: int
    key: str
    kind: str


def fresh_activities(
    activities: Iterable[Activity],
    seen: Mapping[str, float],
    bot_identities: frozenset[str],
    require_directed: bool,
) -> list[Activity]:
    """Return remote activity that is new, not self-authored, and addressable."""

    return [
        activity
        for activity in activities
        if activity.author not in bot_identities
        and activity.cursor > float(seen.get(activity.stream, 0.0))
        and (
            activity.directed is not False
            or not require_directed
        )
    ]


def advance_seen(
    seen: Mapping[str, float], activities: Iterable[Activity]
) -> dict[str, float]:
    advanced = dict(seen)
    for activity in activities:
        advanced[activity.stream] = max(
            float(advanced.get(activity.stream, 0.0)), activity.cursor
        )
    return advanced


def activity_prompt(activities: Iterable[Activity]) -> str:
    """Build a pointer-only prompt grouped by remote location."""

    groups: dict[tuple[str, str, str, str, str], int] = {}
    order: dict[tuple[str, str, str, str, str], float] = {}
    for activity in activities:
        key = (
            activity.ref,
            activity.thread,
            activity.author,
            activity.kind,
            activity.url,
        )
        groups[key] = groups.get(key, 0) + 1
        order[key] = min(order.get(key, activity.cursor), activity.cursor)

    lines = ["New activity is waiting at the source:"]
    for key in sorted(groups, key=lambda value: order[value]):
        ref, thread, author, kind, url = key
        where = ref or "task"
        if thread:
            where += f' / thread "{thread}"'
        who = f" from {author}" if author else ""
        lines.append(f"- {where}: {groups[key]} {kind} event(s){who}\n  {url}")
    lines.append("\nRead the authoritative content there, then act on it.")
    return "\n".join(lines)


def sort_candidates(candidates: Iterable[Candidate]) -> list[Candidate]:
    kind_order = {"retry": 0, "activity": 1, "bootstrap": 2, "claim": 2}
    return sorted(
        candidates,
        key=lambda candidate: (
            kind_order[candidate.kind],
            candidate.priority,
            candidate.key,
        ),
    )
