"""The decorator that writes a function's gg **operation** on the declaration itself.

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
* dynamically, by `gg.scope`, out of `REGISTRY`, to decide which functions a run's program is given.

Two readings of one written fact is the whole point. Nothing can drift, because there is nothing for
the two to drift apart *from*.

Nothing here is model-facing. The module is private by Python's own convention — a leading
underscore — and the reflector skips it for exactly that reason.
"""

from __future__ import annotations

from typing import Callable, TypeVar

F = TypeVar("F", bound=Callable[..., object])

ATTRIBUTE = "__gg_operation__"
"""The attribute the decorator leaves on a function, naming the operation it binds.

Read by `gg.scope` when it builds a program's surface, and by nothing else. It is a plain attribute
rather than a wrapper so that the decorated object *is* the function: its `__name__`, its signature
and its docstring are untouched, which matters because a program can inspect the functions it was
given and because the reflector reads the same declaration.
"""

REGISTRY: dict[str, Callable[..., object]] = {}
"""Every operation this SDK implements, by its gg operation id.

Populated as the capability modules are imported, which `gg.scope` does unconditionally. It is what
turns "which functions does this run offer?" into a lookup on gg's own vocabulary rather than on
this language's spellings.
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
outright — and would make `gg.scope` bind a bound method as though it were a module-level function.

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
