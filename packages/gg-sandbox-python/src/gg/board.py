"""The epic and issue board, on which work is decomposed into dispatchable units.

An issue is heavyweight and self-contained: its scope, non-scope and completion criteria are exactly
what a delegated child agent is briefed from, which is why `create_issue` asks for more than a task
does. Its five required arguments are positional, and Python lets a program pass any of them by name,
which is what a call with this many strings in it should do.

Two of an issue's patch fields are three-way, and both take the same shape: leaving the argument out
keeps what is there, `None` clears or detaches, and a value replaces or regroups.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from wit_world.imports import board as wire
from wit_world.imports import types as wire_types

from ._registry import alias, missing, operation
from .core import UNCHANGED, Unchanged, _call, _strings

__all__ = [
    "BoardUsage",
    "EpicCreated",
    "IssueCreated",
    "IssueStatus",
    "create_epic",
    "create_issue",
    "remove_epic",
    "remove_issue",
    "set_issue_blocked_by",
    "update_issue",
    "wait_for_issue",
]


class IssueStatus(Enum):
    """Where an issue stands."""

    OPEN = "open"
    """Not started, and dispatchable once its blockers are done."""

    IN_PROGRESS = "in_progress"
    """Dispatched, with its assigned agent working on it."""

    DONE = "done"
    """Finished and, where this run requires reviewers, approved."""


@dataclass(frozen=True)
class BoardUsage:
    """How much of the run's board budget is used, after the call that returned it."""

    epics: int
    """Epics currently on the board."""

    max_epics: int
    """The most epics this run allows."""

    issues: int
    """Issues currently on the board."""

    max_issues: int
    """The most issues this run allows."""


@dataclass(frozen=True)
class EpicCreated:
    """An epic that was just created: the id its prefix resolved to, and the board budget."""

    id: str
    """The epic's id — the given prefix, upper-cased (`auth` becomes `AUTH`).

    It is what groups issues under the epic, and the stem its issues are numbered from (`AUTH-1`).
    """

    board: BoardUsage
    """How much of the board budget is used."""


@dataclass(frozen=True)
class IssueCreated:
    """An issue that was just created: the id the board assigned it, and the board budget."""

    id: str
    """The id the board assigned (`AUTH-1`), which is the board's to choose rather than the caller's.

    It is what blocks a later issue on this one, and what waits for it.
    """

    board: BoardUsage
    """How much of the board budget is used."""

    @alias("board.wait_for_issue")
    def wait(self) -> str:
        """Register a wait on this issue, which suspends the agent between turns until it is terminal.

        `wait_for_issue` with the id already supplied, for the common case where the issue was just
        created and the next turn's work is sequenced behind it.

        Returns:
            gg's acknowledgement that the wait is registered, which says what happens once the
                program ends.

        Raises:
            ApiError: `not-found` when the issue has since been removed.
        """
        return wait_for_issue(self.id)


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


@operation("board.create_epic")
def create_epic(prefix: str, title: str, description: str) -> EpicCreated:
    """Create an epic to group related issues.

    `prefix` is 3-6 letters naming the epic; it is upper-cased and becomes the epic's id, which is
    also what its issues are numbered from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and
    so on.

    Args:
        prefix: 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its issues
            are numbered from.
        title: A short line naming the body of work.
        description: What the epic covers, for a reader who has not seen its issues.

    Returns:
        The id the prefix resolved to, and the board budget the epic left behind.

    Raises:
        ApiError: `invalid-argument` when the prefix is not 3-6 letters or a required field is
            blank, `conflict` when another epic already holds the prefix, and `limit-exceeded` at the
            board's epic cap.
    """
    created = _call(
        wire.create_epic, wire.EpicInput(prefix=prefix, title=title, description=description)
    )
    return EpicCreated(id=created.id, board=_usage(created.board))


