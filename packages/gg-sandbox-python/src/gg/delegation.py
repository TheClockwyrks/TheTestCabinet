"""Delegate work to child agents, and hand this session's own turn to another agent.

`wait_for_subagents` blocks while children run, and the run's budget keeps ticking while it does.

A child is briefed with exactly one of a self-contained `prompt` or a board `issue_id`; neither and
both are refused.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from wit_world.imports import delegation as wire

from ._registry import alias, missing, operation
from .core import ApiError, ApiErrorCode, _call, _strings

__all__ = [
    "AgentEnding",
    "SubagentHandle",
    "SubagentResult",
    "exec",
    "fork",
    "send_message",
    "spawn_subagent",
    "transition_state",
    "wait_for_subagents",
]


@dataclass(frozen=True)
class SubagentHandle:
    """A child agent that was spawned and is now running in parallel."""

    id: str
    """The child's id — what `wait_for_subagents` and `send_message` take."""

    slot: str
    """The agent profile it runs as."""

    model_id: str
    """The model actually bound to that agent."""

    @alias("delegation.send_message")
    def send(self, message: str) -> None:
        """Deliver a message to this child's inbox, which it reads at its next turn.

        Args:
            message: What to put in its inbox.

        Raises:
            ApiError: `conflict` when this child has already returned.
        """
        send_message(self.id, message)


class AgentEnding(Enum):
    """How a child agent's loop ended."""

    COMPLETED = "completed"
    """It finished normally, ending its own session, and its summary is what it returned."""

    EXHAUSTED = "exhausted"
    """It reached the per-run turn ceiling."""

    TIMED_OUT = "timed_out"
    """It passed its wall-clock deadline."""

    MODEL_ERROR = "model_error"
    """A model turn failed."""

    AUTH_ERROR = "auth_error"
    """The run's credential was refused."""

    LIMIT_EXCEEDED = "limit_exceeded"
    """An execution ceiling stopped it — consecutive errors, error rate, or cost."""


@dataclass(frozen=True)
class SubagentResult:
    """One child agent's collected result."""

    id: str
    """The child's id."""

    status: AgentEnding | None
    """How it finished; `None` when it produced no return value at all."""

    summary: str
    """Its final message."""


def _brief(fn: str, prompt: str | None, issue_id: str | None) -> wire.SubagentBrief:
    """Lower a brief onto the membrane's variant.

    The check is explicit rather than delegated to the bindings because "neither" is the mistake that
    actually happens — the native JSON schema declares both fields optional and enforces the choice
    only at dispatch — and the message that comes back has to name both options.
    """
    if (prompt is None) == (issue_id is None):
        raise ApiError(
            fn,
            ApiErrorCode.INVALID_ARGUMENT,
            "expected exactly one of `prompt` or `issue_id`",
        )
    return (
        wire.SubagentBrief_Prompt(prompt)
        if prompt is not None
        else wire.SubagentBrief_Issue(issue_id)
    )


def _handle(handle: wire.SubagentHandle) -> SubagentHandle:
    """The membrane's handle record, as the model-facing one."""
    return SubagentHandle(id=handle.id, slot=handle.slot, model_id=handle.model_id)


@operation("delegation.spawn_subagent")
def spawn_subagent(
    agent: str, *, prompt: str | None = None, issue_id: str | None = None
) -> SubagentHandle:
    """Delegate scoped work to a child agent, which runs in parallel while the program continues.

    `agent` names one of the agent profiles this session may spawn — the system prompt lists them,
    and the profile selects the child's model, tools and instructions. The brief is exactly one of
    `prompt` and `issue_id`. The child shares the workspace.

    Args:
        agent: The agent profile to run the child as, from the ones this session may spawn. It
            selects the child's model, tools and instructions.
        prompt: Self-contained instructions for the child. Give this or `issue_id`, never both and
            never neither.
        issue_id: The board issue to brief the child from. Give this or `prompt`, never both and
            never neither.

    Returns:
        The child's handle: the id `wait_for_subagents` and `send_message` take, the agent profile
            it runs as, and the model bound to that profile.

    Raises:
        ApiError: `limit-exceeded` at the delegation depth cap, and `invalid-argument` when `agent`
            is not one this session may spawn.
    """
    return _handle(
        _call(
            wire.spawn_subagent,
            wire.SpawnRequest(agent=agent, task=_brief("spawn_subagent", prompt, issue_id)),
        )
    )


