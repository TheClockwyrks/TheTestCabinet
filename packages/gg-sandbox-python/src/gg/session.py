"""End the session, with the ending that belongs to this session's role.

A run binds one group: the call that reports what was done, or the pair that accepts or rejects work
under review.

None of them stops the program. Whatever follows an ending still runs, and a program that then fails
has its ending revoked along with everything else it decided.
"""

from __future__ import annotations

from wit_world.imports import session as wire

from ._registry import missing, operation
from .core import _call, _strings

__all__ = ["approve", "finish", "request_changes"]


@operation("session.finish")
def finish(summary: str) -> None:
    """End the session, reporting what was done in a sentence or two.

    It does not stop the program — whatever follows it still runs. A program that then fails has the
    ending cancelled and gets another turn.

    Args:
        summary: What was done, in a sentence or two.

    Raises:
        ApiError: `invalid-argument` for a blank summary, and `unavailable` when this session ends
            some other way.
    """
    _call(wire.finish, summary)


@operation("session.approve")
def approve() -> None:
    """Accept the work under review: it meets every completion criterion and stays in scope.

    This ends the session. It does not stop the program — whatever follows it still runs.

    Raises:
        ApiError: `unavailable` when this session ends some other way.
    """
    _call(wire.approve)


@operation("session.request_changes")
def request_changes(items: list[str]) -> None:
    """Reject the work under review, listing every change that must be made before acceptance.

    This ends the session, and does not stop the program. Each item says what is wrong and what to
    change.

    Args:
        items: Every change that must be made before the work can be accepted, one per entry: what is
            wrong, and what to change. It may not be empty.

    Raises:
        ApiError: `invalid-argument` when the list is empty, and `unavailable` when this session
            ends some other way.
    """
    _call(wire.request_changes, _strings("request_changes", "items", items))


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
