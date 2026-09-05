"""Stock CLI runtimes for Claude Code and Codex.

The engine depends only on ``AgentRuntime``. Each implementation owns its own
session namespace because the two CLIs establish sessions differently: Claude
accepts a caller-provided id, while Codex emits its thread id after starting.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from .models import ERROR, OK, WARNING, HealthReport, RunSnapshot, StartResult
from .state import FileStateStore, lock_is_held, write_json_atomic

BASE_ENV_NAMES = (
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSH_AUTH_SOCK",
)


@dataclass(frozen=True, slots=True)
class ClaudeRuntimeConfig:
    executable: str = "claude"
    model: str = ""
    permission_mode: str = "default"
    passthrough_env: tuple[str, ...] = ()
    base_env_names: tuple[str, ...] = BASE_ENV_NAMES
    extra_args: tuple[str, ...] = ()
    system_prompt_file: str = "SYSTEM.md"


@dataclass(frozen=True, slots=True)
class CodexRuntimeConfig:
    executable: str = "codex"
    model: str = ""
    sandbox: str = "workspace-write"
    network_access: bool = True
    approval_policy: str = "never"
    dangerously_bypass_approvals_and_sandbox: bool = False
    skip_git_repo_check: bool = True
    passthrough_env: tuple[str, ...] = ()
    base_env_names: tuple[str, ...] = BASE_ENV_NAMES
    extra_args: tuple[str, ...] = ()
    system_prompt_file: str = "SYSTEM.md"

    def __post_init__(self) -> None:
        if self.sandbox not in {"read-only", "workspace-write", "danger-full-access"}:
            raise ValueError(f"invalid Codex sandbox: {self.sandbox}")
        if self.approval_policy not in {
            "",
            "never",
            "on-request",
            "untrusted",
            "unless-trusted",
        }:
            raise ValueError(
                f"unsupported Codex approval policy: {self.approval_policy}"
            )


class _DetachedCliRuntime:
    name = "cli"

    def __init__(self, store: FileStateStore):
        self.store = store
        self._health = HealthReport(OK, "ready")

    def health(self) -> HealthReport:
        return self._health

    def is_alive(self, task_dir: Path) -> bool:
        return lock_is_held(self.store.state_path(task_dir, "turn.lock"))

    def _spawn(
        self,
        task_dir: Path,
        prompt: str,
        resume: bool,
        sequence: int,
        *,
        executable_name: str,
        worker_name: str,
        base_env_names: tuple[str, ...],
        passthrough_env: tuple[str, ...],
        worker_environment: dict[str, str],
    ) -> StartResult:
        executable = shutil.which(executable_name) or executable_name
        if not Path(executable).is_file() and shutil.which(executable) is None:
            detail = f"agent executable not found: {executable_name}"
            self._health = HealthReport(ERROR, detail)
            return StartResult(False, detail)

        state_dir = self.store.state_path(task_dir)
        write_json_atomic(
            state_dir / "turn.json",
            {
                "version": 1,
                "sequence": sequence,
                "pid": 0,
                "started_at": time.time(),
                "resumed": resume,
                "prompt": prompt,
                "runtime": self.name,
            },
        )
        (state_dir / "status.json").unlink(missing_ok=True)
        environment = {
            name: os.environ[name]
            for name in base_env_names + passthrough_env
            if name in os.environ
        }
        environment.update(worker_environment)
        environment["ORCHESTRA_AGENT_BIN"] = executable
        environment["ORCHESTRA_PROMPT"] = prompt
        environment["ORCHESTRA_RESUME"] = "1" if resume else "0"
        environment["ORCHESTRA_TURN_SEQUENCE"] = str(sequence)
        worker = Path(__file__).with_name(worker_name)
        try:
            with (state_dir / "spawn.log").open("ab") as log:
                process = subprocess.Popen(
                    [sys.executable, str(worker)],
                    cwd=str(task_dir),
                    env=environment,
                    stdout=log,
                    stderr=log,
                    start_new_session=True,
                )
        except OSError as error:
            detail = f"spawn failed: {error}"
            self._health = HealthReport(WARNING, detail)
            return StartResult(False, detail)
        turn = self.store.turn(task_dir)
        turn["pid"] = process.pid
        write_json_atomic(state_dir / "turn.json", turn)
        self._health = HealthReport(OK, f"started task turn {sequence}")
        return StartResult(True)

    def stop(self, snapshot: RunSnapshot, *, force: bool = False) -> None:
        pid = int(snapshot.turn.get("pid") or 0)
        if not pid:
            return
        try:
            os.killpg(pid, signal.SIGKILL if force else signal.SIGTERM)
        except ProcessLookupError:
            return
        except PermissionError as error:
            self._health = HealthReport(WARNING, f"could not stop pid {pid}: {error}")


class ClaudeCodeRuntime(_DetachedCliRuntime):
    name = "claude-code"

    def __init__(self, store: FileStateStore, config: ClaudeRuntimeConfig):
        super().__init__(store)
        self.config = config

    def start(
        self,
        task_dir: Path,
        prompt: str,
        resume: bool,
        sequence: int,
    ) -> StartResult:
        session_id = self.store.session_id(task_dir, self.name)
        resume = resume or self._has_transcript(task_dir, session_id)
        return self._spawn(
            task_dir,
            prompt,
            resume,
            sequence,
            executable_name=self.config.executable,
            worker_name="_worker.py",
            base_env_names=self.config.base_env_names,
            passthrough_env=self.config.passthrough_env,
            worker_environment={
                "ORCHESTRA_SESSION_ID": session_id,
                "ORCHESTRA_MODEL": self.config.model,
                "ORCHESTRA_PERMISSION_MODE": self.config.permission_mode,
                "ORCHESTRA_EXTRA_ARGS": json.dumps(self.config.extra_args),
                "ORCHESTRA_SYSTEM_PROMPT_FILE": self.config.system_prompt_file,
            },
        )

    @staticmethod
    def _has_transcript(task_dir: Path, session_id: str) -> bool:
        mangled = str(Path(task_dir).resolve()).replace("/", "-")
        return (
            Path.home()
            / ".claude"
            / "projects"
            / mangled
            / f"{session_id}.jsonl"
        ).is_file()


class CodexCliRuntime(_DetachedCliRuntime):
    name = "codex-cli"

    def __init__(self, store: FileStateStore, config: CodexRuntimeConfig):
        super().__init__(store)
        self.config = config

    def start(
        self,
        task_dir: Path,
        prompt: str,
        resume: bool,
        sequence: int,
    ) -> StartResult:
        session_id = self.store.session_id(task_dir, self.name, create=False)
        resume = bool(
            session_id
            and self.store.session_ready(task_dir, self.name, session_id)
        )
        session_path = self.store.session_path(task_dir, self.name)
        ready_path = self.store.session_ready_path(task_dir, self.name)
        return self._spawn(
            task_dir,
            prompt,
            resume,
            sequence,
            executable_name=self.config.executable,
            worker_name="_codex_worker.py",
            base_env_names=self.config.base_env_names,
            passthrough_env=self.config.passthrough_env,
            worker_environment={
                "ORCHESTRA_SESSION_ID": session_id,
                "ORCHESTRA_SESSION_PATH": str(session_path),
                "ORCHESTRA_SESSION_READY_PATH": str(ready_path),
                "ORCHESTRA_MODEL": self.config.model,
                "ORCHESTRA_CODEX_SANDBOX": self.config.sandbox,
                "ORCHESTRA_CODEX_NETWORK_ACCESS": (
                    "1" if self.config.network_access else "0"
                ),
                "ORCHESTRA_CODEX_APPROVAL_POLICY": self.config.approval_policy,
                "ORCHESTRA_CODEX_DANGEROUS_BYPASS": (
                    "1"
                    if self.config.dangerously_bypass_approvals_and_sandbox
                    else "0"
                ),
                "ORCHESTRA_CODEX_SKIP_GIT_CHECK": (
                    "1" if self.config.skip_git_repo_check else "0"
                ),
                "ORCHESTRA_EXTRA_ARGS": json.dumps(self.config.extra_args),
                "ORCHESTRA_SYSTEM_PROMPT_FILE": self.config.system_prompt_file,
            },
        )
