"""The one function that belongs to no capability module, because it belongs to all of them.

Every module a program is given carries a `list`, so a program can always discover what it has
whatever a run enables. Reading what one of those functions *does* is `views.open_docs_view` — a
view, because everything a model reads is a view.

It is declared **once**, here, and bound onto each module with that module's own path closed over.
Twelve copies of one function would be twelve copies of one paragraph of model-facing documentation
with nothing keeping them equal, and this SDK's rule is that every word a model reads is written on
the code exactly once.
"""

from __future__ import annotations

from functools import wraps
from typing import Callable

from wit_world.imports import docs as wire

from .core import FunctionSummary


def list() -> list[FunctionSummary]:
    """List the functions this module offers, each with a one-line summary.

    Only the functions this run actually bound are returned, so the directory never names a call the
    program cannot make. One function's full signature, argument descriptions and types are opened as
    a view with `views.open_docs_view`.
    """
    # DECLARED here and bound by `bind_list`, which is the honest shape of it: the function a program
    # calls takes no arguments because the module it belongs to is closed over, and there is no one
    # module this declaration could name. Writing the signature and the documentation HERE, on a real
    # declaration, is what keeps them reflected out of the code like every other function's rather
    # than written into a table gg could never check.
    raise NotImplementedError(
        "`list` is bound per module by `gg.scope.build_scope`; call it as `<module>.list()`."
    )


def bind_list(module: str) -> Callable[[], list[FunctionSummary]]:
    """The `list` a capability module carries, with that module's path closed over.

    `functools.wraps` is what makes the bound function keep the name and the documentation of the
    declaration above, so a program that inspects it reads the same paragraph the catalogue carries.

    Args:
        module: The module's own path, as the catalogue spells it (`gg.files`).
    """

    @wraps(list)
    def bound() -> list[FunctionSummary]:
        return [
            FunctionSummary(name=entry.name, summary=entry.summary)
            for entry in wire.list_functions(module)
        ]

    return bound
