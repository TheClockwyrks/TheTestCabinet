---
title: "Python"
---

## The arm

Python is a registered [responses-as-code](/gg/responses-as-code/overview/) program
language whose guest carries its own interpreter. A model's whole reply is a
Python module, and it crosses the membrane as the source the model wrote.

Preparation returns that source unchanged, with no compiled component and no
unreachable-tail measurement, since Python has no statement that ends a module
early. The first thing to read a program is the CPython inside the guest, which
compiles it as `program.py` with `__name__` set to `"__main__"` and runs it at
the top level. The arm puts no compiler on the turn path, installs nothing in
the run container, and opens no workspace during preparation. For the shared
account of how the other arms compile a reply, see
[compilation](/gg/languages/compilation/).

## The guest artifact

The build produces one artifact for this arm, `python.component.wasm`, around
25 MB. `packages/gg-sandbox-python/build.sh` bakes it with a pinned
`componentize-py` (0.25.0, which embeds CPython 3.14) linked against
`crates/gg/wit/gg-sandbox.wit`, and `crates/gg-sandbox-artifacts/python` runs
that script as a step of building gg. The arm embeds what lands there through
`GG_ARTIFACTS_PYTHON`; nothing is committed. The release is pinned, so the
CPython version an agent's programs run on is decided by the checkout.

The component is built against the whole WASI p2 surface rather than stubbed, so
`datetime.now()`, `SystemRandom()`, `uuid4()`, `tempfile` and `threading` are
ordinary calls. Baking snapshots a running interpreter's memory and is not
byte-reproducible, so tests hold the artifact to a size band and to how it
behaves through gg's own linker and membrane.

## The library set

`componentize-py` bakes the import closure of the entry module measured by
executing the import, so `packages/gg-sandbox-python/src/library.py` decides
what a program may import. What it names at module scope is in the component's
filesystem and already loaded in `sys.modules`; anything else raises
`ModuleNotFoundError`. The set is around ninety standard-library modules, filed
under the `# --- … ---` headings of that file, plus the pure-Python wheels
`requirements.txt` pins (`PyYAML`, `tomli-w`). `asyncio`, `subprocess`,
`multiprocessing`, `unittest` and `doctest` are outside it by choice, and `ssl`,
`bz2`, `lzma`, `ctypes` and `curses` are absent from this CPython build, so
`urllib.request` reaches `http://` only.

The set is model-facing, so it is reflected rather than described. The reflector
reads `library.py`'s module-scope imports with their headings, emits them as the
catalogue's `libraries` section, and the system prompt renders that section
group by group. What a model is told it may import must be what the component
was built with, down to the dotted name.

## The SDK

The SDK is hand-written Python, baked into the component. It is shaped as a
Python library rather than as a transliteration of another arm's surface:

- The surface is the package `gg`, one module per capability (`gg.files`,
  `gg.shell`, `gg.board`, …), each exporting plain functions and the dataclasses
  and enums it speaks in.
- Names are `snake_case`, and the `@operation("files.read_file")` decorator on
  each declaration identifies the gg operation a spelling binds.
- Required arguments are positional and optional ones are keyword arguments with
  defaults, so a record the wire declares is spelled as the function's own
  arguments rather than as a value a program must construct first.
- Results are frozen dataclasses, fixed choices are enums, a union is narrowed
  with `isinstance` or `match`, and the wire's error arm is a raised `ToolError`
  whose `code` is an enum member.
- `UNCHANGED` is the third state of a patch argument: leave it out to keep what
  is there, pass `None` to clear it, pass a value to replace it.
- Each module owns the types it produces, so `gg.files.FileRead` and
  `gg.tasks.TaskStatus` are written under the module that hands them back.

A program starts with every capability module bound under its bare id, the same
modules under `gg`, and every type the SDK declares bound bare.
`files.read_file` and `gg.files.read_file` are one object, and the qualified
name is what documentation views and search are keyed by. The scope is static:
every function is bound whatever the run enabled, and a call the agent was not
granted is refused by the host. The rules every arm's surface obeys are on
[the agent surface](/gg/languages/agent-surface/).

The shim points `sys.stdout` and `sys.stderr` at gg's feedback log, one call per
line, and clamps `sys.setrecursionlimit` to 1000, so that exhausting the wasm
stack raises a catchable `RecursionError`.

## The signature catalogue

