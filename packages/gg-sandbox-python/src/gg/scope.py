"""The names a program is given: the capability modules, and the types they speak in.

Two things are built here, and the difference between them is the whole of gg's capability model as
this guest sees it.

**The modules are built from the run.** `files`, `board`, `views`, `session` — one per
`gg.catalogue.MODULE_ORDER` entry with at least one function this run offers, each carrying the
functions it offers and the `list` directory every module has. A withheld function is not an
attribute, so `<module>.list()` is the honest directory of what is really available and a model is
never shown a call it cannot make.

**It is not the enforcement.** That is the difference from a guest that could hide a name and be done
with it: this SDK is an ordinary Python package, a program can `import gg.files` and reach every
function in it, and gg is built for that — the **host** refuses a call outside the run's enabled set,
whichever name the program used to make it. What is built here is the *surface*, and the surface is
what a model reads.

**The types are built from the SDK.** Every class a capability module exports is bound
unconditionally, because a type is not a capability: `TurnRange` is what `context.archive_thread`
takes, `ToolError` is what every call raises and `TaskStatus.DONE` is what a status argument is, and
a program that could not name them would have to reach for a string. They cost nothing and gate
nothing, so they do not vary per run — what varies is which of them a prompt bothers to declare.
"""

from __future__ import annotations

from types import ModuleType
from typing import Any

from wit_world.imports import session as wire_session

from . import board, context, core, delegation, docs, files, memories, programs
from . import session as session_module
from . import shell, skills, tasks, views
from ._registry import ATTRIBUTE, REGISTRY
from .catalogue import (
    ALWAYS_BOUND,
    ENDING_BOUND,
    GG_TOOLS,
    LIBRARY_BOUND,
    MODULE_ORDER,
    PACKAGE,
    TOOL_BOUND,
)

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
    """A namespace built from the run rather than declared in a file.

    The two below share it so that `shim.py` can tell the mistake they exist to report — reaching for
    a capability this run does not offer — from an ordinary `AttributeError` against anything else.
    Python raises the same exception for both, and the namespace the failure happened on is the only
    thing that distinguishes them.
    """

    __slots__ = ()


class Surface(Bound):
    """The `gg` name a program starts with: every capability module this run offers, under its id.

    It is what makes a fully-qualified name a thing a program can *write*. `gg.files.read_file` is
    the key a documentation view is opened by, the name search returns, and the name gg quotes back
    at a model in a refusal — so it has to resolve in a program's own scope rather than only after an
    `import`, or the one string the model reads everywhere would be the one string it cannot type.

    The modules on it are the same objects the short names are, so `gg.files.read_file` and
    `files.read_file` are one function under one gate. The `gg` **package** is importable too, and
    reaches past this to every function the SDK declares; that is deliberate and is not a hole, since
    the host refuses a withheld call whichever name reached it.
    """

    __slots__ = ("_modules",)

    def __init__(self, modules: dict[str, CapabilityModule]) -> None:
        self._modules = modules

    def __getattr__(self, name: str) -> Any:
        try:
            return self._modules[name]
        except KeyError:
            raise AttributeError(
                f"`{PACKAGE}.{name}` is not one of the capability modules this run offers; "
                f"it offers {', '.join(sorted(self._modules))}",
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
    function that is **not** on it. `files.read_file` in a run with reading withheld is the single
    most likely mistake a model makes against this surface, and the difference between
    `'types.SimpleNamespace' object has no attribute 'read_file'` and a sentence naming the module
    and pointing at its directory is a turn.

    It is also what lets the shim classify that mistake correctly. Python raises `AttributeError`
    where a guest that could withhold a *name* would raise `NameError`, and the two mean the same
    thing here — a capability this run does not offer — so the failure carries the module it happened
    on and `shim.py` reads it back off the exception.

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
                f"`{self._path}.{name}` is not one of the functions this run offers; "
                f"`{self._path}.list()` shows the ones it does",
                name=name,
                obj=self,
            ) from None

    def __dir__(self) -> list[str]:
        return sorted(self._members)

    def __repr__(self) -> str:
        return f"<gg `{self._path}`: {', '.join(sorted(self._members))}>"


def _implemented() -> dict[str, Any]:
    """Every operation this SDK really implements, by its gg operation id.

    `gg._registry.REGISTRY` is filled by the `@operation` decorators as the modules above are
    imported, so an operation named in `gg.catalogue` that no declaration claims is simply absent
    here — which is how `bound_tools` reports a tool the artifact does not implement rather than
    binding a name that would fail when it was called.
    """
    return dict(REGISTRY)


