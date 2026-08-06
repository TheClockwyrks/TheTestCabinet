"""The `project` family: the epic/issue board.

An issue is the heavyweight unit of work — scope, non-scope and completion criteria are exactly what
a delegated child agent is briefed from — which is why `create_issue` asks for more than `add_task`
does. Its five required arguments are positional, and Python lets a program pass any of them by name,
which is what a call with this many strings in it should do.

Three lowerings live here, all of the same kind: a model writes `UNCHANGED` / `None` / a value and
the wrapper turns that into the membrane's tagged variant. `description` is a three-way text edit,
`epic_id` is a three-way epic assignment (leave it out to keep the grouping, `None` to ungroup, an id
to regroup), and a status is an `IssueStatus` member on this side and `in-progress` on the other.
"""

from __future__ import annotations

from wit_world.imports import board as wire
from wit_world.imports import types as wire_types

from ..errors import _call, _strings
from ..types import UNCHANGED, BoardUsage, EpicCreated, IssueCreated, IssueStatus, Unchanged


def _text_edit(value: str | None | Unchanged) -> wire_types.TextEdit:
    """Lower the `UNCHANGED` / `None` / string sentinel onto the membrane's three-way text edit."""
    if value is UNCHANGED:
        return wire_types.TextEdit_Keep()
    if value is None:
        return wire_types.TextEdit_Clear()
    return wire_types.TextEdit_Set(value)


def _epic_edit(value: str | None | Unchanged) -> wire.EpicAssignment:
    """Lower the `UNCHANGED` / `None` / id sentinel onto the membrane's epic assignment."""
    if value is UNCHANGED:
        return wire.EpicAssignment_Keep()
    if value is None:
        return wire.EpicAssignment_Ungroup()
    return wire.EpicAssignment_Set(value)


def _status(status: IssueStatus | None) -> wire.IssueStatus | None:
    """Lower a model-facing status onto the membrane's, whose `in-progress` carries a hyphen."""
    return None if status is None else wire.IssueStatus[status.name]


def _usage(usage: wire.BoardUsage) -> BoardUsage:
    """The membrane's budget record, as the model-facing one."""
    return BoardUsage(
        epics=usage.epics,
        max_epics=usage.max_epics,
        issues=usage.issues,
        max_issues=usage.max_issues,
    )


def create_epic(prefix: str, title: str, description: str) -> EpicCreated:
    """Create an epic to group related issues, and return the id it took and the board budget.

    `prefix` is upper-cased and becomes the epic's id, which is also what its issues are numbered
    from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and so on.

    Args:
        prefix: 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its issues
            are numbered from.
        title: A short line naming the body of work.
        description: What the epic covers, for a reader who has not seen its issues.

    Raises:
        ToolError: `invalid-argument` when the prefix is not 3-6 letters, and `conflict` when another
            epic already holds it.
    """
    created = _call(
        wire.create_epic, wire.EpicInput(prefix=prefix, title=title, description=description)
    )
    return EpicCreated(id=created.id, board=_usage(created.board))


