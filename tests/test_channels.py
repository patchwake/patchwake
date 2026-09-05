from orchestra.channels import HealthChangeChannel, health_changed
from orchestra.models import ERROR, OK, HealthReport, TickReport


def report(health, dry=False):
    return TickReport(1, 2, (), {}, health, dry_run=dry)


def test_health_change_policy_ignores_ok_message_churn():
    previous = {"github": {"status": OK, "message": "one PR"}}
    assert not health_changed(previous, "github", HealthReport(OK, "two PRs"))
    assert health_changed(previous, "github", HealthReport(ERROR, "offline"))
    previous = {"github": {"status": ERROR, "message": "offline"}}
    assert health_changed(previous, "github", HealthReport(ERROR, "unauthorized"))


def test_health_channel_is_edge_triggered_and_dry_run_is_read_only(tmp_path):
    sent = []
    path = tmp_path / "health.json"
    channel = HealthChangeChannel(path, sent.append)
    current = report({"github": HealthReport(OK, "one PR")})
    channel.publish(current)
    channel.publish(report({"github": HealthReport(OK, "two PRs")}))
    assert len(sent) == 1
    before = path.read_text()

    channel.publish(report({"github": HealthReport(ERROR, "offline")}, dry=True))

    assert path.read_text() == before
    assert len(sent) == 1