def bound_tools() -> list[str]:
    """The gg tool names this component can bind.

    gg calls this export in a unit test and asserts set-equality with its own `ALL_TOOL_NAMES`. It is
    the one drift gate that inspects the **committed artifact** rather than a source file, so it
    catches the failure no compiler can: a tool added, renamed or removed in gg, with a stale `.wasm`
    still checked in.
    """
    implemented = _implemented()
    # A gg tool is DISPATCHED by the operation that shares its key — `files.write_file` dispatches
    # `write_file`. The other two rows of `TOOL_BOUND` are a helper and a view that a tool merely
    # *buys*, and reporting either as a tool would put a name in this answer that gg's own vocabulary
    # does not hold.
    dispatched = {
        tool
        for operation, tool in TOOL_BOUND.items()
        if operation in implemented and operation.split(".", 1)[1] == tool
    }
    return [tool for tool in GG_TOOLS if tool in dispatched]


def build_modules(
    enabled: list[str], ending: wire_session.EndingKind, library: bool
) -> dict[str, CapabilityModule]:
    """The capability modules a program is given, each carrying the functions this run offers.

    A module with nothing on it is not built at all, so a run with no board tools has no `board` name
    rather than an empty one.

    Args:
        enabled: The run's enabled gg tool names.
        ending: The role whose ending group this program is given; `NONE` binds no ending at all,
            which is what an on-use script runs under.
        library: Whether this agent keeps a program library, which is what buys the whole `programs`
            module.
    """
    on = set(enabled)
    role = ending.name.lower()
    implemented = _implemented()
    offered: dict[str, dict[str, Any]] = {}

    def offer(operation: str, function: Any) -> None:
        module = operation.split(".", 1)[0]
        members = offered.get(module)
        if members is None:
            # Seeded with the directory every module carries, so a module a run offers is always a
            # module whose contents a program can ask for.
            members = {"list": docs.bind_list(f"{PACKAGE}.{module}")}
            offered[module] = members
        members[function.__name__] = function

    for operation, function in implemented.items():
        tool = TOOL_BOUND.get(operation)
        if tool is not None:
            bought = tool in on
        elif operation in ALWAYS_BOUND:
            bought = True
        elif operation in LIBRARY_BOUND:
            bought = library
        else:
            bought = ENDING_BOUND.get(operation) == role
        if bought:
            offer(operation, function)

    return {
        module: CapabilityModule(f"{PACKAGE}.{module}", offered[module])
        for module in MODULE_ORDER
        if module in offered
    }


def type_names() -> dict[str, Any]:
    """Every type this SDK declares, by the name a program writes.

    Bound whatever a run enables, because none of them reaches the host: they are the vocabulary the
    capability modules speak in, and a program that could not write `TurnRange(4, 19)` or catch
    `ToolError` would be reading signatures it cannot act on. `UNCHANGED` travels with them for the
    same reason — it is the value a patch argument defaults to, and a program that spells one out has
    to name it.

    The set is read off each module's `__all__`, which is Python's own declaration of a module's
    public surface and the same list the reflector catalogues from. A name that is a function is not
    a type and is skipped: functions are bound per run, above.
    """
    bound: dict[str, Any] = {}
    for module in _MODULES.values():
        for name in module.__all__:
            declared = getattr(module, name)
            if getattr(declared, ATTRIBUTE, None) is None:
                bound[name] = declared
    return bound


def build_scope(
    enabled: list[str], ending: wire_session.EndingKind, library: bool
) -> dict[str, Any]:
    """Every name a program starts with: the modules this run offers, and the SDK's types.

    Each module is bound twice, under its bare id and on the `gg` surface, and the two are the same
    object: `files.read_file` is the short way and `gg.files.read_file` is the fully-qualified name
    the documentation is keyed by, so whichever of them a model reads is one it can write.

    `lib` is not here: it is bound by the shim, from the code modules the host handed over, and a run
    with none has no such name.

    Args:
        enabled: The run's enabled gg tool names.
        ending: The role whose ending group this program is given.
        library: Whether this agent keeps a program library.
    """
    modules = build_modules(enabled, ending, library)
    scope: dict[str, Any] = type_names()
    scope.update(modules)
    scope[PACKAGE] = Surface(modules)
    return scope
