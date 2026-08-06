# `gg-sandbox-python` — gg's Python guest

The **Python** guest for gg's
[responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
capability. Under that capability a model answers a turn by writing a whole
**program** instead of a batch of tool calls, and the language it writes in is a
first-class axis of gg — it is what a cross-language A/B study compares arms on.
This package is one such arm's guest: the interpreter shim a program is evaluated
by, the curated set of libraries it may reach for, and the build that bakes both
into the artifact the Rust host embeds.

It is **not** an npm workspace and shares no code with
[`gg-sandbox`](../gg-sandbox/), the TypeScript guest. It has no dependents, is
never published, and nothing in CI runs it. Its one output is a committed binary:

| Artifact | What it is |
| --- | --- |
| [`crates/gg/src/sandbox/guests/python.component.wasm`](../../crates/gg/src/sandbox/guests/) | The baked component — a whole CPython 3.14, this shim, and the curated library set. **~23.5 MiB**; a test holds it to a 22–28 MiB band. |

## The strategy, in one paragraph

CPython is *inside* the component. `componentize-py` links a real CPython against
gg's WIT world, so a model's program crosses the membrane as an ordinary string and
is `exec`'d by an interpreter that is already there. Nothing is installed in the run
container, there is no compiler on the turn path, and gg's binary stays the single
static file it has to be. That makes this arm the exact peer of the JavaScript one —
a language whose programs are evaluated rather than compiled — which is precisely what
makes the pair worth running as two arms of a study.

## State: the substrate, not yet the arm

This package is deliberately half-built, and the half that exists is the one
underneath. **Built and proven:** the component, its build, the interpreter shim, the
error reporting, the library set, and end-to-end execution through gg's own linker,
membrane and store. **Not built:** the idiomatic Python SDK — the `fs`, `memory`,
`tasks` and `view` objects with their keyword arguments, dataclasses, enums and
`ToolError` — the signature catalogue reflected from it, and the registration of
`python` as a program language. Until those land, `boundTools()` answers with the
empty list and no gg tool name is bound into a program's scope.

The proof that what *does* exist works is
[`crates/gg/src/sandbox/language/python.substrate.test.rs`](../../crates/gg/src/sandbox/language/),
which runs real Python through the real membrane rather than through a mock.

## Layout

| Path | What it holds |
| --- | --- |
| `src/shim.py` | The component's entry point: it rebinds `print` to gg's feedback channel, defuses the interpreter's one store-killing landmine, evaluates the program and the code modules, and reports every failure at the program's own coordinates. |
| `src/library.py` | Every library a program may reach for, imported for its side effect. Its docstring is the authority on what this arm offers, what it deliberately does not, and why the list has to exist at all. |
| `requirements.txt` | The pinned pure-Python wheels, with the rule anything added must meet. |
| `build.sh` | The hand-run build that writes the committed component. |
| `.build/` | Generated, `.gitignore`d: the vendored wheels and the generated WIT bindings. |

## What a program can reach

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

## The one thing this arm can do that no registered guest can

**Block where the execution timeout cannot reach it.** gg stops a program with epoch
interruption, which fires only where the guest is running wasm — and a program parked in a
synchronous WASI call is running none. TypeScript's guest cannot get there (its timers are
shadowed and it has no filesystem or socket API); this one can, because `time.sleep` is
ordinary Python. Measured: `time.sleep(8)` against a **2 s** budget was stopped at 2.5, 2.7,
4.3, 7.0 and 9.4 seconds across five runs of the same program. It is always stopped
eventually and the elapsed figure is honest, but the deadline bounds nothing — a long enough
sleep would sit until the run-level idle watchdog fires. A runaway that *computes* traps on
the deadline every time, and that case has a test.

This is a design decision for the step that registers `python`, not a defect in the guest;
[Program languages](../../apps/docs/src/content/docs/gg/program-languages.md) states the two
ways of closing it.

## Rebuilding

```sh
packages/gg-sandbox-python/build.sh
```

Needs `uv` and, the first time, network access. Rebuild after changing the WIT, the
shim, the library set or a pin — and commit the refreshed artifact in the same commit
as the change that motivated it.

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
