"""Executable Trello + GitHub + Claude Code composition."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from orchestra.channels import ConsoleChannel, HealthChangeChannel, JsonlAuditChannel
from orchestra.engine import Engine, EngineConfig
from orchestra.runtime import (
    ClaudeCodeRuntime,
    ClaudeRuntimeConfig,
    CodexCliRuntime,
    CodexRuntimeConfig,
)
from orchestra.state import FileStateStore, TickAlreadyRunning

from .adapters import GitHubActivitySource, TrelloBoard

ROOT = Path(__file__).resolve().parents[2]


def _integer(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def build_engine(*, dry_run: bool = False) -> Engine:
    ready_lists = tuple(
        value.strip()
        for value in os.environ.get("TRELLO_READY_LIST_IDS", "").split(",")
        if value.strip()
    )
    passthrough = tuple(
        value.strip()
        for value in os.environ.get("ORCHESTRA_AGENT_ENV", "").split(",")
        if value.strip()
    )
    store = FileStateStore(ROOT / "var", ROOT / "templates" / "task")
    board = TrelloBoard(
        key=os.environ.get("TRELLO_KEY", ""),
        token=os.environ.get("TRELLO_TOKEN", ""),
        board_id=os.environ.get("TRELLO_BOARD_ID", ""),
        ready_list_ids=ready_lists,
    )
    github = GitHubActivitySource(
        token=os.environ.get("GITHUB_TOKEN", ""),
        bot_login=os.environ.get("GITHUB_BOT_LOGIN", ""),
        api_url=os.environ.get("GITHUB_API_URL", "https://api.github.com"),
    )
    engine_name = os.environ.get("ORCHESTRA_AGENT_ENGINE", "claude").lower()
    if engine_name == "claude":
        runtime = ClaudeCodeRuntime(
            store,
            ClaudeRuntimeConfig(
                executable=os.environ.get("CLAUDE_BIN", "claude"),
                model=os.environ.get("ORCHESTRA_MODEL", ""),
                permission_mode=os.environ.get(
                    "ORCHESTRA_PERMISSION_MODE", "default"
                ),
                passthrough_env=passthrough,
            ),
        )
    elif engine_name == "codex":
        runtime = CodexCliRuntime(
            store,
            CodexRuntimeConfig(
                executable=os.environ.get("CODEX_BIN", "codex"),
                model=os.environ.get("ORCHESTRA_MODEL", ""),
                sandbox=os.environ.get(
                    "ORCHESTRA_CODEX_SANDBOX", "workspace-write"
                ),
                network_access=(
                    os.environ.get("ORCHESTRA_CODEX_NETWORK_ACCESS", "1") == "1"
                ),
                dangerously_bypass_approvals_and_sandbox=(
                    os.environ.get("ORCHESTRA_CODEX_DANGEROUS_BYPASS") == "1"
                ),
                passthrough_env=passthrough,
            ),
        )
    else:
        raise ValueError(
            "ORCHESTRA_AGENT_ENGINE must be 'claude' or 'codex', "
            f"not {engine_name!r}"
        )
    channels = [
        ConsoleChannel(),
        JsonlAuditChannel(ROOT / "var" / "logs" / "ticks.jsonl"),
        HealthChangeChannel(store.cache_dir / "health.json"),
    ]
    return Engine(
        board=board,
        activity_sources=[github],
        runtime=runtime,
        channels=channels,
        store=store,
        config=EngineConfig(
            max_concurrent_turns=_integer("ORCHESTRA_MAX_TURNS", 3),
            stall_after_seconds=_integer("ORCHESTRA_STALL_AFTER", 900),
            max_restarts=_integer("ORCHESTRA_MAX_RESTARTS", 5),
            require_directed_activity=(
                os.environ.get("ORCHESTRA_REQUIRE_DIRECTED", "1") == "1"
            ),
            bot_identities=frozenset(
                value
                for value in [os.environ.get("GITHUB_BOT_LOGIN", "")]
                if value
            ),
            dry_run=dry_run,
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    engine = build_engine(dry_run=args.dry_run)
    if args.status:
        for key, snapshot in sorted(engine.status().items()):
            print(f"{key}\t{snapshot.state}")
        return 0
    try:
        engine.tick()
    except TickAlreadyRunning as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
