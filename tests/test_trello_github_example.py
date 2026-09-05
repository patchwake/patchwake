import pytest

from examples.trello_github.adapters import GitHubActivitySource, TrelloBoard, _mentions
from examples.trello_github.orchestrator import build_engine
from orchestra.runtime import ClaudeCodeRuntime, CodexCliRuntime


def test_trello_labels_define_repository_and_priority():
    item = TrelloBoard._item(
        {
            "id": "abcdef",
            "shortLink": "xyZ12",
            "name": "Do work",
            "desc": "Details",
            "url": "https://trello.test/c/xyZ12",
            "idList": "ready",
            "labels": [{"name": "repo:acme/widgets"}, {"name": "priority:7"}],
        }
    )
    assert item.key == "TRELLO-xyZ12"
    assert item.priority == 7
    assert item.metadata["repository"] == "acme/widgets"
    assert item.metadata["branch"] == "agent-TRELLO-xyZ12"


def test_github_link_pagination_and_mentions_are_conservative():
    header = (
        '<https://api.github.test/p2>; rel="next", '
        '<https://api.github.test/p4>; rel="last"'
    )
    assert GitHubActivitySource._next_link(header) == "https://api.github.test/p2"
    assert _mentions("please check @build-bot, thanks", "build-bot")
    assert not _mentions("> earlier @build-bot\nno new request", "build-bot")
    assert not _mentions("mail build-bot@example.test", "build-bot")


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("claude", ClaudeCodeRuntime), ("codex", CodexCliRuntime)],
)
def test_composition_selects_agent_engine(monkeypatch, configured, expected):
    monkeypatch.setenv("ORCHESTRA_AGENT_ENGINE", configured)
    assert isinstance(build_engine(dry_run=True).runtime, expected)


def test_composition_rejects_unknown_agent_engine(monkeypatch):
    monkeypatch.setenv("ORCHESTRA_AGENT_ENGINE", "mystery")
    with pytest.raises(ValueError, match="must be 'claude' or 'codex'"):
        build_engine(dry_run=True)
