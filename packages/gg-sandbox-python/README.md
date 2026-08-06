# `gg-sandbox-python` — gg's Python guest

The **Python** guest for gg's
[responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
capability. Under that capability a model answers a turn by writing a whole
**program** instead of a batch of tool calls, and the language it writes in is a
first-class axis of gg — it is what a cross-language A/B study compares arms on.
This package is one such arm's whole guest: the hand-written idiomatic SDK a
program calls gg through, the interpreter shim it is evaluated by, the curated set
of libraries it may reach for, and the two scripts that produce the artifacts the
Rust host embeds.

It is **not** an npm workspace and shares no code with
[`gg-sandbox`](../gg-sandbox/), the TypeScript guest. It has no dependents and is
never published. Its outputs are two committed artifacts:

| Artifact | What it is | Made by |
| --- | --- | --- |
| [`crates/gg/src/sandbox/guests/python.component.wasm`](../../crates/gg/src/sandbox/guests/) | The baked component — a whole CPython 3.14, this shim, the SDK and the curated library set. **~24 MiB**; a test holds it to a 22–28 MiB band. | `build.sh`, by hand |
| [`crates/gg/src/sandbox/guests/python.signatures.json`](../../crates/gg/src/sandbox/guests/) | The signature catalogue: every object, signature, argument, type and type member a model is told about, reflected out of the SDK's own docstrings. | `signatures.sh`, also run by CI |

## The strategy, in one paragraph

CPython is *inside* the component. `componentize-py` links a real CPython against
gg's WIT world, so a model's program crosses the membrane as an ordinary string and
is `exec`'d by an interpreter that is already there. Nothing is installed in the run
container, there is no compiler on the turn path, and gg's binary stays the single
static file it has to be. That makes this arm the exact peer of the JavaScript one —
a language whose programs are evaluated rather than compiled — which is precisely what
makes the pair worth running as two arms of a study.

## The SDK, and what "idiomatic" cost

`src/gg/` is hand-written and reads as Python, not as the TypeScript SDK
transliterated. Underneath it sit the bindings `componentize-py` generates from the
WIT, which are exactly where a generator belongs — a mechanical lowering nobody
reads. Every difference above them is deliberate:

* **Required arguments positional, optional ones keyword arguments with real
  defaults.** `fs.read_file(path, limit=200)`, not a trailing options object. A
  membrane record's fields are the function's own arguments, so
  `memory.create_memory(name, description, body, code=...)` never asks a model to
  construct a value before it can make a call.
* **Frozen dataclasses for results, enums for fixed choices.** `entry.kind is
  EntryKind.FILE`, never a string comparison a misspelling would turn into a branch
  that quietly never runs.
* **A union of two classes for a read**, narrowed with `isinstance` or a `match`,
  rather than the wire's tagged wrapper.
* **A raised `ToolError`** carrying a typed `code`, because that is where a Python
  programmer expects a failure to be handled.
* **`UNCHANGED` for a patch field that can also be cleared** — leave the argument
  out to keep it, pass `None` to empty it — because Python already spells "absent"
  as `None` and the third state needs a name.

What must *not* differ from any other arm is identity: which functions exist, which
object each hangs off, and what gates each one. That is asserted by gg's own
agreement gate, against the committed catalogue, in
[`python.substrate.test.rs`](../../crates/gg/src/sandbox/language/) — which also runs
every one of the 35 tools through the real membrane and requires the JSON that
reaches gg's dispatch to be **byte identical** to what the TypeScript arm produces
for the same capability.

## State: registered

`python` is a value an operator configures, and the whole arm is in the tree: the
component and its build, the interpreter shim, the SDK, the signature catalogue and its
drift gate, the error reporting, the library set, end-to-end execution through gg's own
linker, membrane and store, and — in `crates/gg/src/sandbox/language/python.rs` and its
siblings — the `ProgramLanguage` implementation, the healing dialect and the two prompt
templates. Its host half is small on purpose: preparing a Python program does **nothing**
to it, because CPython is inside the component and is the first thing to read it.

## Layout

| Path | What it holds |
| --- | --- |
| `src/shim.py` | The component's entry point: it rebinds `print` to gg's feedback channel, defuses the interpreter's one store-killing landmine, builds the program's scope from the SDK, evaluates the program and the code modules, and reports every failure at the program's own coordinates. |
| `src/gg/` | The SDK. `catalogue.py` is the identity data (which tool is which function, on which object); `types.py` and `errors.py` are the model-facing shapes; `tools/`, `session.py` and `helpers.py` are the functions; `scope.py` builds what a program starts with. |
| `tools/signatures.py` | The reflector: reads the SDK statically with `griffe` and emits the catalogue. It refuses to emit one with a blank in it. |
| `signatures.sh` | The pinned-`griffe` wrapper CI and a developer both run. |
| `src/library.py` | Every library a program may reach for, imported for its side effect. Its docstring is the authority on what this arm offers, what it deliberately does not, and why the list has to exist at all. |
| `requirements.txt` | The pinned pure-Python wheels, with the rule anything added must meet. |
| `build.sh` | The hand-run build that writes the committed component. |
| `.build/` | Generated, `.gitignore`d: the vendored wheels and the generated WIT bindings. |

## What a program can reach

* **The gg surface**, as the API objects `scope.py` binds — `fs`, `system`, `project`,
  `tasks`, `memory`, `view`, `context`, `agents`, `skills`, `programs`, `harness`,
  `review` — plus every type they speak in. The objects follow the run: a withheld
  tool is not an attribute, and an object with nothing on it is not a name at all.
  That is the *surface*, not the enforcement — the SDK is an ordinary package a
  program can `import gg` and reach past, and the **host** is what refuses a call
  outside the run's enabled set.
* **Everything in `src/library.py`** — most of the standard library, plus `PyYAML`
  and `tomli-w`. That list is a **bake-time fact about the artifact**, not a policy:
  `componentize-py` bundles only the modules the entry module's import closure
  reached, so a module nobody imported is not in the component at all and a program
  that asks for it gets `ModuleNotFoundError`. That is why the file exists, and why
  a cross-language study can state exactly what this arm was given.
* **The whole WASI p2 surface** gg's host links: the clock, the RNG, the container
  filesystem preopened at `/`, the network, and the process environment. The
  component imports all of it — filesystem and sockets included — which is exactly
  why gg's linker defines the whole surface for every guest.
* **Not `ssl`**, and not `bz2`, `lzma`, `ctypes` or `curses`: `componentize-py`'s
  CPython is not built with them. The visible consequence is that `urllib.request`
  reaches `http://` and not `https://`.
* **Not stdout.** gg's telemetry stream *is* the host process's stdout, so the host
  builds its WASI context without it. `print` is rebound to the feedback channel
  instead — which is also the only channel a program has for showing gg a value.

## Two things measured here that are worth knowing

* **Building with `--stub-wasi` is what once made this arm look expensive.** That
  flag replaces every WASI import with a trapping stub, and under it `datetime.now()`,
  `SystemRandom()`, `uuid4()`, `tempfile` and `threading` all trap — unshimmably,
  because they are C-implemented immutable types. Built against gg's ambient WASI they
  are ordinary calls again, and `threading` raises a *catchable* `RuntimeError`.
* **`sys.setrecursionlimit` is a store-killer.** Raised past what the wasm stack holds,
  a `RecursionError` the program **already caught** kills the store while CPython
  unwinds its traceback, so `except BaseException` gives no protection at all. The shim
  clamps the limit; both facts have tests.

## The one thing this arm can do that the ECMAScript guest cannot

**Block where the execution timeout cannot reach it.** gg stops a program with epoch
interruption, which fires only where the guest is running wasm — and a program parked in a
synchronous WASI call is running none. TypeScript's guest cannot get there (its timers are
shadowed and it has no filesystem or socket API); this one can, because `time.sleep` is
ordinary Python. Measured: `time.sleep(8)` against a **2 s** budget was stopped at 2.5, 2.7,
4.3, 7.0 and 9.4 seconds across five runs of the same program. It is always stopped
eventually and the elapsed figure is honest, but the deadline bounds nothing — a long enough
sleep would sit until the run-level idle watchdog fires. A runaway that *computes* traps on
the deadline every time, and that case has a test.

