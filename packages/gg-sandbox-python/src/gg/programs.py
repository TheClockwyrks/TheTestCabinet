"""Fetch a program that already ran, and hand a patched copy back to be run.

Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
what ran, patch it with ordinary string work, hand it back.

```python
source = gg.programs.get("k3p9")
gg.programs.rerun(source.replace("improt", "import"))
```
"""

from __future__ import annotations

from dataclasses import dataclass

from wit_world.imports import programs as wire

from ._registry import alias, missing, operation
from .core import _call

__all__ = ["ProgramSummary", "get", "history", "rerun"]


@dataclass(frozen=True)
class ProgramSummary:
    """One program that already ran, as `history` lists it.

    It describes the program's **shape**, never its source: a directory that inlined every program
    would put the whole session back in the context window, which is the one thing the library exists
    to avoid. `get` is what fetches a source.
    """

    id: str
    """The id its `submit_program` acknowledgement carried — what `get` takes."""

    turn: int
    """The turn it ran on."""

    lines: int
    """How many lines of source it was."""

    chars: int
    """How many characters of source it was."""

    ok: bool
    """Whether it ran to its end, with nothing raised and no sandbox ceiling stopping it."""

    error: str | None
    """The error it ended with, when it did not run to its end; `None` when it did."""

    @alias("programs.get")
    def source(self) -> str:
        """Fetch this program's source, which a summary does not carry.

        `get` with the id already supplied, for the common case where the directory entry that
        named the program is the thing in hand.

        Returns:
            The source of the program that ran under that id, as a string.

        Raises:
            ApiError: `not-found` when the library has since dropped that program.
        """
        return get(self.id)


@operation("programs.history")
def history() -> list[ProgramSummary]:
    """List the programs this session has already run, oldest first.

    It lists shapes, not sources: `get` is what fetches one. The list survives a compaction, so it
    is also how a program whose text has left the context window is found again.

    Returns:
        One summary per program already run, oldest first: its id, the turn it ran on, how big it
            was, and whether it ran to its end. A session that has run nothing yet gets an empty list.

    Raises:
        ApiError: `unavailable` when this agent keeps no program library, which is a different fact
            from an empty one.
    """
    return [
        ProgramSummary(
            id=entry.id,
            turn=entry.turn,
            lines=entry.lines,
            chars=entry.chars,
            ok=entry.ok,
            error=entry.error,
        )
        for entry in _call(wire.history)
    ]


@operation("programs.get")
def get(id: str) -> str:
    """Fetch the exact source of one program that ran, by the id its acknowledgement carried.

    This is the first half of fixing a program without rewriting it: get what ran, patch it with
    ordinary string work — `replace`, an f-string, a regular expression — and hand the result to
    `rerun`. What comes back is the program that **executed**, so when a submission's program was
    itself handed over by `rerun`, the program that ran is what arrives rather than the few lines
    that asked for it, and fetch-patch-run composes turn after turn. A rerun keeps the id of the
    submission it replaced.

    Args:
        id: The program's id, as its acknowledgement carried it and as `history` reports it.

    Returns:
        The source of the program that ran under that id, as a string.

    Raises:
        ApiError: `not-found`, naming the ids that are held, for an id this agent was never issued
            or one whose program is old enough that the library has dropped it, and `unavailable`
            when this agent keeps no program library.
    """
    return _call(wire.get, id)


@operation("programs.rerun")
def rerun(source: str) -> None:
    """Hand gg a program to run in place of this one.

    The calling program finishes, then gg runs `source` as this submission's program, under the
    same id — a later `get` of that id returns the program that ran, not the one that asked. Used
    with `get` it fixes a program without re-emitting it. Nothing is undone: every call the calling
    program already made stands, and the program that runs next sees the world it left behind — so
    the hand-over belongs before work that should not happen twice.

    The first call stands, because a silently replaced program is a change nobody can see. If the
    calling program then raises, the hand-over is cancelled along with everything else that program
    decided, and the turn ends in an ordinary error. Chains are bounded: a submission runs at most
    four programs, this one plus three handed over, and the fixed program is the one that does the
    work.

    Args:
        source: The program to run in place of this one, as Python. It may not be blank.

    Raises:
        ApiError: `refused` for a second hand-over from the same program, `invalid-argument` for a blank
            source, and `unavailable` when this agent keeps no program library.
    """
    _call(wire.rerun, source)


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
