"""The `agents` family: handing scoped work to child agents.

`wait_for_subagents` can dominate a turn's wall clock — it blocks while real agents run — and the
run's budget keeps ticking while it does. A program should therefore spawn broadly and wait once, not
spawn-and-wait in a loop.

The brief is the one place this SDK enforces an "exactly one of" the native tool-calling schema can
only check at dispatch: a child is briefed either with a self-contained `prompt` or with a board
`issue_id`, both of them keyword arguments, and the wrapper refuses "neither" and "both" by name
rather than letting the membrane's variant decide which one it saw first.
"""

from __future__ import annotations

from wit_world.imports import delegation as wire

from ..errors import ToolError, _call, _strings
from ..types import AgentEnding, SubagentHandle, SubagentResult, ToolErrorCode


def _brief(fn: str, prompt: str | None, issue_id: str | None) -> wire.SubagentBrief:
    """Lower a brief onto the membrane's variant.

    The check is explicit rather than delegated to the bindings because "neither" is the mistake that
    actually happens — the native JSON schema declares both fields optional and enforces the choice
    only at dispatch — and the message a model gets back has to name both options.
    """
    if (prompt is None) == (issue_id is None):
        raise ToolError(
            fn,
            ToolErrorCode.INVALID_ARGUMENT,
            "expected exactly one of `prompt` or `issue_id`",
        )
    return wire.SubagentBrief_Prompt(prompt) if prompt is not None else wire.SubagentBrief_Issue(issue_id)


def _handle(handle: wire.SubagentHandle) -> SubagentHandle:
    """The membrane's handle record, as the model-facing one."""
    return SubagentHandle(id=handle.id, slot=handle.slot, model_id=handle.model_id)


def spawn_subagent(agent: str, *, prompt: str | None = None, issue_id: str | None = None) -> SubagentHandle:
    """Delegate scoped work to a child agent and return its handle immediately — the child runs in
    parallel while your program continues.

    Brief it with exactly one of `prompt` (self-contained instructions) or `issue_id` (a board issue).
    The child shares your workspace.

    Args:
        agent: The agent profile to run the child as, from the ones you may spawn — the system prompt
            lists them. It selects the child's model, tools and instructions.
        prompt: Self-contained instructions for the child. Give this or `issue_id`, never both and
            never neither.
        issue_id: The board issue to brief the child from. Give this or `prompt`, never both and
            never neither.

    Raises:
        ToolError: `limit-exceeded` at the delegation depth cap, and `invalid-argument` if `agent` is
            not one you may spawn.
    """
    return _handle(
        _call(
            wire.spawn_subagent,
            wire.SpawnRequest(agent=agent, task=_brief("spawn_subagent", prompt, issue_id)),
        )
    )


def wait_for_subagents(ids: list[str] | None = None) -> list[SubagentResult]:
    """Block until the named children have finished — or, with no argument, until every outstanding
    child has — and collect their results in dispatch order.

    The run's wall-clock budget keeps running while you wait, so wait once for many children rather
    than once per child.

    Args:
        ids: The children to wait for. Leave it out to wait for every one still outstanding.

    Raises:
        ToolError: `not-found` for an unknown id.
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


def send_message(agent_id: str, message: str) -> None:
    """Deliver a message to a running child agent's inbox; it reads the message at its next turn.

    Args:
        agent_id: The child to deliver to, as `spawn_subagent` returned it.
        message: What to put in its inbox. It reads it at its next turn.

    Raises:
        ToolError: `not-found` for an unknown agent id, and `conflict` when that child has already
            returned.
    """
    _call(wire.send_message, agent_id, message)


def transition_state(state: str, note: str | None = None) -> None:
    """Move the process you are running inside on to another of its states, naming the state the way
    you name an agent to spawn.

    Bound only when a state machine is driving you and the state you are in has somewhere to go. Like
    `context.compact` it is registered rather than performed: the call validates the target, returns,
    and your program runs on to its end — the transition happens after that, because replacing your
    agent (and your window) mid-program would pull every remaining call out from under it. The FIRST
    declaration stands.

    Args:
        state: The state to move on to, named the way you name an agent to spawn.
        note: The opening message the next state's agent sees.

    Raises:
        ToolError: `refused` for a second declaration in one turn, and `invalid-argument` for a state
            you may not move to.
    """
    _call(wire.transition_state, state, note)


def exec(agent: str, prompt: str | None = None) -> None:
    """Continue this session as a different agent: the named agent takes over from your next turn with
    its own model, tools and instructions, keeping every capability the two of you both have — your
    whole conversation above all, so it needs no catching up.

    Registered rather than performed, exactly as `transition_state` is and for the same reason: your
    window would otherwise be pulled out from under the program still composing into it. A session
    makes one succession per turn. Bound only when your agent may make agent transitions and has
    agents it may become, and never while a state machine is driving you.

    Args:
        agent: The agent to become, from the ones you may become.
        prompt: Its opening message. It already has your whole conversation, so this is the
            instruction rather than a briefing.

    Raises:
        ToolError: `refused` for an `exec` after a `transition_state` or a second `exec`, and
            `invalid-argument` for an agent you may not become.
    """
    _call(wire.exec, agent, prompt)


def fork(prompt: str) -> SubagentHandle:
    """Run a copy of yourself, in parallel, on something you will not do yourself.

    The copy has your model, your tools and a private copy of your whole conversation, so `prompt` is
    the *difference* rather than a briefing — everything you have worked out is already there.

    Its handle comes back immediately, but the copy itself starts once this turn's tool results are
    recorded (the conversation it inherits has to be a complete one), so `wait_for_subagents` can only
    collect it on a later turn — do not wait on it in the program that made it.

    Args:
        prompt: What the copy is to do instead of what you are doing. It has your whole conversation
            already, so write the difference rather than a briefing.

    Raises:
        ToolError: `limit-exceeded` at the delegation depth cap.
    """
    return _handle(_call(wire.fork, prompt))
