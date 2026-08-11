"""Show a file, a computed value, or a function's documentation.

A view is the only way material enters the agent's context window.

Under responses as code a whole program's output would otherwise collapse into one anonymous blob of
logs, charged to one band, attributable to nothing and closable by nothing. A view restores what tool
calling gave for free: one message per view, carrying the band it is charged to and the selector it
can be closed by.

A program's own output is unreadable by the model that wrote it, and a view is the only way a value
it computed reaches that model — `print` reaches nobody the program can hear back from.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable

from wit_world.imports import views as wire

from ._registry import operation
from .core import ToolError, ToolErrorCode, _call, _uint
from .files import FileRead, _as_file_read

__all__ = [
    "OpenView",
    "ViewKind",
    "ViewRegion",
    "close",
    "current",
    "open_docs_view",
    "open_file",
    "open_text",
]


class ViewKind(Enum):
    """Which of the three kinds a view is.

    The taxonomy is closed at three deliberately: everything on disk is a file, everything a program
    can compute is a string, and documentation is neither — gg holds it.
    """

    FILE = "file"
    """A file that was opened; its selector is the path."""

    TEXT = "text"
    """A computed value; its selector is the label it was given."""

    DOCS = "docs"
    """A function's documentation; its selector is the function's name."""


@dataclass(frozen=True)
class ViewRegion:
    """The window of lines a paged file view covers; absent for a whole-file view."""

    offset: int
    """The 1-based first line the view shows."""

    limit: int
    """How many lines it shows."""


@dataclass(frozen=True)
class OpenView:
    """One view open in the context window, as `current` reports it."""

    kind: ViewKind
    """Whether it is a file, text, or documentation view."""

    selector: str
    """What `close` takes: a file's path, a text view's label, or a docs view's function name."""

    tokens: int
    """Roughly what holding it costs, in tokens."""

    region: ViewRegion | None
    """The line window a paged file view covers; `None` for a whole-file view and for text views."""


@operation("views.open_file")
def open_file(path: str, *, offset: int | None = None, limit: int | None = None) -> FileRead:
    """Read a file and place it in the context window, attributed to its path and closable by it.

    What comes back is exactly what `files.read_file` returns; the difference is the view. That split
    is the point: reading gets bytes for the program, opening shows the file to the agent, so a
    program that reads forty files to grep them puts nothing in the window. `offset` and `limit`
    select a window of lines, and two pages of one file are two views that coexist; re-opening the
    same page replaces what it showed rather than piling up a duplicate. An image is shown as a
    picture, and this is the only call that shows one.

    Args:
        path: The file to open, relative to the workspace or absolute.
        offset: The 1-based line to start at.
        limit: How many lines to show from `offset`.

    Raises:
        ToolError: `not-found` for a missing path, and `invalid-argument` for an offset past the end
            of the file. The read is what fails; nothing is opened when it does.
    """
    return _as_file_read(
        _call(
            wire.open_file_view,
            path,
            _uint("open_file", "offset", offset),
            _uint("open_file", "limit", limit),
        )
    )


@operation("views.open_text")
def open_text(label: str, body: str) -> None:
    """Place a value the program computed into the context window, under `label`.

    A directory listing, a command's output, a child agent's answer, a table the program assembled.
    This is how the result of a program reaches the model that wrote it, and the only way it does.
    Opening the same label again replaces what it showed, so a program may refine a view in a loop
    without piling up a copy per iteration. Nothing is ever silently truncated.

    Args:
        label: What to file the view under. `close` takes it, and opening the same label again
            replaces what it showed. It may not be empty.
        body: What to show. An empty body is allowed: it is how a program says that something it was
            showing is now empty.

    Raises:
        ToolError: `invalid-argument` for an empty label — a view with no selector could never be
            closed or attributed — and `limit-exceeded`, naming the cap, for a body or label over
            gg's caps.
    """
    _call(wire.open_text_view, label, body)


@operation("views.open_docs_view")
def open_docs_view(target: Callable[..., object] | str) -> None:
    """Place one function's full documentation into the context window.

    Its signature, its description, and the declarations of any types it refers to that have not
    already been shown this session. This is how a function is read. It is a **view**, not a return
    value — the documentation arrives in the next prompt under a `Documentation` heading keyed by the
    function name, exactly as a file or a computed value arrives — so it is not available in the turn
    it is asked for. Ask in one turn, use it in the next. Opening the same function's documentation
    again replaces the view rather than adding a second copy, and `close` closes it.

    Args:
        target: The function to document: the function object itself (`files.read_file`) or the name
            it is called by in its module (`"read_file"`).

    Raises:
        ToolError: `not-found` for an unknown or unbound name.
    """
    _call(wire.open_docs_view, _docs_name(target))


def _docs_name(target: object) -> str:
    """The catalogue name behind an `open_docs_view` argument: the string, or the function's own name.

    Python needs no tag for this, unlike a guest whose bound functions are anonymous wrappers: an SDK
    function's `__name__` *is* the name gg catalogues it under, and the one closure this SDK builds —
    the `list` bound onto every module — is wrapped so that it keeps it.

    An argument that is neither a string nor a callable is refused here, before the lookup. A `None`
    that came from somewhere else would otherwise be looked up as a function literally named "None"
    and reported as an unknown name nobody wrote.
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


@operation("views.close")
def close(selector: str) -> int:
    """Close every view carrying `selector`, freeing the tokens they occupied.

    For a file that is every page of that path, for a text view the one with that label, for a
    documentation view the function's name. The number closed comes back. Closing a selector that is
    not open hands back `0` rather than failing, so a program that tidies up unconditionally need not
    guard every call. Closing a file view forgets what was read, not what exists; closing a text view
    discards the only copy of what it held, so anything needed later belongs in a file or a memory
    first.

    Args:
        selector: What the view is filed under: a file's path, a text view's label, or a
            documentation view's function name.
    """
    return _call(wire.close_view, selector)


@operation("views.current")
def current() -> list[OpenView]:
    """List what is open in the context window right now.

    Each view's `kind`, the `selector` that closes it, roughly what it costs in `tokens`, and — for a
    paged file view — the `region` it covers. Reading it is what decides what to close when the
    window is filling up.

    What it enumerates is the context window's contents, not any module's functions.
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
