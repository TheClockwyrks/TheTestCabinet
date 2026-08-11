"""The names a program is given: the capability modules, and the types they speak in.

Two things are built here, and neither of them varies with the run any more — which is the whole of
gg's capability model as this guest now sees it.

**The modules are the SDK's.** `files`, `board`, `views`, `session` — one per
`gg.catalogue.MODULE_ORDER` entry, carrying every function that module declares, whatever this run
enabled and whatever role this agent holds. A withheld function is an ordinary attribute of an
ordinary namespace, and calling it reaches the host.

**The enforcement is the host's, and it always was.** This SDK is an ordinary Python package: a
program can `import gg.files` and reach every function in it, so a surface built from the run could
never have been a gate — it was only ever a *hint*, and a hint that made a withheld call raise
`AttributeError` from Python rather than a refusal from gg. The membrane refuses a call this agent
was not granted, with a `ToolError` naming the capability that is missing and why, and that refusal
is a value a program can catch and act on. Building the surface from the run bought nothing that the
refusal does not buy better, and cost the model the one thing it needed: a sentence.

**The types are the SDK's too.** Every class a capability module exports is bound, because a type is
not a capability: `TurnRange` is what `context.archive_thread` takes, `ToolError` is what every call
raises and `TaskStatus.DONE` is what a status argument is, and a program that could not name them
would have to reach for a string. `UNCHANGED` travels with them for the same reason.

Everything below is therefore built **once, at import**, into the pre-initialised heap
`componentize-py` snapshots, and a turn pays nothing for it.
"""

from __future__ import annotations

from types import ModuleType
from typing import Any

from . import board, context, core, delegation, files, memories, programs
from . import session as session_module
from . import shell, skills, tasks, views
from ._registry import ATTRIBUTE, REGISTRY
from .catalogue import GG_TOOLS, MODULE_ORDER, PACKAGE, TOOL_BOUND

_MODULES: dict[str, ModuleType] = {
    "files": files,
    "shell": shell,
    "board": board,
    "tasks": tasks,
    "memories": memories,
    "views": views,
    "context": context,
    "delegation": delegation,
    "skills": skills,
    "programs": programs,
    "session": session_module,
    "core": core,
}
"""Every capability module, by its gg module id.

Imported unconditionally, and eagerly. The component is baked once, so there is nothing to gain by
importing lazily — and an import `componentize-py` never executed is a module that is not in the
artifact at all. Importing them is also what populates
`gg._registry.REGISTRY`, since a decorator runs when its module does.
"""


class Bound:
    """A namespace gg assembled rather than one declared in a file.

    The two below share it so that `shim.py` can tell a name that is not part of gg's surface at all
    from an ordinary `AttributeError` against anything else. Python raises the same exception for
    both, and the namespace the failure happened on is the only thing that distinguishes them.
    """

    __slots__ = ()


class Surface(Bound):
    """The `gg` name a program starts with: every capability module, under its id.

    It is what makes a fully-qualified name a thing a program can *write*. `gg.files.read_file` is
    the key a documentation view is opened by, the name search returns, and the name gg quotes back
    at a model in a refusal — so it has to resolve in a program's own scope rather than only after an
    `import`, or the one string the model reads everywhere would be the one string it cannot type.

    The modules on it are the same objects the short names are, so `gg.files.read_file` and
    `files.read_file` are one function. The `gg` **package** is importable too and reaches the same
    functions by a third route; that is deliberate and is not a hole, since nothing here is a gate.
    """

    __slots__ = ("_modules",)

    def __init__(self, modules: dict[str, CapabilityModule]) -> None:
        self._modules = modules

    def __getattr__(self, name: str) -> Any:
        try:
            return self._modules[name]
        except KeyError:
            raise AttributeError(
                f"`{PACKAGE}.{name}` is not one of gg's capability modules; "
                f"they are {', '.join(sorted(self._modules))}",
                name=name,
                obj=self,
            ) from None

    def __dir__(self) -> list[str]:
        return sorted(self._modules)

    def __repr__(self) -> str:
        return f"<gg: {', '.join(sorted(self._modules))}>"