`packages/gg-sandbox-python/signatures.sh` reflects the catalogue with a pinned
`griffe` (2.1.0), which parses `src/gg/**` statically. `crates/gg/build.rs` runs
it into the build's `OUT_DIR` as `python.signatures.json`, and the arm embeds it
and asserts that it carries `language: "python"`.

Everything the catalogue says is written on the declaration it describes, and
the reflector fails the build rather than emitting a gap:

- the module is the Python module the `def` is in, and the fully-qualified name
  is that module's path plus the function's name;
- the public surface is `__all__`, a name in it that is not a function is a
  type, and each public function carries one `@operation` that no other function
  claims;
- the brief is the docstring's first line and the detail is what follows the
  blank line after it, so a first paragraph running over one line is an error;
- every parameter carries an `Args:` entry and every `Args:` entry names a
  parameter;
- every type and every type member is documented, and every type a signature
  refers to is resolved to its fully-qualified name through the transitive
  reference closure.

## Checking and failures

`checker()` is `None`. Nothing reads a program before it runs, so a turn on this
arm reports no compile time: `SandboxOutcome::compile` is absent rather than
zero, and every failure is a run-time failure. The shim catches an uncaught
exception once and reports it as a located `ProgramError`:

- a `SyntaxError` carries CPython's own message and the program's own line and
  1-based column, and has no traceback;
- a raised `ToolError`, and the generated `Err` a program reaching past the SDK
  receives, are a tool failure carrying the wire's error code;
- a `NameError`, and an `AttributeError` against one of gg's own namespaces, are
  an unknown name;
- anything else is reported with the program's own frames and the exception,
  truncated at the message limit.

A location is the innermost frame the program or one of its code modules owns,
with the column of the instruction that stopped, and what the model reads holds
the program's own frames.

The [execution timeout](/gg/execution-limits/) fires only where the guest is
executing wasm, and this guest can park. A program inside a synchronous WASI
call such as `time.sleep` is stopped at its first re-entry, so one sleeping in
short hops is bounded near its budget and one sleeping in a single long hop runs
that hop out.

## Code modules

A skill's or memory's code is a module when it is spelled `.py`, and that is the
arm's only extension. A Python module's namespace is its exports, so the source
crosses untouched and the guest binds whatever the module body defined at
`lib.<key>`, which is `snake_case` and ASCII-only. The names that travel beside
the source are read by a line scan over the dialect's code mask: unindented
`def`, `async def`, `class` and plain top-level assignments, in source order,
first spelling wins, skipping names opening with `_`. An imported name is left
out of that list.

## Healing dialect

The dialect answers [response healing](/gg/response-healing/)'s lexical
questions in Python's terms:

- the fence tags read as the program are `python`, `py`, `python3`, `py3`, `pyw`
  and `ipython`;
- a line is code when it opens a block with a block keyword and a trailing `:`,
  opens with a statement keyword, a closer, a `#` or a `@`, ends open, assigns
  to a name-shaped target, or opens with a call;
- statement keywords are matched case-sensitively at an identifier boundary and
  are keywords alone, which keeps `If you want to…` prose while `if x:` is code;
- `#` is listed among the characters no prose line contains, so a `#` line
  survives as a comment;
- the code mask lexes single, double and triple-quoted strings, comments and
  backslash escapes, reads an f-string's substitutions as string text, and
  declines when a string is still open at a newline or at end of input.

## Prompt dialect

Two Handlebars templates carry everything gg says about this arm,
`system-code.python.hbs` and `code-nothing-shown.python.hbs`. Neither writes a
function name or a signature: every spelling they quote is resolved from this
arm's catalogue when the template renders.

The system prompt states that the response is executed as a module body with
`__name__` set to `"__main__"`, that there is no `return` to write, and that a
view is the only way a value or a file reaches the model. It states that gg's
surface needs no import, that a module is reachable bare and under `gg`, and
that each module owns the types it produces. It states that required arguments
are positional and optional ones are keyword arguments, that every call is
synchronous, and that a failed call raises `ToolError` with an enum `code`, and
it renders the library set as the catalogue declares it.

Statements gg synthesizes into a transcript are written in the same idiom. A
file view is `gg.views.open_file("src/main.py")`, with a window as `offset` and
`limit` keyword arguments and no terminator. A set of documentation views is a
list of names and a `for` loop over it.
