---
title: "Compilation and diagnostics"
---

A program language turns a model's reply into something its guest can evaluate,
and that step is allowed to spend real time. This page states what it costs, how
the cost is recorded, the two ways it fails, the isolation every language
honours while it runs, and how much of a compiler's output reaches the model.

## Checkers

Every language declares a checker: the name its own users give the thing that
judges a program, or none for a language whose prepare step invokes no compiler.
The answer is required, and `prepare_compiles` is derived from it so the two can
never disagree.

| Arm | Checker |
| --- | --- |
| TypeScript | `tsc` |
| JavaScript | none |
| Python | none |
| Ruby | `opal` |
| PureScript | `purs` |
| Java | `javac` |
| Kotlin | `kotlinc` |
| Rust | `rustc` |
| Swift | `swiftc` |
| C++ | `clang++` |
| C# | `csc` |

An arm that names a checker also names it in its own system prompt, so a model
told its program is checked is told by what. What the prompt states is that the
program is compiled, rather than that its types are checked: `tsc` checks types
and `opal` checks grammar, and both are checkers. The same answer decides
whether the sandbox times the preparation.

## Compiler location

A compiler is on the turn path, so it must be reachable from inside the run
container. Some travel inside gg itself: TypeScript's `tsc` and the Opal that
compiles Ruby are JavaScript bundles gg carries and runs with `node`. Operators
point `TCAB_GG_NODE` at that interpreter when it is not on `PATH`, and every arm
that spawns Node reads that one variable.

The rest need a toolchain in the image, so a gg run resolves the `-gg` variant
of the image it would otherwise get: that image plus the toolchain tree
assembled by `containers/gg-toolchains/`. Three properties hold of it.

- Every toolchain is present together. Language is resolved per agent, so one
  run may drive a C# agent and a Python agent at once and there is no such thing
  as the run's toolchain.
- Only gg's images carry them. Every other harness installs a CLI at run time
  and has no compiler on its turn path.
- Every run image has a gg variant, and the name is derived by appending the
  suffix rather than looked up in a table. A test fails the build when the names
  Rust resolves and the names `containers/image-names.sh` publishes disagree.

A language may move one-off work out of the first code turn by implementing
`warm_prepare`, which gg calls once per run on the same blocking task that
compiles the interpreter component. It is best-effort and idempotent.

## Recorded compile time

The sandbox's clock starts once a program is prepared, so compile time lands in
neither the turn's `durationMs` nor its `compileWaitMs`. Recording it is what
makes a compiled arm and an interpreted one comparable on what compiling cost
them.

- Each `code_execution` [event](/gg/telemetry/overview/) carries `compileMs`: what
  compiling cost that turn. An arm that compiles nothing carries no field at
  all, because a zero on every turn would claim a compile happened.
- The session summary carries `summary.compileMs`: the run's total, folded from
  those same events, so `summary.codeExecutions` is its exact denominator. It is
  `0` rather than absent for an arm that compiles nothing, so a query that
  averages the measurement keeps the run.

An arm that compiles its own component pays one `Component::new` per turn where
an interpreted arm pays one per process. That cost is the turn's
`compileWaitMs`, which is a separate figure from `compileMs`.

Everything a turn made its compiler do is charged to that turn, and the figure
sums four sources: the program the model wrote, each replacement it handed over
to within the turn's ceiling of four programs, the code half of every
[skill](/gg/skills/) or [memory](/gg/memories/) the turn brought into use, and
each on-use script such a read queued. A module is compiled again on each agent
that reads it, and the read happens inside a call the program made, after the
sandbox has taken its own reading. Folding those in keeps a skill-heavy run from
reporting less than it spent.

An on-use script is prepared once, by the read that queues it, so that its
author gets a located diagnostic there. It runs as prepared, and is never put
through the prepare step a second time.

The figure is reported for the turn whose program the compiler rejected too. A
compile that spent four seconds refusing a program spent them.

## Preparation failures

A language reports the two failures as different values, and gg keeps them apart
from there to the run record.

| | What happened | What the model is told | How the turn is recorded |
| --- | --- | --- | --- |
| The compiler rejected the program | It read the reply whole and found a type error, a borrow error, a name that does not resolve | a `Compiler error` band carrying the compiler's own diagnostics and nothing else | one of the `transpile` error types, under the `transpile` base kind: the model's to fix |
| The compiler could not finish | It crashed, its own timeout killed it, or the binary is missing from the image | nothing | a fatal turn, and the run ends under `internal_error` |

Routing a compiler's crash into the `Compiler error` band is the failure this
split exists to prevent. The model would read that its program did not compile
over a program nothing read, and spend its next turn rewriting something that
was never wrong.

A rejected program arrives as one of four bands, each with its own error type:
`transpile_syntax`, `transpile_semantic`, `transpile_compile` and
`transpile_unsupported`. It is recoverable, and the next turn's program may
compile. It is an error turn and counts against the run's
[error ceilings](/gg/execution-limits/). It is not the prebuilt interpreter
component failing to compile, which is an artifact defect that ends the session.

