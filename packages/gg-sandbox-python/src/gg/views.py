"""Show a file, a computed value, or an entry's documentation.

A view is the only way material enters the context window. Each one arrives as its own message,
carrying the band it is charged to and the selector it is filed under. `print` shows nothing.
"""

from __future__ import annotations

from typing import Callable

from wit_world.imports import views as wire

from ._registry import missing, operation
from .core import ApiError, ApiErrorCode, _call, _uint
from .files import FileRead, _as_file_read

__all__ = [
    "close",
    "open_docs_view",
    "open_file",
    "open_text",
]


@operation("views.open_file")
def open_file(
    path: str,
    *,
    offset: int | None = None,
    limit: int | None = None,
    max_line_chars: int | None = None,
) -> FileRead:
    """Read a file and place it in the context window, attributed to its path and filed under it.

    `offset` and `limit` select a window of lines. Two pages of one file are two views that coexist;
    re-opening the same page replaces what it showed. An image is shown as a picture.

    The view's text body is held to a 65,536-byte cap: a window that would carry more is refused,
    naming the size and the bound, and nothing is opened — never a truncation. `max_line_chars` cuts
    each line of the view longer than that many characters at that point and annotates it in place as
    `foo (123 more chars...)`, with the count of characters dropped. The cut is the view's alone —
    what this call returns and the file itself are untouched — and the byte cap is measured against
    the body after it. Left out, lines arrive whole. A picture is not a text body and is not subject
    to the cap.

    Args:
        path: The file to open, relative to the workspace or absolute.
        offset: The 1-based line to start at.
        limit: How many lines to show from `offset`.
        max_line_chars: The most characters of each line to show, 1 to 65,536; a longer line is cut
            there and annotated with how many characters were dropped. The default shows lines whole.

    Returns:
        The file's contents: a `TextFile` for a text window, an `ImageFile` for a picture.

    Raises:
        ApiError: `not-found` for a missing path, `invalid-argument` for an offset past the end of
            the file or a `max_line_chars` of zero or over 65,536, and `limit-exceeded` — naming the
            size and the bound — for a text window over the cap. The read is what fails; nothing is
            opened when it does.
    """
    return _as_file_read(
        _call(
            wire.open_file_view,
            path,
            _uint("open_file", "offset", offset),
            _uint("open_file", "limit", limit),
            _uint("open_file", "max_line_chars", max_line_chars),
        )
    )


@operation("views.open_text")
def open_text(label: str, body: str) -> None:
    """Place a value the program computed into the context window, under `label`.

    Opening the same label again replaces what it showed. Nothing is ever silently truncated.

    Args:
        label: What to file the view under; opening the same label again replaces what it showed.
            It may not be empty.
        body: What to show. An empty body is allowed: it is how a program says that something it was
            showing is now empty.

    Raises:
        ApiError: `invalid-argument` for an empty label, and `limit-exceeded`, naming the cap, for a
            body or label over gg's caps.
    """
    _call(wire.open_text_view, label, body)


@operation("views.open_docs_view")
def open_docs_view(target: Callable[..., object] | str) -> None:
    """Place one module, function, or type's full documentation into the context window.

    Its signature, its description, and the declarations of any types it refers to that have not
    already been shown this session. The documentation arrives in the next prompt under a
    `Documentation` heading keyed by the entry's name rather than as a return value, so it is not
    available in the turn it is asked for. Opening a key that is already open does nothing.

    Args:
        target: What to document: the function object itself (`views.open_text`), or the
            fully-qualified name its documentation is keyed by (`"gg.views.open_text"`), which for a
            module is that module's own path (`"gg.views"`). The bare name it is called by in its
            module (`"open_text"`) also resolves, and is ambiguous when two modules declare it.

    Raises:
        ApiError: `not-found` for an unknown or unbound name.
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
        raise ApiError(
            "open_docs_view",
            ApiErrorCode.INVALID_ARGUMENT,
            f"expected a function or a function name, got {target!r}",
        )
    return name


@operation("views.close")
def close(selector: str) -> int:
    """Close every view carrying `selector`, freeing the tokens they occupied.

    Closing a file view forgets what was read, not what exists; closing a text view discards the only
    copy of what it held. Documentation views are not closed from here.

    Args:
        selector: What the view is filed under: a file's path, a text view's label, or
            `search results`.

    Returns:
        How many views were closed: for a file every page of that path, for a text view the one with
            that label, for the results of a search the label `search results`. A selector that is
            not open hands back `0`.

    Raises:
        ApiError: `invalid-argument` for an empty selector, and `unavailable` under a run that did
            not enable closing views.
    """
    return _call(wire.close_view, selector)


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
