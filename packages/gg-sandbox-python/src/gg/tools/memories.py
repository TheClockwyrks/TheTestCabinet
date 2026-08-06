"""The `memory` family: durable notes that survive context compaction.

A run picks one of three memory strategies, and only that strategy's functions are enabled — so
`memory.list()` is the honest answer to "what can I do with memory here?". The scratchpad keeps every
memory in the context window (`write_memory`/`update_memory`); the two file-shaped strategies keep the
contents *outside* it (`create_memory`/`read_memory`/`edit_memory`), one behind an index that is
always in context and one behind `search_memories`. `delete_memory` is offered under all three.

Every mutation returns the budget after it, so a program can decide whether to write another memory
by reading numbers rather than by parsing a sentence about them.

**Why the three writes take their fields as arguments rather than a record.** The membrane declares
one `memory-input` for all of them, and a language whose optional arguments are keyword arguments has
no reason to make a model construct a value before it can make a call: `memory.create_memory(name,
description, body, code=...)` is the same information with one fewer thing to get right, and Python
binds the names for you.
"""

from __future__ import annotations

from wit_world.imports import memories as wire

from ..errors import _call, _strings
from ..types import MemoryHit, MemoryUsage


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


def write_memory(
    name: str,
    description: str,
    body: str,
    *,
    code: str | None = None,
    on_use: str | None = None,
) -> MemoryUsage:
    """Record a durable memory that survives context compaction, and return how much of the memory
    budget is now used.

    A memory may also carry **code**. `code` is a Python module whose public names are bound at
    `lib.<name>` in every later program you write, so a helper you get right once you never write
    again; `on_use` is a script gg runs the first time the memory comes into use, whose views reach
    you on your next turn. Neither is context — they cost you no window, are never shown back to you,
    and count against no body limit — and both are bounded on their own.

    Args:
        name: The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other memory call
            takes, and no two memories may share one.
        description: A one-line description of what the memory holds. Where the run keeps a memory
            index this is the memory's line in it, and so all you see of the memory until you read it.
        body: The memory's contents.
        code: A Python module whose public names are bound at `lib.<name>` for the rest of your
            session. Leave it out for a memory that is only prose.
        on_use: A script gg runs the first time the memory comes into use; whatever it shows you
            arrives on your next turn. Leave it out for a memory that runs nothing.

    Raises:
        ToolError: `conflict` on a duplicate name, and `limit-exceeded` when the body would breach
            the run's caps — revise or delete a memory rather than accruing more.
    """
    return _usage(_call(wire.write_memory, _input(name, description, body, code, on_use)))


def update_memory(
    name: str,
    description: str,
    body: str,
    *,
    code: str | None = None,
    on_use: str | None = None,
) -> MemoryUsage:
    """Replace an existing memory's description and body, keyed on its `name`, and return the memory
    budget.

    Its `code` and `on_use` are replaced too — leaving them out clears them.

    Args:
        name: The slug of the memory to replace. Every other argument replaces what it held.
        description: The one-line description to replace the old one with.
        body: The contents to replace the old ones with.
        code: The Python module to replace the old one with. Leave it out to clear it.
        on_use: The script to replace the old one with. Leave it out to clear it.

    Raises:
        ToolError: `not-found` when no memory has that name.
    """
    return _usage(_call(wire.update_memory, _input(name, description, body, code, on_use)))


def create_memory(
    name: str,
    description: str,
    body: str,
    *,
    code: str | None = None,
    on_use: str | None = None,
) -> MemoryUsage:
    """Record a new memory whose contents are kept OUT of your context window until you read them, and
    return the memory budget.

    Args:
        name: The memory's slug: letters, digits, `-`, `_` and `.`. No two memories may share one.
        description: A one-line description of what the memory holds. Required where the run keeps an
            index, since that is the memory's line in it.
        body: The initial contents. They stay out of your context window until you read them.
        code: A Python module bound at `lib.<name>` once you read the memory. Leave it out for a
            memory that is only prose.
        on_use: A script gg runs on that first read. Leave it out for a memory that runs nothing.

    Raises:
        ToolError: `conflict` on a duplicate slug, and `limit-exceeded` when the contents, or the
            index entry, would breach a limit.
    """
    return _usage(_call(wire.create_memory, _input(name, description, body, code, on_use)))


def read_memory(name: str) -> str:
    """Read one memory's full contents, by slug — the only thing that brings them into your context.

    If the memory carries code, reading it also loads that code: the reply names the `lib.<key>` it is
    bound at, and it stays bound for the rest of your session.

    Args:
        name: The memory's slug.

    Raises:
        ToolError: `not-found` when no memory has that slug.
    """
    return _call(wire.read_memory, name)


def edit_memory(name: str, search: str, replace: str) -> MemoryUsage:
    """Revise a memory in place by replacing the one exact occurrence of `search` with `replace`, and
    return the memory budget.

    Append by quoting the last line and replacing it with itself plus what you are adding.

    Args:
        name: The slug of the memory to revise.
        search: The exact text to find in its contents. It must appear exactly once.
        replace: The text to put in its place.

    Raises:
        ToolError: `not-found` when the text does not appear, `conflict` when it appears more than
            once, `limit-exceeded` when the result would be too long, and `invalid-argument` when the
            edit would leave the memory empty — delete it instead.
    """
    return _usage(
        _call(wire.edit_memory, wire.MemoryEdit(name=name, search=search, replace=replace))
    )


def search_memories(keywords: list[str]) -> list[MemoryHit]:
    """Find the memories mentioning any of `keywords`, best first: plain case-insensitive substring
    matching over each memory's slug, description and contents, ranked by how many of your keywords a
    memory mentions and then by how often.

    Pass several specific words rather than one sentence, then `read_memory` the hits worth having in
    full. A search that matches nothing is an empty list.

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


def delete_memory(name: str) -> MemoryUsage:
    """Evict a memory by name, freeing room in the budget, and return what is left in use.

    Args:
        name: The memory's slug.

    Raises:
        ToolError: `not-found` when no memory has that name.
    """
    return _usage(_call(wire.delete_memory, name))
