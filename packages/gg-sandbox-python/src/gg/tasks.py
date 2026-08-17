"""A private task list, kept as a directed acyclic graph rather than as a list of lines.

Every task may name the tasks that must finish before it, and an edge that would close a cycle is
refused.

One spelling here is worth reading twice. A task's description is a three-way edit, and Python
already spells two of the three: leaving the argument out keeps what is there, `None` clears it, and
a string replaces it. `gg.core.UNCHANGED` is the name of the first, for a program that spells it out.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from wit_world.imports import tasks as wire
from wit_world.imports import types as wire_types

from ._registry import missing, operation
from .core import UNCHANGED, Unchanged, _call, _strings

__all__ = [
    "TaskStatus",
    "TaskUsage",
    "add_task",
    "complete_task",
    "remove_task",
    "set_blocked_by",
    "update_task",
]


class TaskStatus(Enum):
    """Where a task stands."""

    PENDING = "pending"
    """Not started. Every task begins here."""

    IN_PROGRESS = "in_progress"
    """Being worked on now."""

    DONE = "done"
    """Finished. Tasks blocked on it become actionable once all their blockers are done."""


@dataclass(frozen=True)
class TaskUsage:
    """How much of the run's task budget is used, after the call that returned it."""

    count: int
    """Tasks currently on the list."""

    max_tasks: int
    """The most tasks this run allows."""


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


@operation("tasks.add_task")
def add_task(
    id: str,
    title: str,
    *,
    description: str | None = None,
    blocked_by: list[str] | None = None,
) -> TaskUsage:
    """Add a task to the task graph.

    `blocked_by` names the tasks that must finish before this one, and defaults to none.

    Args:
        id: The id chosen for it. Every other task call takes it, and no two tasks may share one.
        title: A short line naming the work.
        description: What the work is, at whatever length is useful.
        blocked_by: The ids of the tasks that must be done before this one. The default is none.

    Returns:
        The task budget the addition left behind.

    Raises:
        ToolError: `invalid-argument` for a blank id or title, `conflict` on a duplicate id or an
            edge that would close a cycle, `not-found` for an unknown blocker, and `limit-exceeded`
            at the task cap.
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


@operation("tasks.update_task")
def update_task(
    id: str,
    *,
    title: str | None = None,
    description: str | None | Unchanged = UNCHANGED,
    status: TaskStatus | None = None,
) -> None:
    """Revise a task's title, description or status; at least one must be supplied.

    An argument left out is left alone. `description=None` empties the description, which is why it
    defaults to `UNCHANGED` rather than to `None`.

    Args:
        id: The task to revise.
        title: The title to replace the old one with. The default keeps the one it has.
        description: The description to replace the old one with; `None` clears it, and the default
            keeps the one it has.
        status: Where the task now stands. The default keeps the status it has.

    Raises:
        ToolError: `invalid-argument` when no field was supplied or one was blanked, and `not-found`
            for an unknown id.
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


@operation("tasks.set_blocked_by")
def set_blocked_by(id: str, blocked_by: list[str]) -> None:
    """Replace a task's whole blocker set; an empty list clears every blocker.

    Args:
        id: The task whose blockers to replace.
        blocked_by: The ids of every task that must now be done before it. An empty list clears them
            all.

    Raises:
        ToolError: `invalid-argument` for a blank id or blocker, `not-found` for a task or blocker
            that is not on the list, and `conflict` when an edge would close a cycle or block the
            task on itself.
    """
    _call(wire.set_blocked_by, id, _strings("set_blocked_by", "blocked_by", blocked_by))


@operation("tasks.complete_task")
def complete_task(id: str) -> None:
    """Mark a task done.

    Tasks it was blocking become actionable once every one of their blockers is done.

    Args:
        id: The task to mark done.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    _call(wire.complete_task, id)


@operation("tasks.remove_task")
def remove_task(id: str) -> TaskUsage:
    """Remove a task and every blocker edge pointing at it.

    Args:
        id: The task to remove.

    Returns:
        The task budget the removal left behind.

    Raises:
        ToolError: `not-found` for an unknown id.
    """
    return _usage(_call(wire.remove_task, id))


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
