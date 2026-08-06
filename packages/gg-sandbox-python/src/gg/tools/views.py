"""The `view` object: the only way material enters an agent's own context window.

These are not gg tools. No capability offers one, nothing dispatches one by name, and four of the
five are bound into **every** program's scope — the same carve-out `harness` has, and for the same
reason: a run that enables no tools at all must still be able to show its model something.
Cataloguing them among the tools would break the `bound_tools() == ALL_TOOL_NAMES` bijection the
committed component is checked against, so they have their own membrane interface, their own
`gg.catalogue.VIEW_ENTRIES` list, and their own object.

**Why the object exists at all.** Under responses-as-code a whole program's output used to collapse
into one anonymous blob of logs, charged to one band, attributable to nothing and evictable by
nothing. A view restores what tool calling gave for free: one message per view, carrying the band it
is charged to and the selector it can be closed by. So `print` reaches the run's operator, and a
**view** reaches the model.
"""

from __future__ import annotations

from typing import Callable

from wit_world.imports import views as wire

from ..errors import ToolError, _call, _uint
from ..types import FileRead, OpenView, ToolErrorCode, ViewKind, ViewRegion
from .files import _as_file_read


def open_file(path: str, *, offset: int | None = None, limit: int | None = None) -> FileRead:
    """Read a file AND show it to yourself: you get back exactly what `fs.read_file` returns, and the
    file also becomes its own item in your context window, attributed to its path and closable by it.

    The split from `fs.read_file` is the point — `fs.read_file` gets bytes for your PROGRAM,
    `view.open_file` shows a file to YOU — so a program that reads forty files to grep them still puts
    nothing in your window. `offset` and `limit` select a window of lines, and two pages of one file
    are two views that coexist; re-opening the SAME page replaces what it showed rather than piling up
    a duplicate. An image file is shown to you as a picture, and is the ONLY way to look at one —
    `fs.read_file` of an image describes it without showing it.

    Pictures are the one thing this call can refuse. Only so many image-carrying views may be open at
    once (your agent's `imageViewCap`); nothing is opened and nothing is shown when you pass that cap,
    so close one with `view.close(path)` and try again. Re-opening a picture you already have open
    replaces it rather than adding one, and is never refused. Text views are never refused by this
    cap.

    Args:
        path: The file to open. Relative to your workspace, or absolute.
        offset: The 1-based line to start at.
        limit: How many lines to show from `offset`.

    Raises:
        ToolError: `limit-exceeded`, naming the cap, when opening a picture would pass your agent's
            image-view cap.
    """
    return _as_file_read(
        _call(
            wire.open_file_view,
            path,
            _uint("open_file", "offset", offset),
            _uint("open_file", "limit", limit),
        )
    )


def open_text(label: str, body: str) -> None:
    """Show yourself a value your program computed, under `label` — a directory listing, a command's
    output, a child agent's answer, a table you assembled.

    This is what replaced `print` as the channel into your context: what you print goes to the run's
    operator, views come back to you on your next turn.

    Opening the same `label` again replaces what it showed, so a program may refine a view in a loop
    without piling up a copy per iteration. An empty BODY is allowed, since it is how you say that
    something you were showing is now empty. Nothing is ever silently truncated.

    Args:
        label: What to file the view under. It is what `view.close` takes, and opening the same label
            again replaces what it showed. It may not be empty.
        body: What to show yourself. An empty body is allowed: it is how you say that something you
            were showing is now empty.

    Raises:
        ToolError: `invalid-argument` for an empty label — a view with no selector could never be
            closed or attributed — and `limit-exceeded`, naming the cap, for a body or label over
            gg's caps.
    """
    _call(wire.open_text_view, label, body)


def open_docs_view(target: Callable[..., object] | str) -> None:
    """Show yourself the full documentation for one function: its signature, its description, and the
    declarations of any types it refers to that you have not already been shown this session.

    Pass the function itself (`view.open_docs_view(fs.read_file)`) or its name
    (`view.open_docs_view("read_file")`).

    This is how you read what a function does. It is a **view**, not a return value — the
    documentation arrives in your next prompt under a `Documentation` heading keyed by the function
    name, exactly as a file or a computed value arrives — so it is not available in the turn you ask
    for it. Plan for that: ask in one turn, use it in the next. Opening the same function's docs again
    replaces the view rather than adding a second copy, and `view.close(name)` closes it when you are
    done with it. `<object>.list()` is how you find out which names exist.

    Args:
        target: The function to document — the function itself (`fs.read_file`) or its name
            (`"read_file"`).

    Raises:
        ToolError: `not-found` for an unknown or unbound name.
    """
    _call(wire.open_docs_view, _docs_name(target))


def _docs_name(target: object) -> str:
    """The catalogue name behind a `view.open_docs_view` argument: the string itself, or the bound
    function's own `__name__`.

    Python needs no tag for this, unlike a guest whose bound functions are anonymous wrappers: an SDK
    function's `__name__` *is* the name gg catalogues it under, and the one closure this SDK builds —
    the `list` bound onto every object — is wrapped so that it keeps it.

    An argument that is neither a string nor a callable is refused **here**, before the lookup.
    `view.open_docs_view(system.run)` — an attribute this run does not bind — raises an
    `AttributeError` of Python's own long before the call, but a `None` that came from somewhere else
    would otherwise be looked up as a function literally named "None" and reported as an unknown name
    the model never wrote.
    """
    if isinstance(target, str):
        return target
    name = getattr(target, "__name__", None)
    if not callable(target) or not isinstance(name, str):
        raise ToolError(
            "open_docs_view",
            ToolErrorCode.INVALID_ARGUMENT,
            f"expected a function or a function name, got {target!r}",
        )
    return name


def close(selector: str) -> int:
    """Close every view carrying `selector` — for a file that is every page of that path, for a text
    view the one with that label, for a documentation view the function's name — and return how many
    were closed, freeing the tokens they occupied.

    Closing a selector that is not open returns `0` rather than failing, so a program that tidies up
    unconditionally does not have to guard every call. Closing a file view forgets what you read, not
    what exists; closing a text view discards the only copy of what it held, so write anything you
    will need later to a file or a memory first.

    Args:
        selector: What the view is filed under: a file's path, a text view's label, or a documentation
            view's function name.
    """
    return _call(wire.close_view, selector)


def current() -> list[OpenView]:
    """List what is open in your context window right now: each view's `kind`, the `selector` that
    closes it, roughly what it costs you in `tokens`, and — for a paged file view — the `region` it
    covers.

    It is called `current` rather than `list` because every API object already carries a `list()` that
    lists that object's own functions. Read it before deciding what to close when your window is
    filling up.
    """
    return [
        OpenView(
            kind=ViewKind[view.kind.name],
            selector=view.selector,
            tokens=view.tokens,
            region=(
                None
                if view.region is None
                else ViewRegion(offset=view.region.offset, limit=view.region.limit)
            ),
        )
        for view in _call(wire.current_views)
    ]
