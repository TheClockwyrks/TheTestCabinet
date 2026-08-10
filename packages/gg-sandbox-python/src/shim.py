"""The interpreter shim: the Python component's entry point, and the only module
``componentize-py`` is pointed at.

gg bakes **one** component per program language and reuses it for every program of every run.
That is the whole latency design: compiling this artifact costs a few seconds and happens once per
process, after which a turn pays only an instantiate (~17-22 ms, dominated by CPython's own memory
image) and an invoke (~2.6 ms). So the component cannot be specialised to a run — it receives the
run's Python as a *string* and the run's enabled tool names as a *list*, and does the specialising
itself, here, at the start of :func:`WitWorld.run`.

Why this file exists as its own guest, rather than compiling Python to something an existing guest
already evaluates: CPython is *inside* the component. ``componentize-py`` links a real CPython
against gg's WIT world, so a program crosses the membrane as source and there is nothing to install
in the run container and no compiler on the turn path. What a Python program can reach is therefore
exactly what CPython plus WASI can reach, which is what makes this arm the peer of the JavaScript
one rather than a translation of it.

What this shim does, and what each part is load-bearing for
-----------------------------------------------------------

1. **``print`` is rebound** to ``feedback.log``. gg's telemetry stream *is* the host process's
   stdout (newline-delimited JSON), so the host builds its WASI context **without** stdout and a
   guest write to fd 1 goes nowhere. Without the rebinding a program's ``print`` would be silently
   discarded, which is the worst of the three possible answers.
2. **The interpreter's own landmine is defused** (:func:`_clamp_recursion`). A program that raises
   ``sys.setrecursionlimit`` past what the wasm stack can hold kills the *store* while CPython is
   unwinding the traceback of a ``RecursionError`` it already caught — so ``except`` gives no
   protection and the turn dies as an opaque trap. The limit is clamped instead, and the program
   gets an ordinary catchable ``RecursionError``.
3. **The scope is built from the run** (:func:`gg.scope.build_scope`): the capability modules this
   run offers, and the types they speak in. It is the *surface* rather than the enforcement — the
   host refuses a withheld call however a program reached it — but a name a model can see is a name
   it will use, so a module carries exactly the functions the run enables.
4. **The agent's code modules are evaluated first** (:func:`_load_modules`), each into its own
   namespace bound at ``lib.<name>``. A module that throws is reported and left empty rather than
   taking the program down with it: a broken skill belongs to whoever authored it.
5. **Everything the program has to say is said through ``feedback``**, never through a trap and
   never through a return value. An uncaught exception is caught once, classified, rendered with a
   traceback containing only the program's own frames, and reported at the program's own
   coordinates.

What it deliberately does not do is carry a program's value anywhere. A Python module has no
return value to discard, so — unlike the JavaScript guest — there is nothing here that calls
``feedback.note_return``: the only ways a program shows itself something are a view and ``print``.
"""

import io
import linecache
import sys
import traceback
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import wit_world
from wit_world import CodeModule
from wit_world.imports import feedback, session
from wit_world.imports import types as wit_types

from componentize_py_types import Err

# The SDK: the typed, namespaced surface a program calls gg through, and the only thing here that
# reaches the rest of the membrane. Importing it is also what BAKES the rest of the membrane in —
# `componentize-py` bundles only the modules the entry module's import closure reached, so an
# interface nothing imports is a binding a program could not reach even though the component
# declares the import, and every one of `gg`'s tool modules imports the interface it wraps. See
# `library` for the same mechanism applied to the standard library, and for why what a program can
# import is a bake-time fact rather than a policy.
from gg import scope as gg_scope
from gg.core import ToolError

# Every library a program may reach for, likewise imported for its side effect. Its own docstring is
# the authority on what the Python arm offers and what it deliberately does not.
import library  # noqa: F401

#: The file name a program is compiled under, and therefore the one its tracebacks and its reported
#: :attr:`location` are stated in. Fixed and unqualified so that what a model reads back names the
#: thing it wrote — "line 5 of program.py" — rather than a path inside a component.
PROGRAM_FILENAME = "program.py"

