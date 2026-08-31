"""Find what this session can call, and take a documentation view back out of the window.

The system prompt names modules and no function. `search` turns a keyword or a module id into
fully-qualified names, and a documentation view reads one of those names in full. Searching is always
bound; closing a documentation view is bought by a capability, and a run that did not enable it gets
`ApiErrorCode.UNAVAILABLE`.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from wit_world.imports import docs as wire

from ._registry import missing, operation
from .core import ApiError, ApiErrorCode, _call, _strings, _uint

__all__ = [
    "DocHit",
    "DocKind",
    "DocSearch",
    "close",
    "close_all",
    "search",
]


class DocKind(Enum):
    """Which of the three kinds of thing a documentation entry describes."""

    MODULE = "module"
    """A module a program imports, holding the functions it calls."""

    FUNCTION = "function"
    """A function a program calls."""

    TYPE = "type"
    """A type a function takes or hands back."""


@dataclass(frozen=True)
class DocHit:
    """One entry a search matched: enough to choose from, and no more."""

    key: str
    """The fully-qualified name a documentation view is opened by."""

    kind: DocKind
    """Whether it is a module, a function or a type."""

    module: str
    """The module it lives in: the one that publishes a function, or the one that declares a type.

    It is the module's own path, which is what `modules` filters on.
    """

    name: str
    """The name a program calls it by, or the type's own name."""

    summary: str
    """Its one-line brief, and only that. The rest is what a documentation view is for."""


@dataclass(frozen=True)
class DocSearch:
    """A page of search results, with the total behind it."""

    total: int
    """How many entries matched before paging, which tells a capped page from a complete answer."""

    offset: int
    """The offset this page starts at, echoed back."""

    hits: list[DocHit]
    """The page itself, best first."""


def _kind(value: str) -> DocKind:
    """The wire's word for a kind, as the enum a program compares against.

    gg owns both ends of this string and its set is closed at three, so a word that is not one of
    them is a mismatch between this SDK and the host rather than anything a program did — reported
    as such, rather than as the `ValueError` an enum lookup would otherwise raise out of the
    lowering.
    """
    try:
        return DocKind(value)
    except ValueError:
        raise ApiError(
            "search",
            ApiErrorCode.OTHER,
            f"gg reported a kind of documentation entry this SDK does not know: {value!r}",
        ) from None


@operation("docs.search")
def search(
    *,
    query: str | None = None,
    modules: list[str] | None = None,
    type: str | None = None,
    kind: DocKind | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> DocSearch:
    """Search every module, function and type this session can call, by keyword and by filter.

    Matching is a case-insensitive substring over names, signatures, briefs and detailed
    descriptions, so `docs` finds `open_docs_view`. Ranking is by the kind of evidence that matched —
    an entry whose own name matched outranks one that merely mentions the word in a paragraph — and a
    weaker kind never overtakes a stronger one however often it occurs.

    Only entries this run bound are returned. Every argument is optional and they compose: a query
    alone ranks the whole surface, a filter alone is a directory of what it names, and the two
    together search inside the filter.

    The page comes back as a value and is also opened as a view, under the selector `search results`.
    The next search replaces that view.

    Args:
        query: The words to match, as a case-insensitive substring. The default is no query at all,
            which is what turns a filter into a directory rather than a search.
        modules: The modules to look in, each named by its gg id — `files`, `views`, `docs` — or by
            the path a program imports it under — `gg.files` — and matched exactly. Several name a
            union: an entry in any one of them is a hit, so one call lists a whole granted surface.
            With no `query` it is those modules' whole directory. A name no module has matches
            nothing rather than failing, so an empty page means the filter found nothing, not that
            it was rejected. The default is no module filter at all.
        type: One type's name, narrowing to that type and to the functions that take or return it.
            Like `modules`, a name nothing declares matches nothing rather than failing.
        kind: Whether to return modules, functions or types. The default returns all three.
        offset: How many hits to skip, for reading past the first page. The default starts at the
            best hit.
        limit: The most hits to return. The default is gg's own page size and there is a ceiling
            above it. Zero is refused.

    Returns:
        The page that matched, best first. `total` counts every entry that matched before paging, so
            a page shorter than `total` is a page there is more of.

    Raises:
        ApiError: `invalid-argument` for a call with no query and no filter at all, and for a
            `limit` of zero. A `modules` entry or a `type` that names something gg does not hold
            matches nothing rather than failing.
    """
    found = _call(
        wire.search,
        query,
        _strings("search", "modules", modules),
        type,
        None if kind is None else kind.value,
        _uint("search", "offset", offset),
        _uint("search", "limit", limit),
    )
    return DocSearch(
        total=found.total,
        offset=found.offset,
        hits=[
            DocHit(
                key=hit.key,
                kind=_kind(hit.kind),
                module=hit.module,
                name=hit.name,
                summary=hit.summary,
            )
            for hit in found.hits
        ],
    )


@operation("docs.close")
def close(key: str) -> int:
    """Take one documentation view out of the context window, by the key it was opened under.

    The removal has no cascade: closing a type's view leaves every function view beside it, and
    closing a function's leaves its types. Nothing records why a view was opened, so a type that is
    closed is opened again by the next function that mentions it.

    Args:
        key: The fully-qualified name the view was opened under.

    Returns:
        How many views were taken away; a key that is not open closes `0` rather than failing.

    Raises:
        ApiError: `unavailable` under a run that did not enable closing documentation views.
    """
    return _call(wire.close_doc_view, key)


@operation("docs.close_all")
def close_all() -> int:
    """Take every documentation view out of the context window.

    The blanket form of `close`, on exactly the same terms and behind the same capability.

    Returns:
        How many documentation views went, and `0` rather than a failure when none was open.

    Raises:
        ApiError: `unavailable` under a run that did not enable closing documentation views.
    """
    return _call(wire.close_doc_views)


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
