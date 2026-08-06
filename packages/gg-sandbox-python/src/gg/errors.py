"""The exception every gg call raises when it fails, and the one place the wire's failure arm
becomes it.

**Why an exception.** WIT models a failure as `result<T, tool-error>`, and a surface that handed
that back as `(ok, value)` would force a branch after every line and make a composed program
unwritable. Python's own answer to "this call can fail" is an exception, so that is what the SDK
raises: the happy path of a program is already unwrapped — `text = fs.read_text_file(p)` is a
string — and a failure stops the program instead of poisoning it with `None`.

**Why a class of our own.** What the generated bindings raise is
`componentize_py_types.Err(wit_world.imports.types.ToolError)`: a generic wrapper whose payload is a
dataclass, whose `str()` says nothing useful, and whose name belongs to the toolchain rather than to
gg. `_call` unwraps it once, at the boundary, into a `ToolError` a program can catch by a name it was
told about and branch on with `ToolErrorCode`.

**Why the validators.** Nothing type-checks a model's program: it is compiled and run, and Python
binds arguments by name and arity only. Python's own `TypeError` already covers the mistakes that
matter most — a missing required argument, a keyword the function does not take — and names the
function while doing it, which is more than a stripped-TypeScript guest gets. What it cannot see is a
value of the right *type* and the wrong *range*: `fs.read_file("a.py", offset=-1)` lowers to a `u32`
by two's-complement wrap and fails for a reason that has nothing to do with what was written.
`_uint`, `_positive` and `_strings` cover exactly that gap and nothing more.
"""

from __future__ import annotations

from typing import Any, Callable, TypeVar

from componentize_py_types import Err
from wit_world.imports import types as wire

from .types import ToolErrorCode

__all__ = ["ToolError"]

T = TypeVar("T")

U32_MAX = 4_294_967_295
"""The `u32` range, so no wrapper inlines the magic number."""


class ToolError(Exception):
    """A gg call that failed.

    Raised by every function on every API object. Catch it where a failure is expected and branch on
    `code`; let it propagate where it is not, and gg reports which call failed and on which line of
    your program. A handler reads `except ToolError as failure:` and then
    `if failure.code is ToolErrorCode.CONFLICT:`.
    """

    tool: str
    """The gg call that failed (`read_file`, `spawn_subagent`, …). It is gg's own name for the
    capability, which is stable across every language a program may be written in."""

    code: ToolErrorCode
    """The failure class, so a handler branches on a value rather than on prose."""

    def __init__(self, tool: str, code: ToolErrorCode, message: str) -> None:
        super().__init__(message)
        self.tool = tool
        self.code = code

    def __str__(self) -> str:
        # The code and the tool travel with the message, because the rendered exception is what a
        # model reads when it does NOT catch one — and `ToolError: not found` without the name of
        # the call or the class of the failure is a sentence it cannot act on.
        return f"{self.tool}: {self.code.value}: {super().__str__()}"


def _call(fn: Callable[..., T], /, *args: Any) -> T:
    """Make one membrane call, turning the wire's failure arm into a `ToolError`.

    `from None` deliberately: the generated `Err` wrapper is an implementation detail of the
    bridge, and a chained "during handling of the above exception" would put a toolchain type in
    front of a model that has never been told one exists.
    """
    try:
        return fn(*args)
    except Err as raised:
        failure = raised.value
        if isinstance(failure, wire.ToolError):
            raise ToolError(
                failure.tool, ToolErrorCode[failure.code.name], failure.message
            ) from None
        raise


def _uint(fn: str, name: str, value: int | None, maximum: int = U32_MAX) -> int | None:
    """A whole number in `[0, maximum]`, or a `ToolError` naming the argument.

    The membrane lowers a negative number by wrapping it — `-1` arrives as `4294967295` — so the
    range check has to happen on this side of it. `bool` is rejected along with everything else
    that is not an `int`: it *is* an `int` in Python, and `limit=True` is a mistake rather than
    a request for one line.
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise ToolError(
            fn,
            ToolErrorCode.INVALID_ARGUMENT,
            f"`{name}` must be a whole number 0..{maximum}, got {value!r}",
        )
    return value


def _positive(fn: str, name: str, value: float | None) -> float | None:
    """A finite positive number, or a `ToolError` naming the argument."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not value > 0:
        raise ToolError(
            fn,
            ToolErrorCode.INVALID_ARGUMENT,
            f"`{name}` must be a positive number of seconds, got {value!r}",
        )
    return float(value)


def _strings(fn: str, name: str, value: object) -> list[str]:
    """A sequence of strings, defaulted to empty, or a `ToolError` naming the argument.

    Every `list<string>` argument goes through this. A bare string is the mistake worth catching by
    hand: it *is* iterable, so `reviewers="alice"` would otherwise lower to five one-character
    reviewers and fail somewhere else entirely.
    """
    if value is None:
        return []
    if isinstance(value, str) or not hasattr(value, "__iter__"):
        raise ToolError(
            fn,
            ToolErrorCode.INVALID_ARGUMENT,
            f"`{name}` must be a list of strings, got {value!r}",
        )
    items = list(value)
    for item in items:
        if not isinstance(item, str):
            raise ToolError(
                fn,
                ToolErrorCode.INVALID_ARGUMENT,
                f"every entry of `{name}` must be a string, got {item!r}",
            )
    return items