@operation("delegation.wait_for_subagents")
def wait_for_subagents(ids: list[str] | None = None) -> list[SubagentResult]:
    """Block until the named children have finished and collect their results in dispatch order.

    The default waits for every outstanding child. The run's wall-clock budget keeps running
    throughout.

    Args:
        ids: The children to wait for, as `spawn_subagent` returned them. The default waits for every
            one still outstanding.

    Returns:
        One result per child, in dispatch order, each carrying its final message and how it ended. A
            child that produced no return value at all has no `status`.

    Raises:
        ApiError: `not-found` for an id this session did not spawn.
    """
    waited = None if ids is None else _strings("wait_for_subagents", "ids", ids)
    return [
        SubagentResult(
            id=result.id,
            status=None if result.status is None else AgentEnding[result.status.name],
            summary=result.summary,
        )
        for result in _call(wire.wait_for_subagents, waited)
    ]


@operation("delegation.send_message")
def send_message(agent_id: str, message: str) -> None:
    """Deliver a message to a running child agent's inbox, which it reads at its next turn.

    Args:
        agent_id: The child to deliver to, as `spawn_subagent` returned it.
        message: What to put in its inbox. It reads it at its next turn.

    Raises:
        ApiError: `not-found` for an unknown agent id, and `conflict` when that child has already
            returned.
    """
    _call(wire.send_message, agent_id, message)


@operation("delegation.transition_state")
def transition_state(state: str, note: str | None = None) -> None:
    """Move the process this session is running inside on to another of its states.

    The state is named the way an agent to spawn is named. It is bound only when a state machine is
    driving the session and the current state has somewhere to go. It is registered rather than
    performed: the call validates the target, returns, and the program runs on to its end. The first
    declaration in a turn is the one that stands.

    Args:
        state: The state to move on to, named the way an agent to spawn is named.
        note: The opening message the next state's agent sees. The default tells it nothing.

    Raises:
        ApiError: `invalid-argument` for a state this session may not move to, `refused` for a
            second declaration in one turn, and `unavailable` when this session is not running inside
            a state machine at all.
    """
    _call(wire.transition_state, state, note)


@operation("delegation.exec")
def exec(agent: str, prompt: str | None = None) -> None:
    """Continue this session as a different agent, from the next turn.

    The named agent takes over with its own model, tools and instructions, keeping every capability
    the two of them share and the whole conversation. Registered rather than performed: the call
    validates the target, returns, and the program runs on to its end. A session makes one succession
    per turn, and none at all while a state machine is driving the session.

    Args:
        agent: The agent to become, from the ones this session may become.
        prompt: Its opening message. It already has the whole conversation, so this is the
            instruction rather than a briefing. The default tells it nothing.

    Raises:
        ApiError: `invalid-argument` for an agent this session may not become, `refused` for a
            second succession in one turn, and `unavailable` when this session is running inside a
            state machine, which is left by moving it on to another of its states instead.
    """
    _call(wire.exec, agent, prompt)


@operation("delegation.fork")
def fork(prompt: str) -> SubagentHandle:
    """Run a copy of this session, in parallel, on something it will not do itself.

    The copy has the same model, the same tools and a private copy of the whole conversation, so
    `prompt` is the difference rather than a briefing.

    The copy starts once this turn's results are recorded, so a later turn is the earliest a wait can
    collect it, and waiting on it in the program that made it never returns it.

    Args:
        prompt: What the copy is to do instead. It has the whole conversation already, so this is the
            difference rather than a briefing.

    Returns:
        The copy's handle, carrying the id a later wait collects it by.

    Raises:
        ApiError: `invalid-argument` for a blank prompt, `limit-exceeded` at the delegation depth
            cap, and `unavailable` when the run has no delegation runtime to run the copy in.
    """
    return _handle(_call(wire.fork, prompt))


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
