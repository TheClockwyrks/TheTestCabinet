"""The `programs` object: the library of programs this agent has already run.

These are not gg tools. No capability offers one *as a tool*, nothing dispatches one by name, and
cataloguing them among the tools would break the `bound_tools() == ALL_TOOL_NAMES` bijection the
committed component is checked against — so, like `session`, `docs` and `views`, they have their own
membrane interface, their own `gg.catalogue.PROGRAM_ENTRIES` list, and their own object. Unlike those
three, `gg.scope` binds this one from the `library` flag the host passes to `run`, because it is
gated by a capability rather than by a tool or a role.

**Why the object exists.** Under responses-as-code a reply is a whole program, so a one-character
mistake in a sixty-line program costs the sixty lines again. The library makes the fix proportional
to the mistake: fetch what ran, patch it with ordinary string work, hand it back.

```python
source = programs.get()
programs.rerun(source.replace("improt", "import"))
```
"""

from __future__ import annotations

from wit_world.imports import programs as wire

from ..errors import _call, _uint
from ..types import ProgramSummary


def history() -> list[ProgramSummary]:
    """The programs you have already run this session, oldest first — each with the turn it ran on,
    how big it was, and whether it ran to its end.

    It lists shapes, not sources: fetch the one you want with `programs.get(turn)`. The list survives
    a compaction, so it is also how you find a program whose text has left your context window. It is
    empty — never an error — for a session that has run nothing yet.
    """
    return [
        ProgramSummary(
            turn=entry.turn,
            lines=entry.lines,
            chars=entry.chars,
            ok=entry.ok,
            error=entry.error,
        )
        for entry in _call(wire.history)
    ]


def get(turn: int | None = None) -> str:
    """The exact source of one program you ran, as a string. With no argument, your most recent one.

    This is the first half of fixing a program without rewriting it: get what ran, patch it with
    ordinary string work (`replace`, an f-string, a regex), and hand the result to `programs.rerun`.
    What comes back is the program that **executed** — so when a turn's program was itself handed over
    by `programs.rerun`, you get the program that ran, not the few lines that asked for it, and
    fetch-patch-run composes turn after turn.

    Args:
        turn: The turn whose program to fetch, as `programs.history()` reports it. Leave it out for
            your most recent one.

    Raises:
        ToolError: `not-found`, naming the turns that are held, for a turn that ran no program or one
            old enough that the library has dropped it.
    """
    return _call(wire.get, _uint("get", "turn", turn))


def rerun(source: str) -> None:
    """Hand gg a program to run in place of this one. Your program finishes, then gg runs `source` as
    this turn's program.

    Use it with `programs.get` to fix a program without re-emitting it. Nothing is undone: every call
    your program already made stands, and the program that runs next sees the world your program left
    behind — so hand over BEFORE doing work you do not want done twice.

    The first call stands. If your program then raises, the hand-over is cancelled along with
    everything else the failed program decided, and you get an ordinary error turn instead. Chains are
    bounded: hand over once per turn, and write the fixed program to do the work.

    Args:
        source: The program to run in place of this one. It may not be blank.

    Raises:
        ToolError: `refused` for a second hand-over in one turn — a silently replaced program is a
            change you cannot see — and `invalid-argument` for a blank source.
    """
    _call(wire.rerun, source)