@operation("board.create_issue")
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
    """Create a self-contained, dispatchable issue, which a child agent can be briefed from.

    `in_scope`, `out_of_scope` and `completion_criteria` are what a child agent is briefed from,
    so they are written for a reader with no other context.

    Args:
        title: A short line naming the work.
        in_scope: What the issue covers, precisely. Part of the brief a child agent is given.
        out_of_scope: What the issue deliberately does not cover, so the work stops where it was
            meant to.
        completion_criteria: What must be true for the issue to be done. It is what a reviewer checks
            the work against.
        agent: The agent the issue is dispatched to. It must be one this agent may spawn.
        description: What the work is. Written for a child agent with no other context.
        blocked_by: The ids of every issue that must be done before this one. The default is none.
        epic_id: The id of an existing epic to group it under. The default leaves it ungrouped and
            numbered under `ISSUE`.
        reviewers: The agents that must approve the work, from the set this agent may spawn. Required
            when this run's reviewers feature is on.

    Returns:
        The id the board **assigned**, and the board budget the issue left behind. It is numbered
            under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it has no epic,
            and keeping it is what blocks a later issue on this one or waits for it.

    Raises:
        ApiError: `invalid-argument` when a required field is blank or `agent` or a reviewer is not
            one this agent may assign, `not-found` for an unknown epic or blocker, and
            `limit-exceeded` at the board's issue cap.
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


@operation("board.update_issue")
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
    """Revise an issue; at least one field must be supplied.

    An argument left out is left alone. `description=None` empties the description and `epic_id=None`
    detaches the issue from its epic, which is why both default to `UNCHANGED` rather than to `None`.

    Args:
        id: The issue to revise.
        title: The title to replace the old one with. The default keeps the one it has.
        description: The description to replace the old one with; `None` clears it, and the default
            keeps the one it has.
        in_scope: The scope statement to replace the old one with.
        out_of_scope: The non-scope statement to replace the old one with.
        completion_criteria: The completion criteria to replace the old ones with.
        status: Where the issue now stands. The default keeps the status it has.
        epic_id: The epic to regroup it under; `None` detaches it from the one it has, and the
            default keeps the grouping.

    Raises:
        ApiError: `invalid-argument` when no field was supplied or one was blanked, and `not-found`
            for an unknown issue or epic id.
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


@operation("board.set_issue_blocked_by")
def set_issue_blocked_by(id: str, blocked_by: list[str]) -> None:
    """Replace an issue's whole blocker set; an empty list clears every blocker.

    Args:
        id: The issue whose blockers to replace.
        blocked_by: The ids of every issue that must now be done before it. An empty list clears them
            all.

    Raises:
        ApiError: `invalid-argument` for a blank id or blocker, `not-found` for an issue or blocker
            the board does not hold, and `conflict` when an edge would close a cycle or block the
            issue on itself.
    """
    _call(wire.set_issue_blocked_by, id, _strings("set_issue_blocked_by", "blocked_by", blocked_by))


@operation("board.remove_epic")
def remove_epic(id: str) -> BoardUsage:
    """Remove an epic, keeping its issues and ungrouping them.

    Args:
        id: The epic to remove.

    Returns:
        The board budget the removal left behind.

    Raises:
        ApiError: `not-found` for an unknown id.
    """
    return _usage(_call(wire.remove_epic, id))


@operation("board.remove_issue")
def remove_issue(id: str) -> BoardUsage:
    """Remove an issue and every blocker edge pointing at it.

    Args:
        id: The issue to remove.

    Returns:
        The board budget the removal left behind.

    Raises:
        ApiError: `not-found` for an unknown id.
    """
    return _usage(_call(wire.remove_issue, id))


@operation("board.wait_for_issue")
def wait_for_issue(id: str) -> str:
    """Register a wait on an issue, which suspends the agent between turns until it is terminal.

    Nothing blocks inside the program: the wait is recorded and the call returns at once, so the rest
    of the program still runs. The suspension happens after the program ends, between turns — the run
    frees this agent's slot until the issue is terminal, done or failed, then resumes on the next
    turn. It is how a turn's work is sequenced behind an issue it depends on. The issue this agent
    was assigned to implement is the one issue it may not wait on.

    Args:
        id: The issue to wait on. It may not be the issue this agent was assigned.

    Returns:
        gg's acknowledgement that the wait is registered, which says what happens once the program
            ends.

    Raises:
        ApiError: `invalid-argument` for a blank id, or for this agent's own assigned issue,
            `not-found` for an id the board does not hold, and `unavailable` when the run has no
            board.
    """
    return _call(wire.wait_for_issue, id)


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