class CapabilityModule(Bound):
    """One of the capability modules a program calls gg through: `files`, `board`, `views`, ….

    A plain namespace would have done, and this exists for what it says when a program reaches for a
    function that is **not** on it — which, now that the surface is the whole SDK, means a name gg
    does not have at all rather than one this run withheld. The difference between
    `'types.SimpleNamespace' object has no attribute 'read_fil'` and a sentence naming the module and
    listing what it declares is a turn.

    It is also what lets the shim classify that mistake as the unknown name it is: Python raises
    `AttributeError` where a guest that could withhold a *name* would raise `NameError`, so the
    failure carries the namespace it happened on and `shim.py` reads it back off the exception.

    It is a **view of** the real module rather than a replacement for it: everything on it is the
    function the module declares, so `files.read_file` and `gg.files.read_file` are one object.
    """

    __slots__ = ("_path", "_members")

    def __init__(self, path: str, members: dict[str, Any]) -> None:
        self._path = path
        self._members = members

    def __getattr__(self, name: str) -> Any:
        try:
            return self._members[name]
        except KeyError:
            raise AttributeError(
                f"`{self._path}.{name}` is not one of the functions gg declares there; "
                f"it declares {', '.join(sorted(self._members))}",
                name=name,
                obj=self,
            ) from None

    def __dir__(self) -> list[str]:
        return sorted(self._members)

    def __repr__(self) -> str:
        return f"<gg `{self._path}`: {', '.join(sorted(self._members))}>"


def _build_modules() -> dict[str, CapabilityModule]:
    """Every capability module, carrying every function this SDK declares on it.

    `gg._registry.REGISTRY` is filled by the `@operation` decorators as the modules above are
    imported, so what a module ends up carrying is exactly what its declarations claim — an operation
    named nowhere is simply absent, which is how `bound_tools` reports a tool the artifact does not
    implement rather than binding a name that would fail when it was called.

    A module with no function on it is not built, which today means `core` alone: it declares the
    types every other module's signatures name and nothing a program calls.
    """
    offered: dict[str, dict[str, Any]] = {}
    for operation, function in REGISTRY.items():
        module = operation.split(".", 1)[0]
        offered.setdefault(module, {})[function.__name__] = function
    return {
        module: CapabilityModule(f"{PACKAGE}.{module}", offered[module])
        for module in MODULE_ORDER
        if module in offered
    }


def _type_names() -> dict[str, Any]:
    """Every type this SDK declares, by the name a program writes.

    The set is read off each module's `__all__`, which is Python's own declaration of a module's
    public surface and the same list the reflector catalogues from. A name that is a function is not
    a type and is skipped: those are the capability modules' business, above.
    """
    bound: dict[str, Any] = {}
    for module in _MODULES.values():
        for name in module.__all__:
            declared = getattr(module, name)
            if getattr(declared, ATTRIBUTE, None) is None:
                bound[name] = declared
    return bound


_MODULE_SURFACE: dict[str, CapabilityModule] = _build_modules()
"""The capability modules, built once at import and therefore inside the baked heap."""

_SCOPE: dict[str, Any] = {
    **_type_names(),
    **_MODULE_SURFACE,
    PACKAGE: Surface(_MODULE_SURFACE),
}
"""Every name a program starts with, likewise built once.

Each module is bound twice, under its bare id and on the `gg` surface, and the two are the same
object: `files.read_file` is the short way and `gg.files.read_file` is the fully-qualified name the
documentation is keyed by, so whichever of them a model reads is one it can write.

`lib` is not here: it is bound by the shim, from the code modules the host handed over, and a run
with none has no such name.
"""


def bound_tools() -> list[str]:
    """The gg tool names this component can bind.

    gg calls this export in a unit test and asserts set-equality with its own `ALL_TOOL_NAMES`. It is
    the one drift gate that inspects the **committed artifact** rather than a source file, so it
    catches the failure no compiler can: a tool added, renamed or removed in gg, with a stale `.wasm`
    still checked in.
    """
    # A gg tool is DISPATCHED by the operation that shares its key — `files.write_file` dispatches
    # `write_file`. The other two rows of `TOOL_BOUND` are a helper and a view that a tool merely
    # *buys*, and reporting either as a tool would put a name in this answer that gg's own vocabulary
    # does not hold.
    dispatched = {
        tool
        for operation, tool in TOOL_BOUND.items()
        if operation in REGISTRY and operation.split(".", 1)[1] == tool
    }
    return [tool for tool in GG_TOOLS if tool in dispatched]


def build_scope() -> dict[str, Any]:
    """Every name a program starts with — a fresh mapping over the same objects.

    A copy rather than the shared dict, because `exec` writes a program's own globals into whatever
    it is handed and one turn's leftovers must not become the next turn's scope. The values are
    shared: they are the SDK's modules and types, and there is one of each.
    """
    return dict(_SCOPE)
