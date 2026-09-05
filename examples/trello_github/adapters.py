"""Read-only Trello and GitHub adapters for the example composition."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Iterable, Mapping

from orchestra.models import (
    ERROR,
    OK,
    WARNING,
    Activity,
    HealthReport,
    TaskObservation,
    WaitCondition,
    WorkItem,
)


def _timestamp(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _mentions(body: str, login: str) -> bool:
    if not body or not login:
        return False
    unquoted = "\n".join(
        line for line in body.splitlines() if not line.lstrip().startswith(">")
    )
    return bool(
        re.search(
            rf"(?<![A-Za-z0-9_.-])@{re.escape(login)}(?![A-Za-z0-9_-])",
            unquoted,
            re.IGNORECASE,
        )
    )


class JsonHttp:
    def __init__(self, headers: Mapping[str, str] | None = None):
        self.headers = dict(headers or {})

    def get(self, url: str) -> tuple[Any, Mapping[str, str]]:
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", **self.headers},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response), dict(response.headers.items())
        except urllib.error.HTTPError as error:
            detail = error.read(1024).decode("utf-8", errors="replace")
            safe_url = url.split("?", 1)[0]
            raise RuntimeError(
                f"GET {safe_url}: HTTP {error.code}: {detail}"
            ) from error
        except urllib.error.URLError as error:
            safe_url = url.split("?", 1)[0]
            raise RuntimeError(f"GET {safe_url}: {error.reason}") from error


class TrelloBoard:
    """The configured Trello lists are the agent's complete assignment plate."""

    name = "trello"

    def __init__(
        self,
        *,
        key: str,
        token: str,
        board_id: str,
        ready_list_ids: Iterable[str],
        http: JsonHttp | None = None,
    ):
        self.key = key
        self.token = token
        self.board_id = board_id
        self.ready_list_ids = frozenset(value for value in ready_list_ids if value)
        self.http = http or JsonHttp()
        self._health = HealthReport(OK, "not observed yet")

    def fetch(self) -> list[WorkItem]:
        missing = [
            name
            for name, value in (
                ("TRELLO_KEY", self.key),
                ("TRELLO_TOKEN", self.token),
                ("TRELLO_BOARD_ID", self.board_id),
                ("TRELLO_READY_LIST_IDS", self.ready_list_ids),
            )
            if not value
        ]
        if missing:
            self._health = HealthReport(ERROR, f"missing {', '.join(missing)}")
            raise RuntimeError(self._health.message)
        query = urllib.parse.urlencode(
            {
                "key": self.key,
                "token": self.token,
                "fields": (
                    "id,shortLink,name,desc,url,idList,labels,pos,dateLastActivity"
                ),
            }
        )
        rows, _ = self.http.get(
            f"https://api.trello.com/1/boards/{urllib.parse.quote(self.board_id)}/cards"
            f"?{query}"
        )
        items = [
            self._item(row)
            for row in rows
            if row.get("idList") in self.ready_list_ids
        ]
        self._health = HealthReport(OK, f"{len(items)} assigned card(s)")
        return items

    def health(self) -> HealthReport:
        return self._health

    @staticmethod
    def _item(row: Mapping[str, Any]) -> WorkItem:
        labels = [str(label.get("name") or "") for label in row.get("labels") or []]
        repository = next(
            (
                label[5:].strip()
                for label in labels
                if label.lower().startswith("repo:")
            ),
            "",
        )
        priority = 100
        for label in labels:
            if label.lower().startswith("priority:"):
                try:
                    priority = int(label.split(":", 1)[1].strip())
                except ValueError:
                    pass
        stable = str(row.get("shortLink") or row["id"])
        return WorkItem(
            key=f"TRELLO-{stable}",
            title=str(row.get("name") or ""),
            description=str(row.get("desc") or ""),
            url=str(row.get("url") or ""),
            priority=priority,
            metadata={
                "trello_card_id": row["id"],
                "trello_list_id": row.get("idList") or "",
                "repository": repository,
                "branch": f"agent-TRELLO-{stable}",
            },
        )


