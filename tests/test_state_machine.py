from orchestra.state_machine import (
    CLAIMED,
    FAILED,
    GAVE_UP,
    IDLE,
    RUNNING,
    STOPPED,
    STOPPING,
    WAITING,
    derive_state,
)


def state(**overrides):
    values = {
        "alive": False,
        "stopping": False,
        "gave_up": False,
        "turn": {},
        "status": None,
        "waits": False,
        "starting": False,
    }
    values.update(overrides)
    return derive_state(**values)


def test_lifecycle_states_are_derived_from_durable_facts():
    assert state() == CLAIMED
    assert state(alive=True) == RUNNING
    assert state(alive=True, stopping=True) == STOPPING
    assert state(stopping=True) == STOPPED
    assert state(gave_up=True) == GAVE_UP

    turn = {"sequence": 2}
    assert state(turn=turn) == FAILED
    assert state(turn=turn, starting=True) == RUNNING
    assert state(turn=turn, status={"sequence": 1, "exit_code": 0}) == FAILED
    assert state(turn=turn, status={"sequence": 2, "exit_code": 1}) == FAILED
    assert state(
        turn=turn, status={"sequence": 2, "exit_code": 0, "is_error": True}
    ) == FAILED
    assert state(turn=turn, status={"sequence": 2, "exit_code": 0}) == IDLE
    assert state(
        turn=turn, status={"sequence": 2, "exit_code": 0}, waits=True
    ) == WAITING
