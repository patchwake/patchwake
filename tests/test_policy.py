from orchestra.models import Activity
from orchestra.policy import activity_prompt, advance_seen, fresh_activities


def event(cursor=1, author="human", directed=True, stream="github:r:1:comments"):
    return Activity(
        stream=stream,
        cursor=cursor,
        kind="comment",
        author=author,
        url="https://example.test/comment/1",
        ref="org/repo#1",
        directed=directed,
    )


def test_fresh_activity_filters_seen_self_and_undirected_events():
    activities = [
        event(cursor=1),
        event(cursor=3, author="bot"),
        event(cursor=4, directed=False),
        event(cursor=5, directed=None),
    ]
    assert fresh_activities(
        activities, {activities[0].stream: 1}, frozenset({"bot"}), True
    ) == [activities[3]]


def test_cursor_advance_is_per_stream_and_monotonic():
    assert advance_seen(
        {"a": 4}, [event(cursor=3, stream="a"), event(cursor=2, stream="b")]
    ) == {"a": 4, "b": 2}


def test_activity_prompt_contains_pointers_but_no_remote_body_field():
    prompt = activity_prompt([event()])
    assert "org/repo#1" in prompt
    assert "https://example.test/comment/1" in prompt
    assert "Read the authoritative content" in prompt
