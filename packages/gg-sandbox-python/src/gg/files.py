"""Read, write, edit, list and walk the files of the workspace.

Nothing here places anything in the context window.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from wit_world.imports import files as wire

from ._registry import missing, operation
from .core import ApiError, ApiErrorCode, _call, _uint

__all__ = [
    "DirEntry",
    "EntryKind",
    "FileRead",
    "ImageFile",
    "SearchMatch",
    "TextFile",
    "edit_file",
    "list_dir",
    "read_file",
    "search",
    "tree",
    "write_file",
]


@dataclass(frozen=True)
class TextFile:
    """A text file's window, as the text arm of a `FileRead` carries it."""

    contents: str
    """The file's text, or just the requested window where the read named one."""

    first_line: int
    """The 1-based first line returned."""

    last_line: int
    """The 1-based last line returned."""

    total_lines: int
    """The file's total line count."""

    byte_truncated: bool
    """Whether a 256 KiB byte ceiling cut the returned text."""


@dataclass(frozen=True)
class ImageFile:
    """A picture's description, as the image arm of a `FileRead` carries it.

    The pixels never enter the program.
    """

    media_type: str
    """The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`)."""

    label: str
    """The short format label (`PNG`, `JPEG`, `GIF`, `WebP`)."""

    bytes: int
    """The file's size in bytes."""

    shown: bool
    """Whether the picture is being attached to this turn to be looked at."""

    not_shown_reason: str | None
    """Why it is not being shown; `None` when it is."""


FileRead = TextFile | ImageFile
"""What a read returned: a text file's window, or a picture's description.

`isinstance(read, TextFile)`, or a `match` on the two, narrows it.
"""


class EntryKind(Enum):
    """What a directory entry is."""

    FILE = "file"
    """An ordinary file."""

    DIRECTORY = "directory"
    """A directory, which can be listed in turn."""

    OTHER = "other"
    """Everything that is neither, a symlink among them."""


@dataclass(frozen=True)
class DirEntry:
    """One entry `list_dir` found: a bare name, and its kind."""

    name: str
    """The entry's bare name, with no directory part. Join it with the directory that was listed."""

    kind: EntryKind
    """What the entry is."""


@dataclass(frozen=True)
class SearchMatch:
    """One line `search` matched: where it is, and the line itself."""

    path: str
    """The file's path, with `/` separators.

    Relative to the workspace root, or absolute for a search rooted outside it.
    """

    line: int
    """The 1-based line number of the match within that file."""

    text: str
    """The matching line, without its line ending.

    A line longer than 200 characters is cut there and annotated in place as `foo (123 more
    chars...)`.
    """


def _as_search_match(match: wire.SearchMatch) -> SearchMatch:
    """One membrane search match, as the model-facing class."""
    return SearchMatch(path=match.path, line=match.line, text=match.text)


