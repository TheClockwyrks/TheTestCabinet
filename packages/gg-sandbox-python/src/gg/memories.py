"""Durable memories, which survive a context compaction.

A run picks one of three memory strategies and binds only that strategy's functions, so
`memories.list()` is the honest answer to what memory can do here. The scratchpad keeps every memory
in the context window (`write_memory`, `update_memory`); the two file-shaped strategies keep the
contents outside it (`create_memory`, `read_memory`, `edit_memory`), one behind an index that is
always in context and one behind `search_memories`. `delete_memory` is bound under all three.

Every mutation hands back the budget after it, so a program can decide whether to write another
memory by reading numbers rather than by parsing a sentence about them.

The three writes take their fields as arguments rather than as a record. The membrane declares one
`memory-input` for all of them, and a language whose optional arguments are keyword arguments has no
reason to make a program construct a value before it can make a call.
"""

from __future__ import annotations

from dataclasses import dataclass

from wit_world.imports import memories as wire

from ._registry import operation
from .core import _call, _strings

__all__ = [
    "MemoryHit",
    "MemoryUsage",
    "create_memory",
    "delete_memory",
    "edit_memory",
    "read_memory",
    "search_memories",
    "update_memory",
    "write_memory",
]


@dataclass(frozen=True)
class MemoryUsage:
    """How much of the run's durable-memory budget is used, after the call that returned it.

    Every maximum is optional: each limit can be turned off, and a run's memory strategy applies only
    some of them, so `None` means nothing bounds that axis — which is worth checking before
    subtracting.
    """

    count: int
    """Memories currently held."""

    max_count: int | None
    """The most memories this run allows, if it limits the count."""

    total_chars: int
    """Characters of body currently held, across all memories."""

    max_total_chars: int | None
    """The most characters of body this run allows in total, if it limits the aggregate."""

    index_chars: int | None
    """Characters the memory index occupies, under a run that keeps one."""

    max_index_chars: int | None
    """The most characters the index may occupy, if it is limited."""


@dataclass(frozen=True)
class MemoryHit:
    """One memory `search_memories` matched, and the numbers it was ranked by."""

    name: str
    """The memory's slug — what `read_memory` takes."""

    description: str
    """Its description, or the empty string when it was created without one."""

    matched: int
    """How many distinct keywords it matched — the primary ranking."""

    occurrences: int
    """How many times those keywords occur in it — the tiebreak."""

    excerpt: str
    """A short window of the memory around its first match."""


def _some(value: str | None) -> str | None:
    """A code half, with a blank normalised to absent.

    A model that clears its code by passing the empty string means "no code", and storing an empty
    module would bind an empty `lib` entry saying nothing.
    """
    return value if value is not None and value.strip() != "" else None


def _usage(usage: wire.MemoryUsage) -> MemoryUsage:
    """The membrane's budget record, as the model-facing one."""
    return MemoryUsage(
        count=usage.count,
        max_count=usage.max_count,
        total_chars=usage.total_chars,
        max_total_chars=usage.max_total_chars,
        index_chars=usage.index_chars,
        max_index_chars=usage.max_index_chars,
    )


def _input(name: str, description: str, body: str, code: str | None, on_use: str | None):
    """The membrane's `memory-input`, assembled from the arguments a program wrote."""
    return wire.MemoryInput(
        name=name,
        description=description,
        body=body,
        code=_some(code),
        on_use=_some(on_use),
    )


@operation("memories.write_memory")
def write_memory(
    name: str,
    description: str,
    body: str,
    *,
    code: str | None = None,
    on_use: str | None = None,
) -> MemoryUsage:
    """Record a durable memory that survives a context compaction.

    A memory may also carry **code**. `code` is a Python module whose public names are bound at
    `lib.<name>` in every later program this session writes, so a helper got right once is never
    written again; `on_use` is a script gg runs the first time the memory comes into use, whose views
    arrive on the next turn. Neither is context: they cost no window, are never shown back, and count
    against no body limit.

    Args:
        name: The memory's slug: letters, digits, `-`, `_` and `.`. Every other memory call takes it,
            and no two memories may share one.
        description: A one-line description of what the memory holds. Where the run keeps a memory
            index this is the memory's line in it, and so all that is visible until it is read.
        body: The memory's contents.
        code: A Python module whose public names are bound at `lib.<name>` for the rest of the
            session. The default records a memory that is only prose.
        on_use: A script gg runs the first time the memory comes into use. The default runs nothing.

    Raises:
        ToolError: `conflict` on a duplicate name, and `limit-exceeded` when the body would breach
            the run's caps — revising or deleting a memory is the way out, rather than accruing more.
    """
    return _usage(_call(wire.write_memory, _input(name, description, body, code, on_use)))