**Settled with the registration, as an acceptance:** gg does not extend the timeout to a
parked WASI call, and the bound on a parked turn stays the run-level idle watchdog. The
behaviour underneath is not new — `system.shell("sleep 3600")` parks for an hour on every arm
gg has — and both closures cost more than they buy today. The full argument, and the condition
under which it is reopened, is in
[Program languages](../../apps/docs/src/content/docs/gg/program-languages.md).

## Rebuilding

```sh
packages/gg-sandbox-python/build.sh       # the component  (by hand, needs uv + network)
packages/gg-sandbox-python/signatures.sh  # the catalogue  (also run by CI)
```

Both need `uv` and, the first time, network access. Rebuild the **component** after
changing the WIT, the shim, the SDK, the library set or a pin; regenerate the
**catalogue** after changing any signature or docstring under `src/gg/`. Commit the
refreshed artifacts in the same commit as the change that motivated them.

Only the catalogue is regenerated in CI. `scripts/ci/contract-drift.sh` runs
`signatures.sh` and fails on any diff, so a docstring edited without regenerating is
a red build. It does **not** rebuild the component: that needs `componentize-py`, a
network and 25 MB of output, and would be a false positive every time (see below).

**The build is not byte-reproducible**, and that is a property of `componentize-py`
rather than of this package: it pre-initialises CPython and snapshots the running
interpreter's memory, so two builds of identical sources differ (24,601,343 and
24,671,910 bytes were measured minutes apart, with `PYTHONHASHSEED` and
`SOURCE_DATE_EPOCH` pinned). The practical rule: **do not rebuild to check** — a rebuild
always produces a multi-megabyte diff, so run it only when something the component is
made of actually changed. What is checkable is what the artifact *does*, and that is what
the substrate tests assert.

## Another language

The seam every guest plugs into, what a registered language must supply, and the
worked steps for adding one are in
[Program languages](../../apps/docs/src/content/docs/gg/program-languages.md).
