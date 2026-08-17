"""End the session, with the ending that belongs to this agent's role.

Under responses as code every reply is a program, so there is no prose turn that could mean "the work
is done" — a model that answers "task complete" has written a reply that failed to be a program, not
an ending. These are the calls that mean it, and a run binds only the group its agent's role has: an
agent doing work gets `finish`, and a reviewer gets `approve` and `request_changes` instead.

None of them stops the program. Whatever follows an ending still runs, so an ending belongs last —
and a program that then fails has its ending revoked along with everything else it decided.
"""

from __future__ import annotations

from wit_world.imports import session as wire

from ._registry import missing, operation
from .core import _call, _strings

__all__ = ["approve", "finish", "request_changes"]


@operation("session.finish")
def finish(summary: str) -> None:
    """End the session, reporting what was done in a sentence or two.

    This is the only thing that ends a working agent's session. It does not stop the program —
    whatever follows it still runs — so it belongs last, once the calls before it have confirmed the
    work is really done. A program that then fails has the ending cancelled and gets another turn.

    Args:
        summary: What was done, in a sentence or two.

    Raises:
        ApiError: `invalid-argument` for a blank summary, and `unavailable` when this agent's role
            ends its session some other way.
    """
    _call(wire.finish, summary)


@operation("session.approve")
def approve() -> None:
    """Accept the work under review: it meets every completion criterion and stays in scope.

    This ends the session. It does not stop the program — whatever follows it still runs — so it
    belongs last, once the change has actually been read. It takes nothing, because an approval
    carries no obligation beyond itself.

    Raises:
        ApiError: `unavailable` when this agent's role ends its session some other way.
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
        ApiError: `invalid-argument` when the list is empty, and `unavailable` when this agent's
            role ends its session some other way.
    """
    _call(wire.request_changes, _strings("request_changes", "items", items))


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
