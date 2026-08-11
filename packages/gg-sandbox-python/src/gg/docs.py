"""Find what the agent can call, and take a documentation view back out of the window.

The system prompt names modules and no function at all, so this module is the way into every other
one: `search` turns a keyword or a module id into fully-qualified names, and `views.open_docs_view`
reads one of those names in full.

Searching is bound in every program whatever a run enables, because an agent must always be able to
find the functions it does hold. Closing a documentation view is the exception and is bought by a
capability: opening one only ever appends to the prompt, while closing one rewrites its middle, and
a run that did not enable it gets `ToolErrorCode.UNAVAILABLE`.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from wit_world.imports import docs as wire

from ._registry import operation
from .core import ToolError, ToolErrorCode, _call, _uint

__all__ = [
    "DocHit",
    "DocKind",
    "DocSearch",
    "close",
    "close_all",
    "search",
]


class DocKind(Enum):
    """Which of the two kinds of thing a documentation entry describes."""

    FUNCTION = "function"
    """A function a program calls."""

    TYPE = "type"
    """A type a function takes or hands back."""


@dataclass(frozen=True)
class DocHit:
    """One entry a search matched: enough to choose from, and no more."""

    key: str
    """The fully-qualified name `views.open_docs_view` takes to read the whole entry."""

    kind: DocKind
    """Whether it is a function or a type."""

    module: str
    """The module it lives in.

    A function has exactly one. A type shows every module in which a function the agent can call
    mentions it — never one nothing is held in, and comma-separated when there are several. That
    makes it a description rather than something to pass back as `module`, which takes one module.
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

    gg owns both ends of this string and its set is closed at two, so a word that is not one of them
    is a mismatch between this SDK and the host rather than anything a program did — reported as
    such, rather than as the `ValueError` an enum lookup would otherwise raise out of the lowering.
    """
    try:
        return DocKind(value)
    except ValueError:
        raise ToolError(
            "search",
            ToolErrorCode.OTHER,
            f"gg reported a kind of documentation entry this SDK does not know: {value!r}",
        ) from None


@operation("docs.search")
def search(
    query: str,
    *,
    module: str | None = None,
    type: str | None = None,
    kind: DocKind | None = None,
    offset: int | None = None,
    limit: int | None = None,
) -> DocSearch:
    """Search every function and type the agent can call, by keyword and by filter.

    This is how a name is found. Matching is a case-insensitive substring over names, signatures,
    briefs and detailed descriptions, so `docs` finds `open_docs_view`. Ranking is by the kind of evidence
    that matched — an entry whose own name matched outranks one that merely mentions the word in a
    paragraph — and a weaker kind never overtakes a stronger one however often it occurs.

    Only entries this run bound are returned, so nothing a search finds is something the run
    withheld. The filters compose with each other and with `query`.

    The page comes back as a value and is also opened as a view, under the selector `search results`,
    so it can be read on the next turn without a program showing it to itself. The next search
    replaces that view: it names what is being worked from rather than keeping a record.

    Args:
        query: The words to match, as a case-insensitive substring. It may be empty when at least one
            filter is given.
        module: One module's id — `files`, `views`, `docs` — matched exactly. An empty `query` with a
            module is that module's whole directory rather than a search. A name no module has
            matches nothing rather than failing, so an empty page means the filter found nothing,
            not that it was rejected.
        type: One type's name, narrowing to that type and to the functions that take or return it.
            Like `module`, a name nothing declares matches nothing rather than failing.
        kind: Whether to return functions or types. The default returns both.
        offset: How many hits to skip, for reading past the first page. The default starts at the
            best hit.
        limit: The most hits to return. The default is gg's own page size and there is a ceiling
            above it, so comparing `len(hits)` against `total` is the only way to see a capped page.
            Zero is refused rather than read as "no cap".

    Returns:
        The page that matched, best first. `total` counts every entry that matched before paging, so
            a page shorter than `total` is a page there is more of.

    Raises:
        ToolError: `invalid-argument` for an empty query with no filter at all — nothing matched and
            nothing was asked for are different answers — and for a `limit` of zero, which would ask
            for a page that answers nothing. A `module` or `type` that names something gg does not
            hold is not among them: it matches nothing.
    """
    found = _call(
        wire.search,
        query,
        module,
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
        ToolError: `unavailable` under a run that did not enable closing documentation views.
    """
    return _call(wire.close_doc_view, key)


@operation("docs.close_all")
def close_all() -> int:
    """Take every documentation view out of the context window.

    The blanket form of `close`, on exactly the same terms and behind the same capability.

    Returns:
        How many documentation views went, and `0` rather than a failure when none was open.

    Raises:
        ToolError: `unavailable` under a run that did not enable closing documentation views.
    """
    return _call(wire.close_doc_views)