#: The deepest Python call stack a program may ask for.
#:
#: CPython's own default is 1000 and the wasm stack this component runs on does not have room for
#: much more: a program that raises the limit and then recurses past what the stack can hold takes
#: the **store** down inside ``tb_dealloc`` while CPython unwinds the traceback of a
#: ``RecursionError`` the program already caught — an unrecoverable trap produced by a *handled*
#: exception, which no ``except BaseException`` can protect against. Clamping is what turns that
#: into the ordinary catchable error a model can act on. See :func:`_clamp_recursion`.
RECURSION_CEILING = 1000

#: How many characters of a rendered traceback are reported. A recursive program produces thousands
#: of identical frames, and the model needs the shape of the failure rather than every repetition of
#: it; the host's own feedback caps are not a reason to send a megabyte across the membrane first.
MESSAGE_LIMIT = 8000


class _FeedbackStream(io.TextIOBase):
    """A text stream that turns whole lines into :func:`feedback.log` calls.

    ``print`` writes its argument and its terminator as separate calls, and a program may write a
    partial line and never finish it, so the stream buffers until it sees a newline and
    :meth:`flush` emits whatever is left. One log call per line — not per write — is what makes a
    program's output read the same way its author wrote it.
    """

    def __init__(self) -> None:
        self._pending = ""

    def writable(self) -> bool:
        return True

    def write(self, text: str) -> int:
        self._pending += text
        while "\n" in self._pending:
            line, self._pending = self._pending.split("\n", 1)
            feedback.log(line)
        return len(text)

    def flush(self) -> None:
        if self._pending:
            feedback.log(self._pending)
            self._pending = ""


def _clamp_recursion() -> None:
    """Hold ``sys.setrecursionlimit`` at :data:`RECURSION_CEILING`, whatever a program asks for.

    Shadowing the function rather than only setting the limit, because the failure it prevents is
    one a program causes *later*: ``sys.setrecursionlimit(20000)`` is a thing models write when they
    hit a ``RecursionError``, and it is exactly the input that turns a caught error into a dead
    store. The clamp is silent — the call succeeds and the limit simply does not go past the
    ceiling — because raising here would fail a program for asking a reasonable question.

    Not airtight, and not claimed to be: the limit is also settable through the C API, which nothing
    reachable from a wasm guest exposes today. What this closes is the reachable path.
    """
    real = sys.setrecursionlimit

    def clamped(limit: int) -> None:
        real(min(int(limit), RECURSION_CEILING))

    real(RECURSION_CEILING)
    sys.setrecursionlimit = clamped  # type: ignore[assignment]


def _register_source(filename: str, source: str) -> None:
    """Make ``source`` visible to :mod:`traceback` under ``filename``.

    Code compiled from a string has no file behind it, so a traceback would name a line and be
    unable to show it. Seeding :mod:`linecache` is what lets a reported failure quote the program's
    own line back at the model — the thing Python's tracebacks are good at, and the reason this arm
    reports one at all.
    """
    lines = source.splitlines(keepends=True)
    linecache.cache[filename] = (len(source), None, lines, filename)


def _owned(frame: traceback.FrameSummary, filenames: frozenset) -> bool:
    """Whether a traceback frame belongs to the program or one of its modules, rather than to this
    shim or to CPython's own machinery."""
    return frame.filename in filenames


def _render(exc: BaseException, filenames: frozenset) -> str:
    """Render ``exc`` the way a model should read it: the program's own frames, then the exception.

    The shim's frames are dropped rather than shown. A model reading ``File "shim.py", in run``
    learns something about gg and nothing about its own program, and the frame it needs is the one
    underneath.
    """
    stack = [
        frame
        for frame in traceback.extract_tb(exc.__traceback__)
        if _owned(frame, filenames)
    ]
    parts: List[str] = []
    if stack:
        parts.append("Traceback (most recent call last):\n")
        parts.extend(traceback.StackSummary.from_list(stack).format())
    parts.extend(traceback.format_exception_only(type(exc), exc))
    rendered = "".join(parts).rstrip()
    if len(rendered) > MESSAGE_LIMIT:
        rendered = rendered[:MESSAGE_LIMIT] + "\n… truncated"
    return rendered


