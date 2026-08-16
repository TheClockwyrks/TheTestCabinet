"""Manage the agent's own context window.

These are the only calls whose effect is on the conversation rather than on the workspace. They are
worth making from a program precisely because a program can decide *when* to: read a set of files,
extract what matters, then evict the views, all in one turn.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from wit_world.imports import context as wire

from ._registry import missing, operation
from .core import ToolError, ToolErrorCode, _call, _strings, _uint

__all__ = [
    "ArchiveHit",
    "ArchiveSearch",
    "MessageRole",
    "ReclaimReport",
    "TurnRange",
    "archive_thread",
    "compact",
    "evict_file_view",
    "search_archive",
]


@dataclass(frozen=True)
class ReclaimReport:
    """What a context reclaim actually freed from the live context window."""

    items: int
    """Context items dropped from the live window."""

    reclaimed_tokens: int
    """Approximately how many tokens that freed."""

    paths: list[str]
    """The workspace paths whose views were evicted. Empty for an archive."""

    detail: str
    """The prose summary of what was reclaimed."""


@dataclass(frozen=True)
class TurnRange:
    """An inclusive span of turn numbers, the unit `archive_thread` moves out of the window.

    The numbers are the ones on the header of every result, so `TurnRange(4, 19)` means exactly the
    turns numbered 4 through 19 — both ends included.
    """

    start: int
    """The first turn in the span."""

    end: int
    """The last turn in the span, inclusive."""


class MessageRole(Enum):
    """Who said an archived message."""

    SYSTEM = "system"
    """The system prompt."""

    USER = "user"
    """A turn's input to the agent — a result, a view, or an operator's instruction."""

    ASSISTANT = "assistant"
    """Something the agent said."""

    TOOL = "tool"
    """A tool result, on a session that made tool calls rather than writing programs."""


@dataclass(frozen=True)
class ArchiveHit:
    """One archived message that matched a search."""

    seq: int
    """The archived message's sequence number."""

    role: MessageRole
    """Who said it."""

    text: str
    """The message text."""


@dataclass(frozen=True)
class ArchiveSearch:
    """What `search_archive` found."""

    archive_empty: bool
    """Nothing has been archived yet, so there was nothing to search.

    Deliberately distinct from a search that ran and matched nothing, so a program does not archive
    again believing the first archive failed.
    """

    hits: list[ArchiveHit]
    """The matches, most recent first, at most 8."""


def _report(report: wire.ReclaimReport) -> ReclaimReport:
    """The membrane's reclaim record, as the model-facing one."""
    return ReclaimReport(
        items=report.items,
        reclaimed_tokens=report.reclaimed_tokens,
        paths=[*report.paths],
        detail=report.detail,
    )


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


@operation("context.evict_file_view")
def evict_file_view(path: str | None = None) -> ReclaimReport:
    """Drop the contents of files that were read out of the context window.

    The files on disk are untouched: this forgets what was read, not what exists.

    Args:
        path: The file whose views to drop. The default drops every file view held.

    Returns:
        How many context items went and roughly how many tokens that reclaimed, with `paths` naming
            the files whose views were dropped.

    Raises:
        ToolError: `invalid-argument` for a path that is given but empty; the default is how every
            file view is dropped.
    """
    return _report(_call(wire.evict_file_view, path))


@operation("context.archive_thread")
def archive_thread(ranges: list[TurnRange]) -> ReclaimReport:
    """Move whole turns out of the context window.

    Every result carries a header with its turn number and roughly what holding it costs, which is
    what names the turns worth dropping: `gg.context.archive_thread([gg.context.TurnRange(4, 19)])`
    archives turns 4 through 19, both ends included. The agent's own messages in an archived turn are
    dropped; the results are kept and stay searchable with `search_archive`.

    Args:
        ranges: The inclusive spans of turn numbers to move out of the window. They may overlap.

    Returns:
        How many context items went and roughly how many tokens that reclaimed. `paths` is empty,
            since an archive drops turns rather than files.

    Raises:
        ToolError: `invalid-argument` for an empty list, too many spans at once, or a span that ends
            before it starts.
    """
    spans = [wire.TurnRange(start=_span(span, "start"), end=_span(span, "end")) for span in ranges]
    return _report(_call(wire.archive_thread, spans))


@operation("context.search_archive")
def search_archive(query: str) -> ArchiveSearch:
    """Search archived history for a case-insensitive substring, most recent first, up to 8 hits.

    `archive_empty` is worth checking before `hits`: it distinguishes "nothing has been archived yet"
    from "the search ran and matched nothing", so a program does not archive again believing the
    first archive failed.

    Args:
        query: The substring to look for. Matching is case-insensitive.

    Returns:
        The matches, most recent first and at most 8, beside the `archive_empty` flag.

    Raises:
        ToolError: `invalid-argument` for an empty query.
    """
    found = _call(wire.search_archive, query)
    return ArchiveSearch(
        archive_empty=found.archive_empty,
        hits=[
            ArchiveHit(seq=hit.seq, role=MessageRole[hit.role.name], text=hit.text)
            for hit in found.hits
        ],
    )


@operation("context.compact")
def compact(summary: str, files: list[str] | None = None) -> None:
    """Compact the context window: the detailed thread is dropped and restarted from `summary`.

    A fresh read of each path in `files` is added to the restarted window. Skills, memories and the
    task list are kept as they are. gg asks for this call when the window is full, and refuses every
    other call until it arrives.

    It does not stop the program: it registers the request and returns, and the rewrite happens once
    the program has ended. Everything not in the summary and not in `files` is gone, so the summary
    is written for the agent that comes after and `files` names what it will need in hand.

    Args:
        summary: What the restarted window opens with. Everything not in it and not re-read from
            `files` is gone.
        files: The paths to read afresh into the restarted window. The default reads nothing back.

    Raises:
        ToolError: `invalid-argument` for a blank summary. This is the one call gg does not refuse
            while a compaction is in flight, since nothing else can clear the window.
    """
    _call(wire.compact, summary, _strings("compact", "files", files))


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
