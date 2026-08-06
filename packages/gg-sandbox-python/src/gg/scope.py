"""The names a program is given: the API objects, and the types they speak in.

Two things are built here, and the difference between them is the whole of gg's capability model as
this guest sees it.

**The API objects are built from the run.** `fs`, `project`, `view`, `harness` — one per
`gg.catalogue.OBJECT_FOR_MODULE` namespace with at least one function this run offers, each carrying
the functions it offers and the `list()` directory every object has. A tool the run withheld is not
an attribute, so `<object>.list()` is the honest directory of what is really available and a model is
never shown a call it cannot make.

**It is not the enforcement.** That is the difference from a guest that could hide a name and be done
with it: this SDK is an ordinary Python package, a program can `import gg` and reach every function
in it, and gg is built for that — the **host** refuses a call outside the run's enabled set,
whichever name the program used to make it. What is built here is the *surface*, and the surface is
what a model reads.

**The types are built from the SDK.** Every declaration `gg.catalogue.TYPE_ORDER` names is bound
unconditionally, because a type is not a capability: `TurnRange` is what `context.archive_thread`
takes, `ToolError` is what every call raises and `TaskStatus.DONE` is what a status argument is, and
a program that could not name them would have to reach for a string. They cost nothing and gate
nothing, so they do not vary per run — what varies is which of them a prompt bothers to declare.
"""

from __future__ import annotations

from types import ModuleType
from typing import Any

from wit_world.imports import session as wire_session

from . import errors, helpers, session, types
from .catalogue import (
    HELPER_CATALOGUE,
    META_ENTRIES,
    OBJECT_FOR_MODULE,
    PROGRAM_ENTRIES,
    PROGRAM_MODULE,
    SESSION_ENTRIES,
    TOOL_CATALOGUE,
    TYPE_ORDER,
    VIEW_ENTRIES,
    VIEW_MODULE,
)
from .tools import board, context, delegation, docs, files, memories, programs, shell, skills, tasks
from .tools import views

_MODULES: dict[str, ModuleType] = {
    "shell": shell,
    "files": files,
    "skills": skills,
    "memories": memories,
    "tasks": tasks,
    "board": board,
    "context": context,
    "delegation": delegation,
    "views": views,
    "programs": programs,
}
"""The SDK modules, keyed by the `module` field of `gg.catalogue.TOOL_CATALOGUE` — plus `views` and
`programs`, whose functions are catalogued separately because none of them is a gg tool.

Every module is imported unconditionally. The component is baked once, so there is nothing to gain by
importing lazily — and an import `componentize-py` never executed is a module that is not in the
artifact at all.
"""


class ApiObject:
    """One of the API objects a program calls gg through: `fs`, `project`, `view`, `harness`, ….

    A plain namespace would have done, and this exists for what it says when a program reaches for a
    function that is **not** on it. `fs.read_file` in a run with reading withheld is the single most
    likely mistake a model makes against this surface, and the difference between
    `'types.SimpleNamespace' object has no attribute 'read_file'` and a sentence naming the object and
    pointing at its directory is a turn.

    It is also what lets the shim classify that mistake correctly. Python raises `AttributeError`
    where a guest that could withhold a *name* would raise `NameError`, and the two mean the same
    thing here — a capability this run does not offer — so the failure carries the object it happened
    on and `shim.py` reads it back off the exception.
    """

    __slots__ = ("_object", "_members")

    def __init__(self, object: str, members: dict[str, Any]) -> None:
        self._object = object
        self._members = members

    def __getattr__(self, name: str) -> Any:
        try:
            return self._members[name]
        except KeyError:
            raise AttributeError(
                f"`{self._object}.{name}` is not one of the functions this run offers; "
                f"`{self._object}.list()` shows the ones it does",
                name=name,
                obj=self,
            ) from None

    def __dir__(self) -> list[str]:
        return sorted(self._members)

    def __repr__(self) -> str:
        return f"<gg `{self._object}`: {', '.join(sorted(self._members))}>"


def _exported(module: ModuleType, name: str) -> Any | None:
    """The function `name` in `module`, or `None` when the module does not define one.

    A catalogue entry naming something the module does not export is then a missing name in
    `bound_tools` — which gg compares against its own vocabulary — rather than a `None` a program
    would discover by calling it.
    """
    candidate = getattr(module, name, None)
    return candidate if callable(candidate) else None