def _as_file_read(read: wire.FileRead) -> FileRead:
    """The membrane's tagged read, lowered to the model-facing union.

    Not catalogued and not bound: nothing in a program's scope names it, and no line of any prompt
    describes it.
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


@operation("files.read_file")
def read_file(path: str, *, offset: int | None = None, limit: int | None = None) -> FileRead:
    """Read a file, as either a `TextFile` or an `ImageFile`.

    Which of the two comes back is detected from the file's bytes, never from the extension, so a
    mislabelled picture is still a picture. A `match` narrows them:

    ```python
    match gg.files.read_file("logo.png"):
        case gg.files.TextFile(contents=text):
            ...
        case gg.files.ImageFile(label=label):
            ...
    ```

    A relative path resolves against the workspace; an absolute one is read as given. This call
    hands bytes to the program and places nothing in the context window; reading a picture describes
    it and shows nothing.

    Args:
        path: The file to read, relative to the workspace or absolute.
        offset: The 1-based line to start at. Left out, the read starts at the first line.
        limit: How many lines to return from `offset`. Left out, a capped read policy's default
            applies, or the read runs to the end of the file.

    Returns:
        The `TextFile` for a text file's window, or the `ImageFile` describing a picture whose bytes
            never entered the program.

    Raises:
        ApiError: `not-found` for a missing path.
    """
    return _as_file_read(
        _call(
            wire.read_file,
            path,
            _uint("read_file", "offset", offset),
            _uint("read_file", "limit", limit),
        )
    )


@operation("files.write_file")
def write_file(path: str, contents: str) -> int:
    """Write UTF-8 text to a file, creating parent directories and replacing what is there.

    Args:
        path: Where to write, relative to the workspace or absolute. Parent directories are created.
        contents: The UTF-8 text to write. It replaces the file entirely.

    Returns:
        How many bytes were written, which is the UTF-8 length rather than the number of characters.

    Raises:
        ApiError: `invalid-argument` for an empty path, and `io-error` when creating the parent
            directories or the write itself failed.
    """
    return _call(wire.write_file, path, contents)


@operation("files.edit_file")
def edit_file(path: str, old_string: str, new_string: str) -> None:
    """Replace the one exact occurrence of some text in a file with something else.

    Args:
        path: The file to edit.
        old_string: The exact text to find, whitespace included. It must appear exactly once.
        new_string: The text to put in its place. An empty string deletes the match.

    Raises:
        ApiError: `not-found` when the text does not appear, and `conflict` — with the number of
            matches — when it appears more than once.
    """
    _call(wire.edit_file, path, old_string, new_string)


@operation("files.list_dir")
def list_dir(path: str | None = None) -> list[DirEntry]:
    """List a directory, sorted by name; the default lists the workspace root.

    Args:
        path: The directory to list, relative to the workspace or absolute. The default lists the
            workspace root.

    Returns:
        One entry per name, sorted by name, and an empty list for an empty directory rather than a
            failure. Each `name` is bare, so joining it with the directory that was listed is what
            makes a path.

    Raises:
        ApiError: `not-found` for a directory that is not there, and `invalid-argument` for a path
            that is given but empty — the default is what lists the workspace root.
    """
    return [_as_dir_entry(entry) for entry in _call(wire.list_dir, path)]


@operation("files.tree")
def tree(*, path: str | None = None, depth: int | None = None) -> str:
    """Render the tree beneath a directory, skipping everything the ignore files exclude.

    One block of text: the root itself unnamed, each level indented two further spaces than its
    parent, every level in path order, and directories suffixed `/`. A root with nothing beneath it
    renders as `(empty directory)`.

    `depth` counts levels of children below the root, so `1` is the root's own entries. A directory
    sitting at the bound is suffixed with how many entries it holds that were not walked, as
    `assets/ (12 entries not shown)`.

    What `.gitignore`, `.ignore` and their kin exclude — nested files, negations and
    `.git/info/exclude` included, and `.git` itself — is never walked and never rendered, whether or
    not the workspace is a repository yet. Dotfiles are otherwise rendered like any other entry, and
    symbolic links are not followed.

    The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut by
    either ends with a line saying so.

    Args:
        path: The directory to walk, relative to the workspace or absolute. The default walks the
            workspace root.
        depth: How many levels of children below the root to render, at least 1. The default is 2
            and the ceiling 10, so a larger request is answered at 10.

    Returns:
        The rendered tree.

    Raises:
        ApiError: `not-found` for a `path` that does not exist, and `invalid-argument` for a `path`
            that is not a directory or a `depth` of zero.
    """
    bound = _uint("tree", "depth", depth)
    if bound == 0:
        raise ApiError(
            "tree",
            ApiErrorCode.INVALID_ARGUMENT,
            "`depth` must be at least 1, got 0; leave it out for gg's default of 2",
        )
    return _call(wire.tree, path, bound)


@operation("files.search")
def search(query: str, *, path: str | None = None, limit: int | None = None) -> list[SearchMatch]:
    r"""Search the workspace's files for a regular expression and hand back every matching line.

    A grep over the project rather than over the disk. `query` is a regular expression in Rust
    syntax — `foo|bar`, `fn\s+update`, `(?i)todo` — matched against each line on its own. Every line
    it matches comes back with its path and 1-based line number, in path order and then line order.
    `path` roots the search at one directory or one file; the default is the workspace root.

    What `.gitignore`, `.ignore` and their kin exclude — nested files, negations and
    `.git/info/exclude` included, and `.git` itself — is never scanned and never returned, whether or
    not the workspace is a repository yet. A file carrying a NUL byte is skipped. Dotfiles are
    otherwise searched like any other file, and a file under an ignored path is still readable by its
    path.

    At most `limit` matches come back — 50 by default, never more than 200 — and a list exactly
    `limit` long may have been cut. There is no offset. A matching line longer than 200 characters is
    cut there and annotated in place as `foo (123 more chars...)`.

    Args:
        query: The regular expression to match each line against, in Rust syntax; `(?i)` at the
            front makes it case-insensitive. It may not be blank.
        path: The directory or file to search, relative to the workspace or absolute. The default
            searches the whole workspace.
        limit: The most matches to return, at least 1. The default is 50 and the ceiling 200, so a
            larger request is answered with the first 200 rather than refused.

    Returns:
        Every matching line, in path order and then line order, each with its `path`, 1-based `line`
            and `text`. A search that matches nothing is an empty list, and a list exactly `limit`
            long may have been cut.

    Raises:
        ApiError: `invalid-argument` for a blank query, one that is not a valid pattern, or a
            `limit` of zero, and `not-found` for a `path` that does not exist.
    """
    bound = _uint("search", "limit", limit)
    if bound == 0:
        raise ApiError(
            "search",
            ApiErrorCode.INVALID_ARGUMENT,
            "`limit` must be at least 1, got 0; leave it out for gg's default of 50",
        )
    return [_as_search_match(match) for match in _call(wire.search, query, path, bound)]


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
