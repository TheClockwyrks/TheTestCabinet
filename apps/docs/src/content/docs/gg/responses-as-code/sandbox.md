---
title: "The sandbox"
---

A program runs in a wasmtime component, in a store built for that one program.
Both ceilings a program runs under belong to the store, which is what lets the
whole process share one compiled component per language while every program
keeps its own budget.

## Execution limits

| Limit | What it bounds |
| --- | --- |
| `timeoutSecs` | Guest-execution time for one program: the guest's own setup, the program itself, and every value marshalled across the membrane. |
| `maxMemoryBytes` | Guest linear memory. A `memory.grow` past the cap is denied. |

Each profile writes both, on the terms in
[Configuration](/gg/responses-as-code/overview/#configuration). Both are armed
per program and re-armed every turn, so a session of fifty turns
gives every program its own full budget and nothing accumulates. Neither is
clamped: a study may starve the sandbox on purpose, and the error names the
configured limit. The ceilings that bound a whole run, rather than one program,
are the [execution limits](/gg/execution-limits/).

The timeout is an infinite-loop guard rather than a work ration. It is set far
longer than an honest program's execution needs, so a program that reaches it is
almost always one that does not terminate. The heaviest honest program measured
spends about 1.8 s of guest execution, reading, rewriting and writing back
twenty 64 KiB files. The memory cap is about 25 times the 10.3 MiB the
ECMAScript guest engine occupies at rest.

### Timeout enforcement

The timeout is wasmtime epoch interruption. A daemon ticker advances the
engine's epoch every 100 ms, each store arms a deadline against it, and the
deadline callback re-arms for however much guest budget is left after
subtracting time spent in host calls. A program is stopped within one tick of
its deadline.

Time parked in a bridged tool call is therefore excluded from the budget. A
program waiting minutes on a `shell` build is never mistaken for a runaway.

An epoch deadline is delivered only where the guest is executing wasm, at a loop
back-edge or a function entry. A guest parked inside a synchronous WASI call is
executing none, so a program that sleeps in one long park runs that park out and
the deadline lands at the first hop that returns to wasm. This ceiling bounds
the guest's execution, and the bound on a parked turn is the run-level idle
watchdog. Nothing stalls, because a program runs on a blocking thread, and the
membrane refuses every bridged call once the run's budget is spent.

### Fixed bounds

- A `shell` timeout is clamped at both ends: down to what is left of the run's
  wall-clock budget, because a host function cannot trap and an unclamped
  `shell("sleep 3600")` would carry the run past its deadline with nothing left
  to stop it; and down to a day, because the tool builds a `Duration` from
  whatever number arrives and a `Duration` cannot hold every `f64`.
- A guest may spend 1 MiB of wasm call stack before wasmtime traps it. The
  ceiling is above the JavaScript recursion ceiling the
  [ECMAScript guest](/gg/languages/ecmascript-guest/) sets, so that engine
  reports an overflow itself rather than the store dying, and below a thread's
  own stack, so the trap is a trap rather than a crash.

### The run's wall-clock budget

The membrane checks the run's wall-clock deadline before every bridged call.
Once the budget is spent, every further call is refused with a `limit-exceeded`
failure, so the program stops cleanly and everything it already did stands.

Calls that dispatch no gg tool never reach that check: the view family, the docs
family, the session family and the program-library family are serviced whatever
the budget says, because a turn that cannot say what it found is worse than one
that says it late, and an ending must stay reachable. `gg.views.openFile` is
refused, because it dispatches `read_file`.

## The guest context

gg's linker defines the whole WASI p2 surface for every guest, unconditionally.
A program gets the process's environment, a real clock and randomness, the
network with IP name lookup, and the container's filesystem preopened at `/`
with full directory and file permissions. A model reaching for its language's
ordinary date, random or file APIs is a model using the language it was told to
write in.

A narrowed [grant](/gg/configurations/#granting-calls) does not narrow that
reach. An agent not granted `files.read_file` still reads files through its own
language's standard library, and the same holds for the network, so a
configuration that takes those calls away measures whether the model reaches for
gg's typed surface rather than whether it reaches the filesystem at all. Studying
a program that genuinely lacks either means running it in an environment that
lacks it.

`shell.shell` is the exception. WASI p2 exposes no process-spawn interface, so a
guest cannot run a command through its standard library and an agent not granted
the call cannot run one at all.

Stdout is withheld, because gg's telemetry stream is on fd 1. Stderr is captured
rather than inherited and never fails a write, so a guest runtime's dying message
reaches the model's feedback instead of the operator's log.

What is captured is bounded at both ends: the host keeps the first 4 KiB and the
last 4 KiB, so anything a guest wrote up to 8 KiB reaches the model whole. Both
ends are kept because the runtimes disagree about which one carries the fault.
Mono names a `StackOverflowException` on the first line and then repeats one
frame for fifty kilobytes, while a Rust panic and a Swift `fatalError` are the
last thing on a channel the program itself has been writing to. Keeping one end
alone loses the fault on the arms that use the other.

Where the two ends do not meet, a line of its own counts the deletion between
them, reading `… 43992 bytes dropped`.
[Trimming](/gg/responses-as-code/invariants/#trimming) requires that of every
trim, so a model can tell a bounded report from a whole one. Each cut is moved
out to the nearest line boundary and the bytes that move with it are added to
the count, so a model never reads a frame the bound cut in half.

gg adds `GG_SANDBOX_DEADLINE_MS` to the environment, holding this program's
execution budget one epoch tick short of gg's own deadline. It is for a guest
whose engine can stop a runaway loop itself and report which function was
looping; a guest that leaves it alone has the epoch deadline as its only
ceiling.

The rest of the environment is inherited because a language runtime needs
`HOME`, `PATH`, `TMPDIR` and the locale to work at all. The accepted consequence is that
whatever this process's environment holds, including the run's model
credentials, is readable from inside a program. That is the same reach a program
has through the preopened filesystem, and the same reach an agent has through
`shell`.

The preopen is the one part of the context that may fail, and it fails only if
the host cannot open `/` at all. The failure is ignored: a guest that never
touches the filesystem is unaffected, and one that does gets an ordinary WASI
error from its own runtime.

### Stopping the process

A program that calls its language's `exit` is reported as having stopped itself,
in place of the wasm backtrace that carries neither the word nor the status.

The status reaches gg as success or failure and not as a number. The
`wasi_snapshot_preview1` adapter every component is encoded with lowers
`proc_exit(n)` to `wasi:cli/exit.exit`, whose argument is a result. So `exit(0)`
is reported with its number, and every other status is reported as a non-zero
exit whose value gg was not told. Naming the `1` that arrives would be gg
reporting a program the model did not write, which the
[invariants](/gg/responses-as-code/invariants/) forbid.

A status a model wants read is one its entry point returns. C++ and C# are the
arms whose entry point carries one, and an entry point that returned a non-zero
status is reported with the number the program chose.

### Globals an ECMAScript guest shadows

Six globals cannot be honoured, and each is replaced with a thrower so it raises
an ordinary, catchable program error naming what is missing and why.

| Global | Reason given |
| --- | --- |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame` | there is no event loop, so a scheduled callback would never run |
| `fetch` | this program's runtime is built without an HTTP client |

Both underlying failures are silent without a thrower. gg's `run` export is
synchronous, so an unshadowed `setTimeout(() => { hit = 1 }, 0)` leaves `hit` at
`0` and reports no error at all. Baking a component without the HTTP capability
removes the WASI import but leaves the builtin defined, so an unshadowed `fetch`
reaches a missing import and traps the whole store, which is uncatchable and
unreportable.

`queueMicrotask` is real: the [ECMAScript guest](/gg/languages/ecmascript-guest/)
drains its job queue before it returns, which is the same mechanism a top-level
`await` finishes on.

Nothing here denies a capability the component has. The clock, `Math.random` and
`crypto` are real and reachable. `fetch`'s reason is a fact about this artifact:
the host links `wasi:sockets` for every guest, so a guest that imported it would
have the network.

Each is a named thrower rather than an absence, because the engine's message for
calling a missing global carries neither the name nor a reason.

## Build and distribution

No arm's artifacts are committed. Every arm needs files on disk that a turn
cannot fetch: a guest component with a language runtime baked into it, a
compiled library set a program is linked or type-checked against, a compiler
small enough to travel inside gg's own binary. Every one of them is an output of
the build that embeds it.

Each arm's `build.sh` writes the files that arm needs into
`$GG_ARTIFACTS_OUT_DIR`, driven by a crate under
`crates/gg-sandbox-artifacts/<arm>/`. That crate's `links` key carries the
output directory to `crates/gg`'s build script, which republishes it as an
environment variable the arm's module reads with `include_bytes!`. Ten crates
serve eleven arms: `typescript` (whose guest serves the JavaScript and PureScript
arms too), `python`, `ruby`, `java`, `kotlin`, `rust`, `purescript`, `cpp`,
`swift` and `csharp`.

There is one crate per arm rather than more steps of one build script, because a
build script has a single rerun set. Per-arm crates buy three things. Editing
the Java SDK re-cuts the Java jar and nothing else. A cold artifact build costs
about what the slowest arm costs, since the arms build in parallel. Ordering is
a type, since `crates/gg` depends on the arm crates and cargo runs their build
scripts first.

The signature catalogues are reflected separately, by `crates/gg/build.rs`, into
its own `OUT_DIR`. A build of gg therefore cannot embed a catalogue older than
the SDK sources in the same checkout, and cannot embed an artifact of a
different vintage from the catalogue describing it.

A generated artifact is a requirement. A committed artifact is a claim about
source that is checked when it is generated and never again, and what it costs
when it goes stale is a model told about a function the guest does not export,
or compiled against a library that has not caught up. Five arms are not
byte-reproducible, so nothing can re-cut one of their artifacts and diff it
against a committed copy.

What that costs is that building gg requires every arm's toolchain.
`scripts/ci/install-gg-toolchains.sh` installs the eleven arms' own toolchains,
idempotently, and every surface that builds gg runs it. Building the C# guest
additionally needs a whole .NET SDK and an unpruned wasi-sdk that no run
touches, installed under a prefix of their own by
`scripts/ci/install-gg-build-toolchains.sh`.

Artifacts are embedded rather than read from disk because gg is copied as a
single file into an ephemeral run container and has to carry everything it needs
with it.

### Compiling a component

The wasmtime engine is process-wide, and each registered language's compiled
component lives in a slot of its own, so a language's artifact is compiled at
most once per process and a run that never drives an agent in a language never
compiles it. Nothing about a component is cached to disk.

A warm-up compile is fired once per distinct language the configuration will
actually drive, concurrently with the first model request, and never from a
subagent. An arm that compiles a component per program has no component to warm.
Its warm-up is its preparation step's.

## The session record

A program's composed calls stream as ordinary `ToolCall`/`ToolResult` pairs and
are captured for the [session record](/gg/session-record/) exactly as native
tool calls are. Each carries a synthetic call id `program:{ordinal}:{tool}`. The
ordinal keeps two calls to one tool distinct, and the `program:` prefix is what
lets a reader attribute a recorded result to a program rather than to a
tool-calling turn the model never took.

A code turn's assistant message carries no `tool_calls`, so a skill body a
program used is pinned as a standalone user message rather than as a `tool`
message, which would quote a minted id an OpenAI-shaped provider rejects. A
skill body is pinned exactly once however many times a program uses it.

The program library is a separate record, held outside the context window: one
entry per turn that ran a program, holding the source that executed. See the
[program library](/gg/program-library/).