def bound_tools() -> list[str]:
    """The gg tool names this component can bind.

    gg calls this export in a unit test and asserts set-equality with its own `ALL_TOOL_NAMES`. It is
    the one drift gate that inspects the **committed artifact** rather than a source file, so it
    catches the failure no compiler can: a tool added, renamed or removed in gg, with a stale `.wasm`
    still checked in.
    """
    return [
        entry.tool
        for entry in TOOL_CATALOGUE
        if _exported(_MODULES[entry.module], entry.python) is not None
    ]


def build_objects(
    enabled: list[str], ending: wire_session.EndingKind, library: bool
) -> dict[str, ApiObject]:
    """The API objects a program is given, each carrying the functions this run offers on it.

    An object with nothing on it is not built at all, so a run with no board tools has no `project`
    name rather than an empty one.

    Args:
        enabled: The run's enabled gg tool names.
        ending: The role whose ending group this program is given; `NONE` binds no ending at all,
            which is what an on-use script runs under.
        library: Whether this agent keeps a program library, which is what binds the whole `programs`
            object.
    """
    on = set(enabled)
    objects: dict[str, dict[str, Any]] = {}

    def object_for(name: str) -> dict[str, Any]:
        """Fetch (creating on first use) one object, seeded with the directory every object shares."""
        members = objects.get(name)
        if members is None:
            members = {entry.python: docs.bind_list(name) for entry in META_ENTRIES}
            objects[name] = members
        return members

    for entry in TOOL_CATALOGUE:
        if entry.tool not in on:
            continue
        function = _exported(_MODULES[entry.module], entry.python)
        if function is not None:
            object_for(OBJECT_FOR_MODULE[entry.module])[entry.python] = function

    # A helper lives on the object of the tool it is built on, and is bound exactly when that tool is.
    for helper in HELPER_CATALOGUE:
        if helper.requires not in on:
            continue
        required = next(entry for entry in TOOL_CATALOGUE if entry.tool == helper.requires)
        function = _exported(helpers, helper.python)
        if function is not None:
            object_for(OBJECT_FOR_MODULE[required.module])[helper.python] = function

    # `view`: always present, on the same carve-out `harness` has — a run that enables no tools at all
    # must still be able to show its model something, and a view is the only channel that reaches it.
    # `open_file` is the one exception: it is a read, so it is offered exactly when `read_file` is.
    view = object_for(OBJECT_FOR_MODULE[VIEW_MODULE])
    for entry in VIEW_ENTRIES:
        if entry.requires is not None and entry.requires not in on:
            continue
        function = _exported(views, entry.python)
        if function is not None:
            view[entry.python] = function

    # `programs`: the whole object, or no object at all. It is the one family a *capability* gates
    # rather than a tool or a role, so the host says so with a flag instead of a name in `enabled`.
    if library:
        library_object = object_for(OBJECT_FOR_MODULE[PROGRAM_MODULE])
        for entry in PROGRAM_ENTRIES:
            function = _exported(programs, entry.python)
            if function is not None:
                library_object[entry.python] = function

    # The one ending group this role produces: what is not this role's ending is not a name.
    for entry in SESSION_ENTRIES:
        if entry.ending != ending.name.lower():
            continue
        function = _exported(session, entry.python)
        if function is not None:
            object_for(entry.object)[entry.python] = function

    return {name: ApiObject(name, members) for name, members in objects.items()}


def type_names() -> dict[str, Any]:
    """Every type this SDK declares, by the name a program writes.

    Bound whatever a run enables, because none of them reaches the host: they are the vocabulary the
    API objects speak in, and a program that could not write `TurnRange(4, 19)` or catch `ToolError`
    would be reading signatures it cannot act on. `UNCHANGED` travels with them for the same reason —
    it is the value a patch argument defaults to, and a program that spells one out has to name it.
    """
    bound: dict[str, Any] = {}
    for name in TYPE_ORDER:
        declared = getattr(types, name, None)
        bound[name] = getattr(errors, name) if declared is None else declared
    bound["UNCHANGED"] = types.UNCHANGED
    return bound


def build_scope(
    enabled: list[str], ending: wire_session.EndingKind, library: bool
) -> dict[str, Any]:
    """Every name a program starts with: the API objects this run offers, and the SDK's types.

    `lib` is not here: it is bound by the shim, from the code modules the host handed over, and a run
    with none has no such name.

    Args:
        enabled: The run's enabled gg tool names.
        ending: The role whose ending group this program is given.
        library: Whether this agent keeps a program library.
    """
    scope: dict[str, Any] = type_names()
    scope.update(build_objects(enabled, ending, library))
    return scope
