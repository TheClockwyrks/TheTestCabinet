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
3. **A program starts with an empty namespace.** Nothing gg offers is in it: the SDK is the ordinary
   Python package ``gg``, baked into the component, and a program reaches it by writing ``import
   gg``. A program that writes no import gets CPython's own ``NameError``, which is the answer the
   invariants ask for and the one a Python programmer expects.
4. **The agent's code modules are evaluated first** (:func:`_load_modules`), each as a real module
   registered at ``lib.<name>``, which a program reaches by writing ``import lib``. A module that
   throws is reported and left empty rather than taking the program down with it: a broken skill
   belongs to whoever authored it.
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
from types import ModuleType
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
# declares the import, and every one of `gg`'s tool modules imports the interface it wraps. It is
# what makes `import gg` resolve inside the guest at all, and therefore what a program's own import
# line finds. See `library` for the same mechanism applied to the standard library, and for why what
# a program can import is a bake-time fact rather than a policy.
import gg
from gg._registry import bound_tools as gg_bound_tools
from gg.core import ToolError

# Every library a program may reach for, likewise imported for its side effect. Its own docstring is
# the authority on what the Python arm offers and what it deliberately does not.
import library  # noqa: F401

#: The file name a program is compiled under, and therefore the one its tracebacks and its reported
#: :attr:`location` are stated in. Fixed and unqualified so that what a model reads back names the
#: thing it wrote — "line 5 of program.py" — rather than a path inside a component.
PROGRAM_FILENAME = "program.py"

#: The package the agent's own code modules are registered under, and the name a program imports to
#: reach them. One level deep: a module bound as `notes` is `lib.notes`, which is what gg tells the
#: model when the read that carries the code comes back.
LIB_PACKAGE = "lib"

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

    The message of the first is the exception's own rendering rather than the host's detail alone,
    because ``gg.core.ToolError.__str__`` names the call that failed and a program with twenty reads
    in it is otherwise told a file was not found and left to guess which read wanted it.
    """
    if isinstance(exc, ToolError):
        return feedback.ProgramError(
            kind=feedback.ErrorKind.TOOL_FAILURE,
            code=wit_types.ErrorCode[exc.code.name],
            message=str(exc),
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
        if isinstance(exc, NameError) or _unknown_gg_name(exc)
        else feedback.ErrorKind.OTHER
    )
    return feedback.ProgramError(
        kind=kind,
        code=None,
        message=_render(exc, filenames),
        location=_locate(exc, filenames),
    )


def _unknown_gg_name(exc: BaseException) -> bool:
    """Whether ``exc`` is a program reaching for a gg name that does not exist.

    This arm's spelling of the mistake other guests report as a ``NameError``. ``gg.files.read_fil``
    is an attribute of a module rather than a free name, so Python raises ``AttributeError`` — the
    same fact, and it has to be classified the same way or gg would count one typo as an unknown
    name on one arm and as an ordinary program bug on another.

    It is **not** how a withheld capability arrives: every function gg declares is on its module
    whatever the run enabled, so reaching for one that this agent was not granted is a refusal from
    the host carrying the wire's own ``unavailable`` code, classified from that code rather than
    from anything read here.

    The check is on the module the failure happened on, not on the exception's type: an
    ``AttributeError`` against anything else is exactly the ordinary program bug it looks like.
    CPython puts the object on the exception, and `gg._registry.missing` puts the same thing on the
    one it raises itself.
    """
    obj = getattr(exc, "obj", None)
    if not isinstance(exc, AttributeError) or not isinstance(obj, ModuleType):
        return False
    name = getattr(obj, "__name__", "")
    return name == gg.__name__ or name.startswith(f"{gg.__name__}.")


def _load_modules(modules: List[CodeModule], filenames: set) -> None:
    """Evaluate each code module and register it at ``lib.<name>``, for a program that imports it.

    Nothing is added to the source — unlike the JavaScript guest, whose host appends a
    ``return { … }`` — and nothing is put in front of it: a module body is executed in a namespace of
    its own with nothing in it, so a module's author writes ``import gg`` exactly as a program does
    and reaches the same objects.

    ``lib`` is an ordinary package in :data:`sys.modules`, so ``import lib``, ``from lib import
    notes`` and ``import lib.notes`` all resolve, and a program that writes none of them has no such
    name — which is the same rule the SDK is under.

    What each module carries is the public names its own body left behind. A name beginning with an
    underscore is private by the language's own convention and is not one of them, and the module's
    own code still reads it: a function it defined closes over the namespace the body ran in rather
    than over the module this hands back.

    A module that throws is **reported, not raised**: a broken skill belongs to whoever authored it,
    not to the program that merely imports it, so its binding is left empty and the program runs.
    """
    if not modules:
        return
    package = ModuleType(LIB_PACKAGE)
    # An empty `__path__` is what makes it a package rather than a plain module: `import lib.notes`
    # asks the machinery for a submodule, and the machinery answers from `sys.modules` without ever
    # looking at the path.
    package.__path__ = []  # type: ignore[attr-defined]
    sys.modules[LIB_PACKAGE] = package
    for module in modules:
        filename = f"{module.name}.py"
        filenames.add(filename)
        _register_source(filename, module.source)
        qualified = f"{LIB_PACKAGE}.{module.name}"
        loaded = ModuleType(qualified)
        loaded.__file__ = filename
        namespace: Dict[str, Any] = {}
        try:
            exec(compile(module.source, filename, "exec"), namespace, namespace)
        except BaseException as exc:  # noqa: BLE001 — a module may throw anything.
            feedback.report_module_error(
                module.name, _render(exc, frozenset(filenames))
            )
            namespace = {}
        for name, value in namespace.items():
            if not name.startswith("_"):
                setattr(loaded, name, value)
        sys.modules[qualified] = loaded
        setattr(package, module.name, loaded)


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

        The code modules are evaluated first and under the same rule the program is: each one writes
        its own ``import gg``, and what it leaves behind is registered at ``lib.<name>``.

        ``tools``, ``ending`` and ``library`` are **read by nothing here**, and the names are the
        WIT's rather than underscored because that is what gg calls them. They used to build a scope
        the program was given; a program now writes its own imports, and every capability question is
        answered at the membrane, which is the one place that can answer it the same way for all
        eleven language arms. gg still sends them — the world is shared with ten sibling guests — so
        they arrive and are ignored.
        """
        del tools, ending, library
        stream = _FeedbackStream()
        sys.stdout = stream
        sys.stderr = stream
        _clamp_recursion()

        filenames = {PROGRAM_FILENAME}
        _load_modules(modules, filenames)
        # `__name__` is `__main__` because that is what a script is, and because a model that
        # guards its entry point with `if __name__ == "__main__":` has written correct Python and
        # must not be silently skipped. It is the whole of what a program starts with.
        scope: Dict[str, Any] = {"__name__": "__main__"}
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

        Derived from the SDK's own catalogue rather than listed here, and filtered by whether an
        `@operation` really claimed the row — so a catalogue entry pointing at a declaration that
        does not exist is a missing name in this answer rather than a call a program discovers by
        making it. gg compares it with ``ALL_TOOL_NAMES`` on the artifact it embedded, which is the
        one drift check that catches a stale ``.wasm``.
        """
        return gg_bound_tools()
