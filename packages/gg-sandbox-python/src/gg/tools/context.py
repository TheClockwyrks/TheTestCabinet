"""The `context` family: managing the agent's own context window.

These are the only tools whose effect is on the conversation rather than on the workspace. They are
worth calling from a program precisely because a program can decide *when* to: read a set of files,
extract what matters, then evict the views in the same turn.
"""

from __future__ import annotations

from wit_world.imports import context as wire

from ..errors import ToolError, _call, _strings, _uint
from ..types import ArchiveHit, ArchiveSearch, MessageRole, ReclaimReport, ToolErrorCode, TurnRange


def _report(report: wire.ReclaimReport) -> ReclaimReport:
    """The membrane's reclaim record, as the model-facing one."""
    return ReclaimReport(
        items=report.items,
        reclaimed_tokens=report.reclaimed_tokens,
        paths=list(report.paths),
        detail=report.detail,
    )


def evict_file_view(path: str | None = None) -> ReclaimReport:
    """Drop the contents of files you have read out of your context window, freeing the tokens they
    occupy, and report what that reclaimed.

    The files on disk are untouched — this forgets what you read, not what exists.

    Args:
        path: The file whose views to drop. Leave it out to drop every file view you hold.
    """
    return _report(_call(wire.evict_file_view, path))


def archive_thread(ranges: list[TurnRange]) -> ReclaimReport:
    """Move whole turns out of your context window and report what that reclaimed.

    Every result you are given carries a header with its turn number and roughly what holding it
    costs, so name the turns worth dropping: `context.archive_thread([TurnRange(4, 19)])` archives
    turns 4 through 19, both ends included. Your own messages in an archived turn are dropped; the
    results are kept and stay searchable with `context.search_archive`.

    Args:
        ranges: The inclusive spans of turn numbers to move out of your window.
    """
    spans = [wire.TurnRange(start=_span(span, "start"), end=_span(span, "end")) for span in ranges]
    return _report(_call(wire.archive_thread, spans))


def _span(span: TurnRange, edge: str) -> int:
    """One end of a turn span, checked before it is lowered.

    A `TurnRange` is a plain dataclass, so nothing stops a program constructing one out of a string
    or a negative number; the membrane would lower either into a `u32` without complaint, and archive
    a range nobody asked for.
    """
    if not isinstance(span, TurnRange):
        raise ToolError(
            "archive_thread",
            ToolErrorCode.INVALID_ARGUMENT,
            f"every entry of `ranges` must be a TurnRange, got {span!r}",
        )
    value = _uint("archive_thread", f"ranges[].{edge}", getattr(span, edge))
    if value is None:
        raise ToolError(
            "archive_thread",
            ToolErrorCode.INVALID_ARGUMENT,
            f"every entry of `ranges` needs both `start` and `end`; `{edge}` is None",
        )
    return value


def search_archive(query: str) -> ArchiveSearch:
    """Search archived history for a case-insensitive substring, most recent first, up to 8 hits.

    Check `archive_empty` before reading `hits`: it distinguishes "nothing has been archived yet"
    from "the search ran and matched nothing", so you do not archive again believing the first
    archive failed.

    Args:
        query: The substring to look for. Matching is case-insensitive.
    """
    found = _call(wire.search_archive, query)
    return ArchiveSearch(
        archive_empty=found.archive_empty,
        hits=[
            ArchiveHit(seq=hit.seq, role=MessageRole[hit.role.name], text=hit.text)
            for hit in found.hits
        ],
    )


def compact(summary: str, files: list[str] | None = None) -> None:
    """Compact your context window: the detailed thread is dropped and restarted from `summary`, plus
    a fresh read of each path in `files`.

    Your skills, memories and task list are kept as they are. You are asked to call this when your
    window is full, and every other call is refused until you do.

    It does NOT stop your program: it registers the request and returns, and the rewrite happens once
    your program has ended. Everything not in your summary and not in `files` is gone, so write the
    summary for your future self and name the files you will actually need in hand.

    Args:
        summary: What your restarted window opens with. Write it for your future self: everything not
            in it and not re-read from `files` is gone.
        files: The paths to read afresh into the restarted window. Defaults to none.
    """
    _call(wire.compact, summary, _strings("compact", "files", files))