@operation("memories.update_memory")
def update_memory(
    name: str,
    description: str,
    body: str,
    *,
    code: str | None = None,
    on_use: str | None = None,
) -> MemoryUsage:
    """Replace an existing memory's description and body, keyed on its slug.

    Its code and on-use script are replaced too — leaving them out clears them.

    Args:
        name: The slug of the memory to replace. Every other argument replaces what it held.
        description: The one-line description to replace the old one with.
        body: The contents to replace the old ones with.
        code: The Python module to replace the old one with. The default clears it.
        on_use: The script to replace the old one with. The default clears it.

    Raises:
        ToolError: `not-found` when no memory has that name.
    """
    return _usage(_call(wire.update_memory, _input(name, description, body, code, on_use)))


@operation("memories.create_memory")
def create_memory(
    name: str,
    description: str,
    body: str,
    *,
    code: str | None = None,
    on_use: str | None = None,
) -> MemoryUsage:
    """Record a new memory whose contents stay out of the context window until they are read.

    Args:
        name: The memory's slug: letters, digits, `-`, `_` and `.`. No two memories may share one.
        description: A one-line description of what the memory holds. Required where the run keeps an
            index, since that is the memory's line in it.
        body: The initial contents, which stay out of the context window until they are read.
        code: A Python module bound at `lib.<name>` once the memory is read. The default records a
            memory that is only prose.
        on_use: A script gg runs on that first read. The default runs nothing.

    Raises:
        ToolError: `invalid-argument` for a blank field or a slug with characters a name may not
            hold, `conflict` on a duplicate slug, and `limit-exceeded` when the contents, or the
            index entry, would breach a limit.
    """
    return _usage(_call(wire.create_memory, _input(name, description, body, code, on_use)))


@operation("memories.read_memory")
def read_memory(name: str) -> str:
    """Read one memory's full contents by slug, which is the only thing that brings them into context.

    A memory that carries code loads that code on being read: the reply names the `lib.<key>` it is
    bound at, and it stays bound for the rest of the session.

    Args:
        name: The memory's slug.

    Raises:
        ToolError: `not-found` when no memory has that slug.
    """
    return _call(wire.read_memory, name)


@operation("memories.edit_memory")
def edit_memory(name: str, search: str, replace: str) -> MemoryUsage:
    """Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.

    Appending is done by quoting the last line and replacing it with itself plus what is being added.

    Args:
        name: The slug of the memory to revise.
        search: The exact text to find in its contents. It must appear exactly once.
        replace: The text to put in its place.

    Raises:
        ToolError: `not-found` when the text does not appear, `conflict` when it appears more than
            once, `limit-exceeded` when the result would be too long, and `invalid-argument` when the
            edit would leave the memory empty — deleting it is the way to do that.
    """
    return _usage(
        _call(wire.edit_memory, wire.MemoryEdit(name=name, search=search, replace=replace))
    )


@operation("memories.search_memories")
def search_memories(keywords: list[str]) -> list[MemoryHit]:
    """Find the memories mentioning any of `keywords`, best first.

    Plain case-insensitive substring matching over each memory's slug, description and contents,
    ranked by how many distinct keywords a memory mentions and then by how often. Several specific
    words rank better than one sentence; `read_memory` is what fetches a hit worth having in full. A
    search that matches nothing is an empty list.

    Args:
        keywords: The words to look for. Several specific words rank better than one sentence,
            because a memory is ranked by how many of them it mentions.

    Raises:
        ToolError: `invalid-argument` when every keyword is empty.
    """
    hits = _call(wire.search_memories, _strings("search_memories", "keywords", keywords))
    return [
        MemoryHit(
            name=hit.name,
            description=hit.description,
            matched=hit.matched,
            occurrences=hit.occurrences,
            excerpt=hit.excerpt,
        )
        for hit in hits
    ]


@operation("memories.delete_memory")
def delete_memory(name: str) -> MemoryUsage:
    """Evict a memory by name, freeing room in the budget.

    What is left in use comes back.

    Args:
        name: The memory's slug.

    Raises:
        ToolError: `not-found` when no memory has that name.
    """
    return _usage(_call(wire.delete_memory, name))