def _locate(exc: BaseException, filenames: frozenset) -> Optional[str]:
    """Where in the *program* ``exc`` happened, in gg's ``line 5, column 12`` vocabulary.

    The **innermost** owned frame, so a program whose helper raised is located at the raising line
    rather than at the call. ``None`` when nothing the program wrote is on the stack, which is what
    an exception raised entirely inside the standard library looks like.
    """
    if isinstance(exc, SyntaxError) and exc.lineno:
        # A syntax error never ran, so it has no traceback at all; the exception carries its own
        # coordinates instead, and its column is already 1-based.
        column = f", column {exc.offset}" if exc.offset else ""
        return f"line {exc.lineno}{column}"
    innermost = None
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename in filenames:
            innermost = tb
        tb = tb.tb_next
    if innermost is None:
        return None
    positions = _column_of(innermost)
    return f"line {innermost.tb_lineno}{positions}"


def _column_of(tb: Any) -> str:
    """The ``, column N`` half of a location, from the instruction the frame stopped at.

    CPython records a column range per instruction, which is what makes its error messages point at
    the failing sub-expression rather than at the line. It is best effort: an interpreter that
    stopped carrying positions, or an instruction with none, yields the line alone.
    """
    try:
        positions = list(tb.tb_frame.f_code.co_positions())
        _line, _end_line, column, _end_column = positions[tb.tb_lasti // 2]
    except (AttributeError, IndexError, TypeError, ValueError):
        return ""
    if column is None:
        return ""
    return f", column {column + 1}"


def _classify(exc: BaseException, filenames: frozenset) -> feedback.ProgramError:
    """Turn a thrown exception into the record gg branches on.

    Three classes, and the middle one is why the enum exists: a failed **call** carries the wire's
    own :class:`ErrorCode`, so the host classifies the turn from a value rather than from prose. A
    ``NameError`` is reported as :attr:`UNKNOWN_NAME` because that is what a model reaching for a
    capability this run does not offer produces in a guest that withholds the name.

    A failed call arrives in **two** shapes and both are that middle class. The SDK raises its own
    :class:`gg.core.ToolError`, which is what a program sees; a program that reached past the SDK
    into ``wit_world`` gets the generated ``Err`` wrapper. Reading only the first would classify the
    second as an ordinary exception and lose the code the host branches on.
    """
    if isinstance(exc, ToolError):
        return feedback.ProgramError(
            kind=feedback.ErrorKind.TOOL_FAILURE,
            code=wit_types.ErrorCode[exc.code.name],
            message=str(exc.args[0]) if exc.args else str(exc),
            location=_locate(exc, filenames),
        )
    if isinstance(exc, Err) and isinstance(exc.value, wit_types.ToolError):
        failure = exc.value
        return feedback.ProgramError(
            kind=feedback.ErrorKind.TOOL_FAILURE,
            code=failure.code,
            message=failure.message,
            location=_locate(exc, filenames),
        )
    kind = (
        feedback.ErrorKind.UNKNOWN_NAME
        if isinstance(exc, NameError) or _missing_capability(exc)
        else feedback.ErrorKind.OTHER
    )
    return feedback.ProgramError(
        kind=kind,
        code=None,
        message=_render(exc, filenames),
        location=_locate(exc, filenames),
    )


def _missing_capability(exc: BaseException) -> bool:
    """Whether ``exc`` is a program reaching for a capability this run does not offer.

    This arm's spelling of the mistake a guest that could withhold a *name* reports as a
    ``NameError``. A module this run offers is a real namespace carrying the run's functions, so
    ``files.read_file`` under a run with reading withheld is an ``AttributeError`` rather than an
    unknown name — the same fact, and it has to be classified the same way or gg would count a
    withheld capability as an ordinary program bug on one arm and not on the other. A module the run
    offers *nothing* from is absent from the ``gg`` surface for the same reason, and reaching for one
    of those is the same mistake one level up.

    The check is on the namespace the failure happened on, not on the exception's type: an
    ``AttributeError`` against anything else is exactly the ordinary program bug it looks like.
    """
    return isinstance(exc, AttributeError) and isinstance(
        getattr(exc, "obj", None), gg_scope.Bound
    )


def _load_modules(
    modules: List[CodeModule], scope: Dict[str, Any], filenames: set
) -> SimpleNamespace:
    """Evaluate each code module against ``scope`` and collect its namespace for ``lib.<name>``.

    A Python module's exports *are* its namespace, so — unlike the JavaScript guest, whose host
    appends a ``return { … }`` — nothing is added to the source: it is executed as a module body and
    the public names it leaves behind are what the program reaches through ``lib``. Names beginning
    with an underscore are private by the language's own convention and are not bound; neither are
    the names the module inherited from the scope it was given.

    A module that throws is **reported, not raised**: a broken skill belongs to whoever authored it,
    not to the program that merely has it in scope, so its binding is left empty and the program
    runs.
    """
    loaded: Dict[str, Any] = {}
    for module in modules:
        filename = f"{module.name}.py"
        filenames.add(filename)
        _register_source(filename, module.source)
        namespace: Dict[str, Any] = dict(scope)
        try:
            exec(compile(module.source, filename, "exec"), namespace, namespace)
        except BaseException as exc:  # noqa: BLE001 — a module may throw anything.
            feedback.report_module_error(
                module.name, _render(exc, frozenset(filenames))
            )
            loaded[module.name] = SimpleNamespace()
            continue
        loaded[module.name] = SimpleNamespace(
            **{
                name: value
                for name, value in namespace.items()
                if not name.startswith("_") and name not in scope
            }
        )
    return SimpleNamespace(**loaded)


class WitWorld(wit_world.WitWorld):
    """The component's exports: evaluate one program, and say which gg tools this artifact binds."""

    def run(
        self,
        program: str,
        modules: List[CodeModule],
        tools: List[str],
        ending: session.EndingKind,
        library: bool,
    ) -> None:
        """Evaluate one program, reporting everything it did over ``feedback``.

        The code modules are evaluated against the **same** scope the program gets, so a skill's
        module may call ``files.read_file`` exactly as a program does.
        """
        stream = _FeedbackStream()
        sys.stdout = stream
        sys.stderr = stream
        _clamp_recursion()

        filenames = {PROGRAM_FILENAME}
        # `__name__` is `__main__` because that is what a script is, and because a model that
        # guards its entry point with `if __name__ == "__main__":` has written correct Python and
        # must not be silently skipped.
        scope: Dict[str, Any] = {"__name__": "__main__"}
        scope.update(gg_scope.build_scope(tools, ending, library))
        lib = _load_modules(modules, scope, filenames)
        if modules:
            scope["lib"] = lib
        _register_source(PROGRAM_FILENAME, program)

        try:
            exec(compile(program, PROGRAM_FILENAME, "exec"), scope, scope)
        except BaseException as exc:  # noqa: BLE001 — a program may throw anything.
            # Flushed first, so a program that printed and then failed has its output ahead of its
            # error rather than after it.
            stream.flush()
            feedback.report_error(_classify(exc, frozenset(filenames)))
            return
        stream.flush()

    def bound_tools(self) -> List[str]:
        """The gg tool names this component can bind.

        Derived from the SDK's own catalogue rather than listed here, and filtered by whether the
        module really defines the function — so a catalogue entry pointing at a name that does not
        exist is a missing name in this answer rather than an attribute a program discovers by
        calling it. gg compares it with ``ALL_TOOL_NAMES`` on the *committed artifact*, which is the
        one drift check that catches a stale ``.wasm``.
        """
        return gg_scope.bound_tools()
