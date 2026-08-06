"""The `docs` carve-out: documentation lookup, bound onto every API object and never a gg tool.

It is one of the model-facing families that is not a capability: no toolset offers it, an ablation
cannot withhold it, and it is absent from `TOOL_CATALOGUE` so the bijection the component is checked
against is undisturbed. `gg.scope.build_scope` binds it onto every API object as `<object>.list()`,
so a model can always discover the functions it has, whatever a run enables. Reading what one *does*
is `view.open_docs_view` — a view, because everything the model reads is a view.
"""

from __future__ import annotations

from typing import Callable

from functools import wraps

from wit_world.imports import docs as wire

from ..types import FunctionSummary


def list() -> list[FunctionSummary]:
    """List the functions available on this API object, each with a one-line summary.

    Only the functions this run actually bound are returned, so the directory never names a call your
    program cannot make. Open a view of one function's full signature, argument descriptions and types
    with `view.open_docs_view`.
    """
    # DECLARED here and bound by `bind_list`, which is the honest shape of it: the function a program
    # calls takes no arguments because the object it belongs to is closed over, and there is no one
    # object this declaration could name. Writing the signature and the documentation HERE, on a real
    # declaration, is what keeps them reflected out of the code like every other function's rather
    # than written into a table gg could never check.
    raise NotImplementedError(
        "`list` is bound per object by `gg.scope.build_scope`; call it as `<object>.list()`."
    )


def bind_list(object: str) -> Callable[[], "list[FunctionSummary]"]:
    """The `list` an API object carries, with that object's name closed over.

    `functools.wraps` is what makes the bound function keep the name and the documentation of the
    declaration above, so `view.open_docs_view(fs.list)` resolves and a program that inspects it reads
    the same paragraph the catalogue carries.

    Args:
        object: The API object the bound function lists (`fs`, `view`, …).
    """

    @wraps(list)
    def bound() -> "list[FunctionSummary]":
        return [
            FunctionSummary(name=entry.name, summary=entry.summary)
            for entry in wire.list_functions(object)
        ]

    return bound
