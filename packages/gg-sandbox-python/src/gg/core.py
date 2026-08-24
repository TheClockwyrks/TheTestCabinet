"""The types every other module's signatures name: how a call fails, and what a patch leaves alone.

A capability module owns the types it produces, so `FileRead` belongs to `gg.files` and
`IssueCreated` to `gg.board`. The three here belong to none of them because they belong to all of
them: every function in this SDK raises `ApiError`, and `UNCHANGED` is the default of every patch
argument that can also be cleared.

They are written the way every other name in this package is written: `import gg` and then
`gg.core.ApiError`, which is the same path the documentation files them under.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, TypeVar

from componentize_py_types import Err
from wit_world.imports import types as wire

from ._registry import missing

__all__ = ["UNCHANGED", "ApiError", "ApiErrorCode", "Unchanged"]

T = TypeVar("T")

U32_MAX = 4_294_967_295
"""The `u32` range, so no wrapper below inlines the magic number."""


class ApiErrorCode(Enum):
    """Why a gg call failed — the `code` a handler branches on rather than the message it reads."""

    INVALID_ARGUMENT = "invalid-argument"
    """The arguments were malformed, ill-typed, or out of range.

    It covers a path that is absolute or climbs out of the workspace, and an agent name this run does
    not declare.
    """

    NOT_FOUND = "not-found"
    """The named thing does not exist.

    A file, a skill, a memory, a task, an epic, an issue, a subagent, a stored program, or a
    documentation entry.
    """

    CONFLICT = "conflict"
    """Well-formed, but in conflict with the current state.

    An ambiguous edit, a dependency cycle, a duplicate id, a subagent that has already returned.
    """

    REFUSED = "refused"
    """gg refused the call on a rule about the session's state.

    A compaction in flight that this call is not the one it asked for, a memory call while memories
    are read-only, a second ending or hand-over in a turn that already declared one, or a hook that
    blocked it. A ceiling that was reached is `LIMIT_EXCEEDED` rather than this.
    """

    UNAVAILABLE = "unavailable"
    """The call exists and this run's capability set does not offer it.

    A withheld call is refused by gg rather than hidden, so this is what reaching for one raises.
    """

    LIMIT_EXCEEDED = "limit-exceeded"
    """A gg-side ceiling was reached.

    A shell timeout, a store cap, the delegation depth cap, one of the view caps a program spends, or
    the run's wall-clock budget.
    """

    IO_ERROR = "io-error"
    """The underlying input, output or process failed."""

    OTHER = "other"
    """The failure was not classified.

    Reserved for outcomes raised outside an operation's implementation; no call in this SDK produces
    it.
    """


class ApiError(Exception):
    """A gg call that failed.

    WIT models a failure as `result<T, api-error>`, and a surface that handed that back as a pair
    would force a branch after every line. Python's own answer is an exception, so that is what this
    SDK raises: the happy path is already unwrapped, and a failure that nobody expected ends the
    program with gg told which call failed and on which line.

    A failure that is expected is an ordinary `except` on `code`:

    ```python
    import gg

    try:
        gg.views.open_text("build log", log)
    except gg.core.ApiError as failure:
        if failure.code is not gg.core.ApiErrorCode.LIMIT_EXCEEDED:
            raise
        gg.views.open_text("build log (tail)", log[-40_000:])
    ```
    """

    operation: str
    """The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).

    It is gg's name for the capability rather than this SDK's spelling of it, so it is the same word
    in every language a program may be written in.
    """

    code: ApiErrorCode
    """The failure class, so a handler branches on a value rather than on prose."""

    def __init__(self, operation: str, code: ApiErrorCode, message: str) -> None:
        super().__init__(message)
        self.operation = operation
        self.code = code

    def __str__(self) -> str:
        # The code and the operation travel with the message, because the rendered exception is what
        # a model reads when it does NOT catch one — and `ApiError: not found` without the name of
        # the call or the class of the failure is a sentence it cannot act on.
        return f"{self.operation}: {self.code.value}: {super().__str__()}"


class Unchanged(Enum):
    """The value that leaves a patch field exactly as it is.

    A field a patch may also *clear* has three states rather than two, and Python already spells
    "absent" as `None` — which here is the request to clear it. So the third state gets a name of its
    own: leave the argument out (or pass `UNCHANGED`) to keep what is there, pass `None` to empty it,
    pass a value to replace it. A field with no clear state is an ordinary `X | None = None`, where
    `None` simply means it is not being changed.
    """

    UNCHANGED = "unchanged"
    """The only member; `UNCHANGED` is the name a program writes."""


UNCHANGED = Unchanged.UNCHANGED
"""The default of every patch argument that can also be cleared."""


def _call(fn: Callable[..., T], /, *args: Any) -> T:
    """Make one membrane call, turning the wire's failure arm into an `ApiError`.

    `from None` deliberately: the generated `Err` wrapper is an implementation detail of the bridge,
    and a chained "during handling of the above exception" would put a toolchain type in front of a
    model that has never been told one exists.
    """
    try:
        return fn(*args)
    except Err as raised:
        failure = raised.value
        if isinstance(failure, wire.ApiError):
            raise ApiError(
                failure.operation, ApiErrorCode[failure.code.name], failure.message
            ) from None
        raise


def _uint(fn: str, name: str, value: int | None, maximum: int = U32_MAX) -> int | None:
    """A whole number in `[0, maximum]`, or an `ApiError` naming the argument.

    The membrane lowers a negative number by wrapping it — `-1` arrives as `4294967295` — so the
    range check has to happen on this side of it. `bool` is rejected along with everything else that
    is not an `int`: it *is* an `int` in Python, and `limit=True` is a mistake rather than a request
    for one line.
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise ApiError(
            fn,
            ApiErrorCode.INVALID_ARGUMENT,
            f"`{name}` must be a whole number 0..{maximum}, got {value!r}",
        )
    return value


def _positive(fn: str, name: str, value: float | None) -> float | None:
    """A finite positive number, or an `ApiError` naming the argument."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not value > 0:
        raise ApiError(
            fn,
            ApiErrorCode.INVALID_ARGUMENT,
            f"`{name}` must be a positive number of seconds, got {value!r}",
        )
    return float(value)


def _strings(fn: str, name: str, value: object) -> list[str]:
    """A sequence of strings, defaulted to empty, or an `ApiError` naming the argument.

    Every `list<string>` argument goes through this. A bare string is the mistake worth catching by
    hand: it *is* iterable, so `reviewers="alice"` would otherwise lower to five one-character
    reviewers and fail somewhere else entirely.
    """
    if value is None:
        return []
    if isinstance(value, str) or not hasattr(value, "__iter__"):
        raise ApiError(
            fn,
            ApiErrorCode.INVALID_ARGUMENT,
            f"`{name}` must be a list of strings, got {value!r}",
        )
    items = [*value]
    for item in items:
        if not isinstance(item, str):
            raise ApiError(
                fn,
                ApiErrorCode.INVALID_ARGUMENT,
                f"every entry of `{name}` must be a string, got {item!r}",
            )
    return items


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
