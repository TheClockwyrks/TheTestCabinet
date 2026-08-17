"""The private machinery every capability module shares: the decorator that writes a function's gg
**operation** on the declaration itself, the registry it fills, the answer to the component's
`bound-operations` export, and the sentence a module gives back for a name it does not declare.

An operation is gg's own stable identity for a model-facing call — `files.read_file`,
`views.open_text`, `session.finish` — and it is the join key every one of the eleven language arms
is compared through. Somebody has to say which of this SDK's functions binds which operation, and
there are only two places it can be said: on the declaration, or in a table beside it. A table is a
second place to be wrong, and the failure it produces is invisible — a mistyped row silently drops
one capability out of the model's whole surface while the SDK still compiles, still exports the
function and still documents it to every human who reads the source.

So it is written here, as a decorator, which is Python's own way of attaching a fact to a
declaration. It is the direct analogue of the Rust arm's `#[doc(alias = "ggop:…")]` attribute and
the C# arm's `<ggop>` documentation tag, and it is read twice from the one place it is written:

* statically, by `tools/signatures.py`, out of the source's own decorator list — griffe never
  imports this package, so the reflector reads the written text rather than a run-time attribute;
* dynamically, by `bound_operations` below, out of `REGISTRY`, to answer which gg tools this
  artifact really binds.

Two readings of one written fact is the whole point. Nothing can drift, because there is nothing for
the two to drift apart *from*.

The module is private by Python's own convention — a leading underscore — and the reflector skips it
for exactly that reason. One thing here does reach a model: the sentence `missing` composes when a
program reaches for a name a gg module does not declare.
"""

from __future__ import annotations

import sys
from typing import Callable, Sequence, TypeVar

# At module scope rather than inside `bound_operations`, because `componentize-py` bakes the import
# closure it EXECUTES: an import that only runs when the function is called is a module the artifact
# does not carry, and the export would fail on the one call gg makes to it.
from .catalogue import GG_OPERATIONS, OPERATION_BOUND

F = TypeVar("F", bound=Callable[..., object])

ATTRIBUTE = "__gg_operation__"
"""The attribute the decorator leaves on a function, naming the operation it binds.

Read by `bound_operations` below, and by nothing else. It is a plain attribute rather than a wrapper
so that the decorated object *is* the function: its `__name__`, its signature and its docstring are
untouched, which matters because a program can inspect the functions it was given and because the
reflector reads the same declaration.
"""

REGISTRY: dict[str, Callable[..., object]] = {}
"""Every operation this SDK implements, by its gg operation id.

Populated as the capability modules are imported, which `gg/__init__.py` does unconditionally. It is
what turns "which functions does this SDK implement?" into a lookup on gg's own vocabulary rather
than on this language's spellings.
"""


def operation(id: str) -> Callable[[F], F]:
    """Declare that the function below binds the gg operation `id`.

    Args:
        id: The operation, as gg's own table spells it: `namespace.key`, `files.read_file`.
    """

    def mark(function: F) -> F:
        if id in REGISTRY:
            raise RuntimeError(f"two functions claim the gg operation `{id}`")
        setattr(function, ATTRIBUTE, id)
        REGISTRY[id] = function
        return function

    return mark


ALIAS_ATTRIBUTE = "__gg_alias_of__"
"""The attribute the alias decorator leaves on a method, naming the operation it is a second way to
reach.

Deliberately a *different* attribute from `ATTRIBUTE`, and deliberately absent from `REGISTRY`. An
alias is not a binding: `gg.board.wait_for_issue` is the one function that binds
`board.wait_for_issue`, and `IssueCreated.wait` is a shorter way to write a call to it. Registering
the method too would put a second claim on one operation — which the decorator above refuses
outright — and would make `bound_operations` report a bound method as though it were a tool.

It is read the way `ATTRIBUTE` is read statically — `tools/signatures.py` takes the id off the
written decorator rather than off the object, since griffe never imports this package — and it is
left on the function for the same reason that one is: a fact about a declaration belongs on the
declaration, where a program that inspects what it was given can see it too.
"""


def alias(id: str) -> Callable[[F], F]:
    """Declare that the method below is a second way to reach the gg operation `id`.

    A convenience method on the value an operation's result carries — `hit.read()` for the memory a
    search matched, `view.close()` for a view `current` listed — which calls the module-level
    function and adds nothing to what this arm can do. It inherits the operation's gate for the same
    reason: the call it makes is the gated one, so an agent without the capability meets the same
    refusal by either spelling.

    Args:
        id: The operation this is a second way to reach, as gg's own table spells it.
    """

    def mark(function: F) -> F:
        setattr(function, ALIAS_ATTRIBUTE, id)
        return function

    return mark


def bound_operations() -> list[str]:
    """The gg tool names this component can bind.

    gg calls the component's export in a unit test and asserts set-equality with its own
    `ALL_TOOL_NAMES`. It is the one drift gate that inspects the artifact gg embedded rather than a
    source file, so it catches the failure no compiler can: a tool added, renamed or removed in gg,
    with a stale `.wasm` still checked in.
    """
    # A gg tool is DISPATCHED by the operation that shares its key — `files.write_file` dispatches
    # `write_file`. The other two rows of `OPERATION_BOUND` are a helper and a view that a tool
    # merely *buys*, and reporting either as a tool would put a name in this answer that gg's own
    # vocabulary does not hold.
    dispatched = {
        tool
        for operation, tool in OPERATION_BOUND.items()
        if operation in REGISTRY and operation.split(".", 1)[1] == tool
    }
    return [tool for tool in GG_OPERATIONS if tool in dispatched]


def missing(module: str, declared: Sequence[str]) -> Callable[[str], object]:
    """A module-level `__getattr__` that answers a name this module does not declare.

    Python's own answer is `module 'gg.files' has no attribute 'read_fil'`, which tells a model that
    it was wrong and nothing about what would have been right. This one names the module, the name
    that was reached for and everything the module declares, which is the difference between a turn
    spent searching and a turn spent working.

    It is also what lets `shim.py` classify the mistake as the unknown name it is: the raised
    `AttributeError` carries the module it happened on, and a module inside this package is how a
    misspelled gg call is told apart from an ordinary attribute error anywhere else.

    Args:
        module: The module's own `__name__`.
        declared: The module's own `__all__`.
    """

    def __getattr__(name: str) -> object:
        raise AttributeError(
            f"`{module}.{name}` is not one of the names gg declares there; "
            f"it declares {', '.join(sorted(declared))}",
            name=name,
            obj=sys.modules[module],
        )

    return __getattr__
