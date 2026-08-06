"""Ending the session — the model-facing functions that are not gg tools.

They live beside the tools rather than among them because nothing about them is a tool: no capability
offers them, they dispatch nothing, and one group of them is bound into every program's scope
including one in a run that enables no tools at all. Keeping them out of `TOOL_CATALOGUE` is what
keeps that array in exact bijection with the gg tool vocabulary the component is checked against.

**Why a session needs them at all.** Under responses-as-code every reply is a program, so there is no
prose turn that could mean "I am done" — a model that answers "task complete" has written a reply
that failed to be a program, not an ending.

**Why there is more than one.** An ending is a *result*, and different roles produce different
results: an agent doing work reports what it did, and a reviewer returns a verdict. Each is a
different shape, so each is a different call whose signature carries exactly what that result is made
of, and `gg.scope` binds one group per program. A role's ending is therefore the only ending its
program can express — and nothing has to be read back out of prose.

**Why they are one line each.** Ending is a fact about the *agent*, not about the program that
declared it, so the flag lives in the agent's host-side context and this module holds none of it: no
module state to reset between programs, no sentinel exception, no unwind. The host records the
declaration, keeps it while the program runs on, and revokes it if the program then fails — decisions
that belong where the session is owned rather than inside a sandbox the program shares a scope with.

Every docstring below is **model-facing**: it is reflected into the signature catalogue and is what a
documentation view answers with. It says what to call and when, and nothing about the harness.
"""

from __future__ import annotations

from wit_world.imports import session as wire

from .errors import _call, _strings


def finish(summary: str) -> None:
    """End your session, reporting what you did in a sentence or two. This is the only thing that
    ends it.

    It does not stop your program — whatever follows it still runs — so call it last, once the tools
    have confirmed the work is really done. If your program then fails, the ending is cancelled and
    you get another turn.

    Args:
        summary: What you did, in a sentence or two.
    """
    _call(wire.finish, summary)


def approve() -> None:
    """Accept the work you are reviewing: it meets every completion criterion and stays in scope.
    This ends your session.

    It does not stop your program — whatever follows it still runs — so call it last, once you have
    actually read the change.
    """
    _call(wire.approve)


def request_changes(items: list[str]) -> None:
    """Reject the work you are reviewing, listing every change that must be made before it can be
    accepted.

    Each item says what is wrong and what to change; the list may not be empty. This ends your
    session, and does not stop your program.

    Args:
        items: Every change that must be made before the work can be accepted, one per entry: what is
            wrong, and what to change. It may not be empty.
    """
    _call(wire.request_changes, _strings("request_changes", "items", items))