class GitHubActivitySource:
    """Observe PR discussion, reviews, state, and checks for task branches."""

    name = "github"

    def __init__(
        self,
        *,
        token: str,
        bot_login: str,
        api_url: str = "https://api.github.com",
        http: JsonHttp | None = None,
    ):
        self.token = token
        self.bot_login = bot_login
        self.api_url = api_url.rstrip("/")
        self.http = http or JsonHttp(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "agent-orchestra-example",
            }
        )
        self._health = HealthReport(OK, "not observed yet")

    def observe(self, items: list[WorkItem]) -> dict[str, TaskObservation]:
        missing = [
            name
            for name, value in (
                ("GITHUB_TOKEN", self.token),
                ("GITHUB_BOT_LOGIN", self.bot_login),
            )
            if not value
        ]
        if missing:
            self._health = HealthReport(ERROR, f"missing {', '.join(missing)}")
            raise RuntimeError(self._health.message)
        result: dict[str, TaskObservation] = {}
        pulls_seen = 0
        unmapped = 0
        for item in items:
            repository = str(item.metadata.get("repository") or "")
            branch = str(item.metadata.get("branch") or f"agent-{item.key}")
            if not repository or repository.count("/") != 1:
                unmapped += 1
                result[item.key] = TaskObservation()
                continue
            owner = repository.split("/", 1)[0]
            pulls = self._pages(
                f"/repos/{repository}/pulls",
                {"state": "all", "head": f"{owner}:{branch}", "per_page": "100"},
            )
            if not pulls:
                result[item.key] = TaskObservation()
                continue
            pull = max(pulls, key=lambda row: _timestamp(row.get("updated_at")))
            pulls_seen += 1
            result[item.key] = self._observe_pull(repository, pull)
        self._health = (
            HealthReport(
                WARNING,
                f"observed {pulls_seen} pull request(s); "
                f"{unmapped} task(s) lack a repo:owner/name label",
            )
            if unmapped
            else HealthReport(OK, f"observed {pulls_seen} pull request(s)")
        )
        return result

    def health(self) -> HealthReport:
        return self._health

    def _observe_pull(
        self, repository: str, pull: Mapping[str, Any]
    ) -> TaskObservation:
        number = int(pull["number"])
        ref = f"{repository}#{number}"
        activities: list[Activity] = []
        issue_comments = self._pages(
            f"/repos/{repository}/issues/{number}/comments", {"per_page": "100"}
        )
        for row in issue_comments:
            activities.append(
                Activity(
                    stream=f"github:{repository}:{number}:issue-comments",
                    cursor=float(row["id"]),
                    kind="comment",
                    author=str((row.get("user") or {}).get("login") or ""),
                    url=str(row.get("html_url") or pull["html_url"]),
                    ref=ref,
                    directed=_mentions(str(row.get("body") or ""), self.bot_login),
                )
            )
        review_comments = self._pages(
            f"/repos/{repository}/pulls/{number}/comments", {"per_page": "100"}
        )
        for row in review_comments:
            activities.append(
                Activity(
                    stream=f"github:{repository}:{number}:review-comments",
                    cursor=float(row["id"]),
                    kind="review-comment",
                    author=str((row.get("user") or {}).get("login") or ""),
                    url=str(row.get("html_url") or pull["html_url"]),
                    ref=ref,
                    directed=True,
                )
            )
        reviews = self._pages(
            f"/repos/{repository}/pulls/{number}/reviews", {"per_page": "100"}
        )
        for row in reviews:
            state = str(row.get("state") or "").lower()
            if state not in {"approved", "changes_requested", "commented"}:
                continue
            activities.append(
                Activity(
                    stream=f"github:{repository}:{number}:reviews",
                    cursor=float(row["id"]),
                    kind=f"review-{state.replace('_', '-')}",
                    author=str((row.get("user") or {}).get("login") or ""),
                    url=str(row.get("html_url") or pull["html_url"]),
                    ref=ref,
                    directed=True,
                )
            )

        if pull.get("state") == "closed":
            activities.append(
                Activity(
                    stream=f"github:{repository}:{number}:state",
                    cursor=_timestamp(pull.get("closed_at") or pull.get("updated_at")),
                    kind="merged" if pull.get("merged_at") else "closed",
                    author="",
                    url=str(pull["html_url"]),
                    ref=ref,
                )
            )

        head = (pull.get("head") or {}).get("sha") or ""
        waits: tuple[WaitCondition, ...] = ()
        if head:
            rows = self._check_runs(repository, head)
            active = [row for row in rows if row.get("status") != "completed"]
            if active:
                since = min(
                    (
                        _timestamp(row.get("started_at") or row.get("created_at"))
                        for row in active
                    ),
                    default=0.0,
                )
                waits = (
                    WaitCondition(
                        name="CI",
                        url=str(pull["html_url"]),
                        since=since,
                        ref=ref,
                    ),
                )
            elif rows:
                failures = [
                    row
                    for row in rows
                    if row.get("conclusion") not in {"success", "neutral", "skipped"}
                ]
                chosen = failures or rows
                latest = max(chosen, key=lambda row: float(row["id"]))
                activities.append(
                    Activity(
                        stream=f"github:{repository}:{number}:checks:{head}",
                        cursor=float(latest["id"]),
                        kind="ci-failed" if failures else "ci-passed",
                        author="",
                        url=str(latest.get("html_url") or pull["html_url"]),
                        ref=ref,
                    )
                )
        return TaskObservation(tuple(activities), waits)

    def _check_runs(self, repository: str, head: str) -> list[Mapping[str, Any]]:
        url = (
            f"{self.api_url}/repos/{repository}/commits/{head}/check-runs?per_page=100"
        )
        rows: list[Mapping[str, Any]] = []
        while url:
            page, headers = self.http.get(url)
            rows.extend(page.get("check_runs") or [])
            url = self._next_link(headers.get("Link", ""))
        return rows

    def _pages(
        self, path: str, query: Mapping[str, str]
    ) -> list[Mapping[str, Any]]:
        url = f"{self.api_url}{path}?{urllib.parse.urlencode(query)}"
        rows: list[Mapping[str, Any]] = []
        while url:
            page, headers = self.http.get(url)
            rows.extend(page)
            url = self._next_link(headers.get("Link", ""))
        return rows

    @staticmethod
    def _next_link(header: str) -> str:
        for part in header.split(","):
            match = re.match(r'\s*<([^>]+)>;\s*rel="([^"]+)"', part)
            if match and match.group(2) == "next":
                return match.group(1)
        return ""