def create_issue(
    title: str,
    in_scope: str,
    out_of_scope: str,
    completion_criteria: str,
    agent: str,
    *,
    description: str | None = None,
    blocked_by: list[str] | None = None,
    epic_id: str | None = None,
    reviewers: list[str] | None = None,
) -> IssueCreated:
    """Create a self-contained, dispatchable issue, and return the id the board **assigned** it.

    The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it has
    no epic; you do not choose it, so keep the returned one to block a later issue on this one or to
    wait for it. `in_scope`, `out_of_scope` and `completion_criteria` are what a child agent is
    briefed from, so write them for a reader with no other context.

    Args:
        title: A short line naming the work.
        in_scope: What the issue covers, precisely. Part of the brief a child agent is given.
        out_of_scope: What the issue deliberately does not cover, so the work stops where you meant
            it to.
        completion_criteria: What must be true for the issue to be done. It is what a reviewer checks
            the work against.
        agent: The agent the issue is dispatched to. It must be one you may spawn.
        description: What the work is. Written for a child agent with no other context.
        blocked_by: The ids of every issue that must be done before this one. Defaults to none.
        epic_id: The id of an existing epic to group it under. Leave it out to leave it ungrouped and
            numbered under `ISSUE`.
        reviewers: The agents that must approve the work, from the same set you may spawn. Required
            when this run's reviewers feature is on.

    Raises:
        ToolError: `invalid-argument` when `agent` or a reviewer is not yours to assign, and
            `conflict` on a blocker edge that would close a cycle.
    """
    created = _call(
        wire.create_issue,
        wire.IssueInput(
            title=title,
            description=description,
            in_scope=in_scope,
            out_of_scope=out_of_scope,
            completion_criteria=completion_criteria,
            blocked_by=_strings("create_issue", "blocked_by", blocked_by),
            epic_id=epic_id,
            agent=agent,
            reviewers=_strings("create_issue", "reviewers", reviewers),
        ),
    )
    return IssueCreated(id=created.id, board=_usage(created.board))


def update_issue(
    id: str,
    *,
    title: str | None = None,
    description: str | None | Unchanged = UNCHANGED,
    in_scope: str | None = None,
    out_of_scope: str | None = None,
    completion_criteria: str | None = None,
    status: IssueStatus | None = None,
    epic_id: str | None | Unchanged = UNCHANGED,
) -> None:
    """Revise an issue; supply at least one field.

    Args:
        id: The issue to revise.
        title: The title to replace the old one with. Leave it out to keep the one it has.
        description: The description to replace the old one with; `None` clears it, and leaving it
            out keeps the one it has.
        in_scope: The scope statement to replace the old one with.
        out_of_scope: The non-scope statement to replace the old one with.
        completion_criteria: The completion criteria to replace the old ones with.
        status: Where the issue now stands. Leave it out to keep the status it has.
        epic_id: The epic to regroup it under; `None` detaches it from the one it has, and leaving it
            out keeps the grouping.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    _call(
        wire.update_issue,
        id,
        wire.IssuePatch(
            title=title,
            description=_text_edit(description),
            in_scope=in_scope,
            out_of_scope=out_of_scope,
            completion_criteria=completion_criteria,
            status=_status(status),
            epic=_epic_edit(epic_id),
        ),
    )


def set_issue_blocked_by(id: str, blocked_by: list[str]) -> None:
    """Replace an issue's whole blocker set; an empty list clears every blocker.

    Args:
        id: The issue whose blockers to replace.
        blocked_by: The ids of every issue that must now be done before it. An empty list clears them
            all.

    Raises:
        ToolError: `not-found` for an unknown id, and `conflict` when an edge would close a cycle.
    """
    _call(wire.set_issue_blocked_by, id, _strings("set_issue_blocked_by", "blocked_by", blocked_by))


def remove_epic(id: str) -> BoardUsage:
    """Remove an epic, keeping its issues and ungrouping them, and return the board budget.

    Args:
        id: The epic to remove.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    return _usage(_call(wire.remove_epic, id))


def remove_issue(id: str) -> BoardUsage:
    """Remove an issue and every blocker edge pointing at it, and return the board budget.

    Args:
        id: The issue to remove.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    return _usage(_call(wire.remove_issue, id))


def wait_for_issue(id: str) -> str:
    """Register a wait on an issue and return an acknowledgement.

    It does not block inside your program — it records the wait and returns at once, so the rest of
    your program still runs; the suspension happens after the program ends, between turns. Once the
    program finishes the run suspends, freeing this agent's slot for others, until the issue is
    terminal (done, or failed if its assigned agent could not complete it), then resumes on the next
    turn. Use it to sequence your next turn's work behind an issue you depend on.

    Args:
        id: The issue to wait on. It may not be the issue you were assigned to implement.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    return _call(wire.wait_for_issue, id)
