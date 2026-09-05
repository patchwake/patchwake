"""The observe -> decide -> act orchestration tick."""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from typing import Callable, Mapping, Sequence

from .models import (
    ERROR,
    WARNING,
    Activity,
    HealthReport,
    RunSnapshot,
    TaskObservation,
    TickReport,
    WaitCondition,
    WorkItem,
)
from .policy import (
    Candidate,
    activity_prompt,
    advance_seen,
    fresh_activities,
    sort_candidates,
)
from .ports import ActivitySource, AgentRuntime, Board, Channel
from .state import ClaimConflict, FileStateStore
from .state_machine import CLAIMED, FAILED, GAVE_UP, IDLE, STOPPED, WAITING


@dataclass(frozen=True, slots=True)
class EngineConfig:
    max_concurrent_turns: int = 3
    stall_after_seconds: int = 900
    stop_grace_seconds: int = 120
    max_restarts: int = 5
    restart_backoff_base_seconds: int = 60
    require_directed_activity: bool = True
    bot_identities: frozenset[str] = frozenset()
    dry_run: bool = False


class Engine:
    """Coordinates ports while keeping transport and state formats out of policy."""

    def __init__(
        self,
        *,
        board: Board,
        activity_sources: Sequence[ActivitySource],
        runtime: AgentRuntime,
        channels: Sequence[Channel],
        store: FileStateStore,
        config: EngineConfig = EngineConfig(),
        clock: Callable[[], float] = time.time,
    ):
        self.board = board
        self.activity_sources = tuple(activity_sources)
        self.runtime = runtime
        self.channels = tuple(channels)
        self.store = store
        self.config = config
        self.clock = clock

    def tick(self, *, dry_run: bool | None = None) -> TickReport:
        """Run exactly one disposable scheduler tick.

        The board result deliberately has three meanings: a sequence is a real
        assignment verdict, an empty sequence means nothing is assigned, and an
        exception means assignment is unknown. Unknown never stands work down.
        """

        with self.store.tick_lock():
            return self._tick(
                self.config.dry_run if dry_run is None else bool(dry_run)
            )

    def status(self) -> Mapping[str, RunSnapshot]:
        now = self.clock()
        return {
            key: self.store.inspect(
                key,
                directory,
                self.store.waits(directory),
                self.runtime.is_alive(directory),
                now,
            )
            for key, directory in self.store.claims().items()
        }

    def _tick(self, dry: bool) -> TickReport:
        started_at = self.clock()
        actions: list[str] = []
        health: dict[str, HealthReport] = {}

        assigned: dict[str, WorkItem] | None
        try:
            fetched = list(self.board.fetch())
            assigned = {item.key: item for item in fetched}
            health[self.board.name] = self._safe_health(self.board)
        except Exception as error:
            assigned = None
            health[self.board.name] = HealthReport(
                ERROR, f"assignment unknown this tick: {error}"
            )
            actions.append(
                f"{self.board.name}: assignment unknown; preserving every claim"
            )

        claims = self.store.claims()
        items = self._known_items(assigned, claims)
        observations = {item.key: TaskObservation() for item in items}
        degraded: list[str] = []
        for source in self.activity_sources:
            try:
                batch = source.observe(items)
                observations = self._merge_observations(observations, batch)
                health[source.name] = self._safe_health(source)
            except Exception as error:
                degraded.append(source.name)
                component_health = self._safe_health(source)
                health[source.name] = (
                    component_health
                    if component_health.status != "OK"
                    else HealthReport(WARNING, f"observation failed this tick: {error}")
                )
                actions.append(f"{source.name}: degraded; activity treated as unknown")

        # A partial source outage must not falsely clear a visible wait. Fresh
        # activity from healthy sources is still usable, but wait presentation is
        # frozen at the last complete observation.
        if degraded:
            observations = {
                key: replace(
                    observation,
                    waits=(self.store.waits(claims[key]) if key in claims else ()),
                )
                for key, observation in observations.items()
            }
        elif not dry:
            for key, directory in claims.items():
                self.store.write_waits(
                    directory, observations.get(key, TaskObservation()).waits
                )

        snapshots = self._snapshots(claims, observations, started_at)
        self._kill_stalled(snapshots, actions, dry)
        self._reap(snapshots, actions, dry)
        if assigned is not None:
            self._stand_down(snapshots, set(assigned), actions, dry)
            self._rearm(claims, set(assigned), snapshots, actions, dry)

        # Re-observe local state after supervision, before selecting turn work.
        claims = self.store.claims()
        snapshots = self._snapshots(claims, observations, self.clock())
        if assigned is not None:
            self._fire(
                assigned,
                observations,
                snapshots,
                actions,
                dry,
            )

        if not dry:
            for name in self.store.tidy_staging():
                actions.append(f"cleaned stale staging directory {name}")

        claims = self.store.claims()
        snapshots = self._snapshots(claims, observations, self.clock())
        health[self.runtime.name] = self._safe_health(self.runtime)
        report = TickReport(
            started_at=started_at,
            finished_at=self.clock(),
            actions=tuple(actions),
            snapshots=snapshots,
            health=health,
            degraded_sources=tuple(degraded),
            dry_run=dry,
        )

        # Channels are deliberately last. A channel failure is reported but can
        # never alter assignment, cursors, sessions, or processes.
        for channel in self.channels:
            channel_report = replace(
                report,
                actions=tuple(actions),
                health=dict(health),
            )
            try:
                channel.publish(channel_report)
                health[channel.name] = self._safe_health(channel)
            except Exception as error:
                health[channel.name] = HealthReport(
                    WARNING, f"notification failed this tick: {error}"
                )
                actions.append(f"{channel.name}: notification failed: {error}")
        return replace(report, actions=tuple(actions), health=health)

    def _known_items(
        self,
        assigned: Mapping[str, WorkItem] | None,
        claims: Mapping[str, object],
    ) -> list[WorkItem]:
        known = dict(assigned or {})
        for key, directory in claims.items():
            if key not in known:
                saved = self.store.work_item(directory)
                if saved:
                    known[key] = saved
        return list(known.values())

    @staticmethod
    def _merge_observations(
        current: Mapping[str, TaskObservation],
        incoming: Mapping[str, TaskObservation],
    ) -> dict[str, TaskObservation]:
        merged = dict(current)
        for key, observation in incoming.items():
            previous = merged.get(key, TaskObservation())
            merged[key] = TaskObservation(
                activities=previous.activities + tuple(observation.activities),
                waits=previous.waits + tuple(observation.waits),
            )
        return merged

    def _snapshots(
        self,
        claims: Mapping[str, object],
        observations: Mapping[str, TaskObservation],
        now: float,
    ) -> dict[str, RunSnapshot]:
        return {
            key: self.store.inspect(
                key,
                directory,
                observations.get(key, TaskObservation()).waits,
                self.runtime.is_alive(directory),
                now,
            )
            for key, directory in claims.items()
        }

    def _kill_stalled(
        self,
        snapshots: Mapping[str, RunSnapshot],
        actions: list[str],
        dry: bool,
    ) -> None:
        threshold = self.config.stall_after_seconds
        if not threshold:
            return
        for snapshot in snapshots.values():
            if not snapshot.alive or snapshot.silent_for <= threshold:
                continue
            actions.append(
                f"{'would kill' if dry else 'killed'} {snapshot.key}: "
                f"silent for {int(snapshot.silent_for)}s"
            )
            if not dry:
                self.runtime.stop(snapshot, force=True)

    def _reap(
        self,
        snapshots: Mapping[str, RunSnapshot],
        actions: list[str],
        dry: bool,
    ) -> None:
        resting = {FAILED, IDLE, WAITING, GAVE_UP, STOPPED}
        for snapshot in snapshots.values():
            if snapshot.alive or snapshot.state not in resting:
                continue
            if self.store.recorded_state(snapshot.directory) == snapshot.state:
                continue
            actions.append(
                f"{'would reap' if dry else 'reaped'} {snapshot.key}: {snapshot.state}"
            )
            if not dry:
                self.store.record_state(snapshot.directory, snapshot.state)

    def _stand_down(
        self,
        snapshots: Mapping[str, RunSnapshot],
        assigned_keys: set[str],
        actions: list[str],
        dry: bool,
    ) -> None:
        now = self.clock()
        for key, snapshot in snapshots.items():
            if key in assigned_keys:
                continue
            if snapshot.alive:
                force = bool(
                    snapshot.stopping_at
                    and now - snapshot.stopping_at > self.config.stop_grace_seconds
                )
                actions.append(
                    f"{'would stop' if dry else 'stopping'} {key}"
                    + (" (grace expired)" if force else "")
                )
                if not dry:
                    self.store.mark_stopping(snapshot.directory, now)
                    self.runtime.stop(snapshot, force=force)
            else:
                actions.append(f"{'would stand down' if dry else 'stood down'} {key}")
                if not dry:
                    self.store.mark_stopping(snapshot.directory, now)
                    self.store.record_state(snapshot.directory, STOPPED)

    def _rearm(
        self,
        claims: Mapping[str, object],
        assigned_keys: set[str],
        snapshots: Mapping[str, RunSnapshot],
        actions: list[str],
        dry: bool,
    ) -> None:
        for key in sorted(set(claims) & assigned_keys):
            snapshot = snapshots[key]
            if not snapshot.stopping_at:
                continue
            actions.append(f"{'would re-arm' if dry else 're-armed'} {key}")
            if not dry:
                self.store.clear_stopping(snapshot.directory)

    def _fire(
        self,
        assigned: Mapping[str, WorkItem],
        observations: Mapping[str, TaskObservation],
        snapshots: Mapping[str, RunSnapshot],
        actions: list[str],
        dry: bool,
    ) -> None:
        candidates: list[Candidate] = []
        fresh_by_key: dict[str, list[Activity]] = {}
        for key, snapshot in snapshots.items():
            if (
                key not in assigned
                or snapshot.alive
                or snapshot.state in {GAVE_UP, STOPPED}
            ):
                continue
            if snapshot.state == FAILED:
                candidates.append(Candidate(assigned[key].priority, key, "retry"))
            elif snapshot.state == CLAIMED:
                candidates.append(Candidate(assigned[key].priority, key, "bootstrap"))
            else:
                seen = self.store.seen(snapshot.directory)
                fresh = fresh_activities(
                    observations.get(key, TaskObservation()).activities,
                    seen,
                    self.config.bot_identities,
                    self.config.require_directed_activity,
                )
                if fresh:
                    fresh_by_key[key] = fresh
                    candidates.append(
                        Candidate(assigned[key].priority, key, "activity")
                    )
        for key, item in assigned.items():
            if key not in snapshots:
                candidates.append(Candidate(item.priority, key, "claim"))

        ordered = sort_candidates(candidates)
        room = max(
            0,
            self.config.max_concurrent_turns
            - sum(1 for snapshot in snapshots.values() if snapshot.alive),
        )
        for index, candidate in enumerate(ordered):
            if room <= 0:
                deferred = ", ".join(value.key for value in ordered[index:])
                actions.append(f"deferred at concurrency cap: {deferred}")
                break
            consumed = self._fire_candidate(
                candidate,
                assigned[candidate.key],
                observations.get(candidate.key, TaskObservation()),
                snapshots.get(candidate.key),
                fresh_by_key.get(candidate.key, []),
                actions,
                dry,
            )
            if consumed:
                room -= 1

    def _fire_candidate(
        self,
        candidate: Candidate,
        item: WorkItem,
        observation: TaskObservation,
        snapshot: RunSnapshot | None,
        fresh: list[Activity],
        actions: list[str],
        dry: bool,
    ) -> bool:
        now = self.clock()
        kind = candidate.kind
        if kind == "claim":
            if dry:
                actions.append(f"would claim and fire {item.key}: {item.title}")
                return True
            try:
                directory = self.store.claim(item)
            except ClaimConflict:
                return False
            prompt = self.store.bootstrap_prompt(directory)
            resume, sequence = False, 1
        elif snapshot is None:
            return False
        elif kind == "bootstrap":
            directory = snapshot.directory
            prompt = self.store.bootstrap_prompt(directory)
            resume, sequence = False, 1
        elif kind == "activity":
            directory = snapshot.directory
            prompt = activity_prompt(fresh)
            resume = True
            sequence = int(snapshot.turn.get("sequence") or 0) + 1
        else:  # retry
            directory = snapshot.directory
            count = snapshot.restarts
            if count >= self.config.max_restarts:
                actions.append(f"gave up {item.key} after {count} restart(s)")
                if not dry:
                    self.store.mark_gave_up(directory, now)
                return False
            if count and snapshot.last_restart_at:
                wait = self.config.restart_backoff_base_seconds * (2**count)
                remaining = int(wait - (now - snapshot.last_restart_at))
                if remaining > 0:
                    actions.append(f"{item.key}: retry backoff has {remaining}s left")
                    return False
            prompt = str(snapshot.turn.get("prompt") or "Resume the interrupted task.")
            resume = bool(snapshot.turn.get("resumed", True))
            sequence = int(snapshot.turn.get("sequence") or 1)

        if kind in {"claim", "bootstrap"}:
            initial_activity = fresh_activities(
                observation.activities,
                {},
                self.config.bot_identities,
                self.config.require_directed_activity,
            )
            if initial_activity:
                prompt += "\n\n" + activity_prompt(initial_activity)

        if dry:
            actions.append(f"would fire {item.key} ({kind})")
            return True
        self.store.clear_stopping(directory)
        result = self.runtime.start(
            directory,
            prompt,
            resume,
            sequence,
        )
        if not result.ok:
            self.store.record_state(directory, FAILED)
            actions.append(f"fire failed {item.key}: {result.detail}")
            return False
        if kind == "retry" and snapshot is not None:
            self.store.record_restart(directory, snapshot.restarts + 1, now)
        if kind in {"activity", "claim", "bootstrap"} and observation.activities:
            # Advance only after the process was created successfully. Advance
            # every observed event so filtered self/undirected rows do not become
            # surprising old activity if policy changes later.
            self.store.write_seen(
                directory,
                advance_seen(self.store.seen(directory), observation.activities),
            )
        actions.append(f"fired {item.key} ({kind})")
        return True

    @staticmethod
    def _safe_health(component: object) -> HealthReport:
        try:
            report = component.health()
            return report if isinstance(report, HealthReport) else HealthReport(
                WARNING, "component returned invalid health"
            )
        except Exception as error:
            return HealthReport(WARNING, f"health unavailable: {error}")
