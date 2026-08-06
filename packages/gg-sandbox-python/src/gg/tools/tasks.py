"""The `tasks` family: the task DAG.

Two lowerings live here, both so a model writes ordinary Python instead of a tagged union.
`description` on a patch is a three-way edit — leave it out to keep the description, pass `None` to
clear it, pass a string to replace it — which the membrane models as a `text-edit` variant, and which
`UNCHANGED` is the Python spelling of. And a status is a `TaskStatus` member on this side and the
membrane's `in-progress` on the other, because WIT identifiers cannot contain an underscore; a model
should never see that seam.
"""

from __future__ import annotations

from wit_world.imports import tasks as wire
from wit_world.imports import types as wire_types

from ..errors import _call, _strings
from ..types import UNCHANGED, TaskStatus, TaskUsage, Unchanged


def _text_edit(value: str | None | Unchanged) -> wire_types.TextEdit:
    """Lower the `UNCHANGED` / `None` / string sentinel onto the membrane's three-way text edit."""
    if value is UNCHANGED:
        return wire_types.TextEdit_Keep()
    if value is None:
        return wire_types.TextEdit_Clear()
    return wire_types.TextEdit_Set(value)


def _status(status: TaskStatus | None) -> wire.TaskStatus | None:
    """Lower a model-facing status onto the membrane's, whose `in-progress` carries a hyphen."""
    return None if status is None else wire.TaskStatus[status.name]


def _usage(usage: wire.TaskUsage) -> TaskUsage:
    """The membrane's budget record, as the model-facing one."""
    return TaskUsage(count=usage.count, max_tasks=usage.max_tasks)


def add_task(
    id: str,
    title: str,
    *,
    description: str | None = None,
    blocked_by: list[str] | None = None,
) -> TaskUsage:
    """Add a task to the task DAG and return the task budget.

    Args:
        id: The id you choose for it. It is what every other task call takes, and no two tasks may
            share one.
        title: A short line naming the work.
        description: What the work is, at whatever length is useful.
        blocked_by: The ids of the tasks that must be done before this one. Defaults to none.

    Raises:
        ToolError: `conflict` on a duplicate id or on an edge that would close a cycle.
    """
    return _usage(
        _call(
            wire.add_task,
            wire.TaskInput(
                id=id,
                title=title,
                description=description,
                blocked_by=_strings("add_task", "blocked_by", blocked_by),
            ),
        )
    )


def update_task(
    id: str,
    *,
    title: str | None = None,
    description: str | None | Unchanged = UNCHANGED,
    status: TaskStatus | None = None,
) -> None:
    """Revise a task's title, description and/or status; supply at least one.

    Args:
        id: The task to revise.
        title: The title to replace the old one with. Leave it out to keep the one it has.
        description: The description to replace the old one with; `None` clears it, and leaving it
            out keeps the one it has.
        status: Where the task now stands. Leave it out to keep the status it has.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    _call(
        wire.update_task,
        id,
        wire.TaskPatch(
            title=title,
            description=_text_edit(description),
            status=_status(status),
        ),
    )


def set_blocked_by(id: str, blocked_by: list[str]) -> None:
    """Replace a task's whole blocker set; an empty list clears every blocker.

    Args:
        id: The task whose blockers to replace.
        blocked_by: The ids of every task that must now be done before it. An empty list clears them
            all.

    Raises:
        ToolError: `not-found` for an unknown id, and `conflict` when an edge would close a cycle.
    """
    _call(wire.set_blocked_by, id, _strings("set_blocked_by", "blocked_by", blocked_by))


def complete_task(id: str) -> None:
    """Mark a task done.

    Tasks it was blocking become actionable once every one of their blockers is done.

    Args:
        id: The task to mark done.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    _call(wire.complete_task, id)


def remove_task(id: str) -> TaskUsage:
    """Remove a task and every blocker edge pointing at it, and return the task budget.

    Args:
        id: The task to remove.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    return _usage(_call(wire.remove_task, id))
