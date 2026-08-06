"""The `fs` family: reading, writing, editing and listing files.

One lowering lives here. `_as_file_read` flattens the membrane's `FileRead_Text(value=…)`
wrapper into the model-facing union of `TextFile` and `ImageFile`,
which a program narrows with `isinstance` or a `match` statement rather than by reaching through
a `.value` nobody would guess at. It is shared with `view.open_file`, which performs the very
same host read and returns the very same shape.
"""

from __future__ import annotations

from wit_world.imports import files as wire

from ..errors import _call, _uint
from ..types import DirEntry, EntryKind, FileRead, ImageFile, TextFile


def _as_file_read(read: wire.FileRead) -> FileRead:
    """The membrane's tagged read, lowered to the model-facing union.

    Not catalogued and not bound: nothing in a program's scope names it, and no line of any prompt
    describes it. It is exported only so `view.open_file` — which performs the identical host read
    — shares this one lowering rather than keeping a second copy of it.
    """
    if isinstance(read, wire.FileRead_Text):
        text = read.value
        return TextFile(
            contents=text.contents,
            first_line=text.first_line,
            last_line=text.last_line,
            total_lines=text.total_lines,
            byte_truncated=text.byte_truncated,
        )
    image = read.value
    return ImageFile(
        media_type=image.media_type,
        label=image.label,
        bytes=image.bytes,
        shown=image.shown,
        not_shown_reason=image.not_shown_reason,
    )


def _as_dir_entry(entry: wire.DirEntry) -> DirEntry:
    """One membrane directory entry, with its kind lowered onto the model-facing enum."""
    return DirEntry(name=entry.name, kind=EntryKind[entry.kind.name])


def read_file(path: str, *, offset: int | None = None, limit: int | None = None) -> FileRead:
    """Read a file, returning a `TextFile` or an `ImageFile` — the format is detected from the file's
    bytes, never its extension.

    This gets bytes for your PROGRAM and puts NOTHING in your context window; `view.open_file` is the
    call that shows the file to you. A relative path resolves against your workspace; an absolute one
    is read as given, so anything in this container — an offloaded command's output under
    `/tmp/gg-shell`, say — is readable.

    Reading an IMAGE describes it to your program — label, media type, byte size — and does not show
    it to YOU: the pixels reach neither your program nor your context window, so a file you only
    `read_file` is a file you have not looked at. `view.open_file` is the one way to actually see a
    picture.

    Args:
        path: The file to read. Relative to your workspace, or absolute for anything else in this
            container.
        offset: The 1-based line to start at. Honoured only under a capped read policy.
        limit: How many lines to return from `offset`. Honoured only under a capped read policy.

    Raises:
        ToolError: `not-found` for a missing path.
    """
    return _as_file_read(
        _call(
            wire.read_file,
            path,
            _uint("read_file", "offset", offset),
            _uint("read_file", "limit", limit),
        )
    )


def write_file(path: str, contents: str) -> int:
    """Write UTF-8 text to a file, creating parent directories and replacing any existing file, and
    return the number of bytes written.

    Writing is the expensive direction of the sandbox — rewriting more than a few dozen large files
    in one program exhausts its fuel budget, so split a large rewrite across several turns.

    Args:
        path: Where to write. Relative to your workspace, or absolute. Parent directories are created
            for you.
        contents: The UTF-8 text to write. It replaces the file entirely.
    """
    return _call(wire.write_file, path, contents)


def edit_file(path: str, old_string: str, new_string: str) -> None:
    """Replace the one exact occurrence of `old_string` in a file with `new_string`.

    Widen the surrounding context until the match is unique rather than counting occurrences.

    Args:
        path: The file to edit.
        old_string: The exact text to find, including its whitespace. It must appear exactly once.
        new_string: The text to put in its place. An empty string deletes the match.

    Raises:
        ToolError: `not-found` when the text does not appear, and `conflict` — with the number of
            matches — when it appears more than once.
    """
    _call(wire.edit_file, path, old_string, new_string)


def list_dir(path: str | None = None) -> list[DirEntry]:
    """List a directory, sorted by name; defaults to your workspace.

    Each entry carries a bare `name` — join it with the directory you listed — and its `kind`. An
    empty directory is an empty list, not a failure.

    Args:
        path: The directory to list; leave it out for your workspace root.
    """
    return [_as_dir_entry(entry) for entry in _call(wire.list_dir, path)]