A compiler that could not finish is gg's, so the model reads nothing, no ceiling
counts it, and the run ends on the terms in
[gg's own defects](/gg/execution-limits/#a-compiler-that-could-not-finish).

A third failure is gg's own too. A source a language parsed and accepted, and
then could not lower into what the guest runs, is a lowering failure: the
transform over the accepted tree failed, or the surface gg generated for the
model to write against was itself rejected. It ends the run on the same terms. A
model is never asked to rewrite a program gg accepted.

The same split holds on the other thing gg compiles. A code skill or code memory
goes through the same prepare step: a rejection hands the author's diagnostic
back on the read, and a compiler that could not finish ends the run with the
crash detail on the operator's stream.

## Per-agent compiler isolation

The rule is that what a preparation returns is a function of that preparation's
input alone. Nothing a language compiles with may be reachable from another
preparation running at the same time.

Several preparations are in flight at once routinely: language is resolved per
agent, agents run in parallel up to `limits.maxParallel` (16 by default), each
turn may chain up to four programs, and each of those may compile modules
beside its own program. Every one of them happens in the same process.

A language arranges none of that itself. `prepare_program` and `prepare_module`
are each handed a `PrepareContext`, minted per preparation by the sandbox and by
nothing else, and it hands out the only ground the seam offers.

| Need | The sanctioned answer |
| --- | --- |
| Somewhere to put files while compiling | `context.workspace()`, created fresh per preparation and removed when it ends |
| Somewhere for a compiler's artifacts | `workspace.output()`, inside that same private tree |
| Running a compiler | `context.compiler(program)`, with the working directory, `HOME`, `TMPDIR` and the `XDG_*` roots inside that tree, plus the timeout, the kill and the reap |
| A long-lived compiler instance | `CompilerPool::checkout`, which lends an instance exclusively |
| A long-lived compiler process to pool | `daemon(program)`, started on a private tree of its own and spoken to one request at a time |
| Toolchain inputs too big to unpack per preparation | `shared_toolchain_dir(key)` with `place` or `place_tree` |

The environment redirection is what a toolchain benefits from without its
language having thought about it. A compiler that writes to `output/`, to
`~/.cache/<toolchain>` or to `$TMPDIR` lands inside the private tree. Departing
from it takes naming an absolute path somewhere else on purpose.

A shared toolchain directory is the one sanctioned exception to the private
tree, and it holds under one discipline: the key folds in everything that could
change the bytes, files are written by rename, and everything placed is
read-only from then on.

### The isolation gate

The isolation gate drives every registered language's program step and module
step sixteen at a time, each with a distinguishable marker carried inside a
call's argument. Each input is prepared alone first, so an input that fails on
its own account is reported as a baseline failure and the concurrent run is
abandoned. Under concurrency, every result must satisfy three checks: it
prepared, it carries its own marker, and it carries no other preparation's
marker. Alongside them the gate reports any workspace path handed to more than
one preparation.

That is the whole of the guarantee. The gate compares markers, not artifacts:
what a preparation produced alone is discarded once the baseline has passed.
The remaining paths are closed by the seam's own structure. A workspace is a
private tree keyed on the process id and a monotonic counter, created with
`create_dir` so a collision is a loud error, with the environment redirected
into it and the tree removed on drop.

An arm may make its artifact more readable for the marker search, through
`isolation_readable`, and may never hide, mask or summarise any part of it. Its
only implementor is C#, whose artifact is a base64-encoded IL assembly that
would otherwise carry no findable marker.

Two further gates hold a language to the rule. The isolation gate is generic
over a preparation rather than over a language, so its tests point it at four
deliberately broken preparations: a shared output tree, a shared build strategy,
a memoised compile and a cache keyed on something other than the program. It
must catch each, and must pass the two correct ones beside them. A source-level
gate refuses `Command::new`, `process::Command`, `env::temp_dir` and `TempDir`
anywhere under `crates/gg/src/sandbox/language/` except the seam's own
`compile.rs`.

Preparation runs on a blocking task, so a slow compiler holds up neither the
loop nor any sibling agent. The hazard this guards is shared mutable state.

## Diagnostic bounds

Nothing downstream of an arm shortens a diagnostic. `PrepareError::Compile`
carries the arm's string, `CodeFeedback::compiler` is built straight from it,
and the next request to the model carries it verbatim, as does every request
after while the turn stays in the transcript. The size of a compiler's opinion
is therefore decided in exactly one place, the arm that renders it, and the
shared bound in `sandbox/language/diagnostics.rs` is what the arms decide it
with.

Two helpers cover the two shapes an arm holds its diagnostics in.

- `capped` bounds a list of separately rendered diagnostics, the shape an arm
  has when its compiler reports structure. It folds byte-identical renderings,
  keeps the first `shown` survivors in first-seen order, and trims nothing.
- `capped_lines` bounds a compiler's own text in place, the shape an arm has
  when a diagnostic is a header line followed by an excerpt and a caret. The
  caller decides which lines open a group. Whatever precedes the first opening
  line is a preamble and is always kept, and text with no opening line is
  returned unchanged. Kept text is never re-wrapped, re-indented or trimmed.

Both close with a line counting what was dropped, so a model that needs the rest
can tell there is a rest and how much of one. Each arm names its own `shown`
constant beside the compiler it measured, and the arms using these helpers set
it to eight. C++ keeps its own bound, because a `note:` on that arm is
frequently the diagnostic rather than context: it keeps four errors with three
notes apiece and exempts any diagnostic naming a file somebody authored, at any
depth.

Three arms need no bound. Ruby's Opal driver reports a single thrown
`SyntaxError`, Python runs no checker on the prepare path, and JavaScript
delegates its whole prepare step to TypeScript's parse path.

Two rules govern what the bound may touch. Both failures gg reports to the
operator alone, and they are bounded differently because their content is
different.

- A lowering failure is bounded. It carries a whole compiler's opinion of gg's
  generated surface, which a broken codegen repeats once per declaration, and the
  run's `error` stream and the fault diagnostic beside it carry that sentence
  whole. The first few diagnostics say which codegen wrote them, and the closing
  count keeps the total honest.
- A toolchain failure is not bounded. What it carries is the exit status, the
  signal and the tail of the compiler's stderr, which the arm has already
  trimmed to the size a crash report needs.

Bounding never moves a failure between the two bands. An arm decides the band on
the whole rendering before the cap runs, so a diagnostic the cap dropped cannot
turn a rejected program into a toolchain failure.
