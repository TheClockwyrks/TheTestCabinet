---
title: "Compilation and diagnostics"
---

A program language turns a model's reply into something its guest can evaluate,
and that step is allowed to spend real time. This page states what it costs, how
the cost is recorded, the two ways it fails, what it may do to the bytes it was
handed, the isolation every language honours while it runs, and how much of a
compiler's output reaches the model.

## Checkers

Every language declares a checker: the name its own users give the thing that
judges a program, or none for a language whose prepare step invokes no compiler.
The answer is required, and `prepare_compiles` is derived from it so the two can
never disagree.

| Arm        | Checker   |
| ---------- | --------- |
| TypeScript | `tsc`     |
| JavaScript | none      |
| Python     | none      |
| Ruby       | `opal`    |
| PureScript | `purs`    |
| Java       | `javac`   |
| Kotlin     | `kotlinc` |
| Rust       | `rustc`   |
| Swift      | `swiftc`  |
| C++        | `clang++` |
| C#         | `csc`     |

An arm that names a checker has it interpolated into the system prompt, so a
model told its program is checked is told by what. What the prompt states is
that the program is compiled, rather than that its types are checked: `tsc`
checks types and `opal` checks grammar, and both are checkers. The same answer
decides whether the sandbox times the preparation.

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

### Self-contained toolchains

A toolchain carries every shared library the run image does not supply. The
same tree is copied to the same absolute path into every `-gg` variant, and no
two of those images hold the same set of libraries: they are built over two
different parents, a dozen of them install packages of their own on top of the
shared base, and each package arrives with its whole dependency closure. What an
arm reads out of an image is decided by that image's package closure rather than
by anything the arm installed, so a dependency an image happens to satisfy counts
as unsatisfied.

An installer with no self-contained distribution to ship walks the transitive
ELF closure of the binaries it keeps, places what the image does not supply
under `lib/` inside the toolchain's own root, and resolves each library from its
distribution's own package index rather than from a version written into the
script. The arm names that directory on the loader path of every compiler it
spawns. Where the tree's own binaries carry an rpath into that directory the
loader finds it without a variable, and the closure is walked to decide the list
all the same.

What proves a toolchain is a compile, run in the image the toolchain will run
in. A library loaded by `dlopen` appears in no ELF header, so a link check
reports a complete closure over a binary that aborts at start-up, which is the
shape .NET's globalization libraries have. A builder stage installs its own
packages and exports the tree without them, so a compile that succeeds there
reports on the environment that assembled the tree rather than on the one it
runs in. [`gg selfcheck`](/gg/languages/selfcheck/) is where the question is
settled.

A vendored library is a floor and not an override, which is why that check is
per image rather than once. It guarantees the compiler starts where the image
supplies nothing. Where the image supplies its own copy of the same library, the
loader may well answer with that one — a runtime that probes versioned sonames
from newest downwards finds a newer system copy before it reaches the vendored
one, whatever the loader path says. So an arm is self-contained in the sense
that no image can leave it unable to start, not in the sense that every image
gives it the same library.

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
[skill](/gg/skills/) or [memory](/gg/memories/) the turn was first to use on its
agent, and each on-use script that first use prepared. A module is prepared once
per agent, on its first use there, and that use happens inside a call the program
made, after the sandbox has taken its own reading. Folding those in keeps a
skill-heavy run from reporting less than it spent. A later turn's figure covers
that turn's response, since the modules already in scope were compiled at the
reads that loaded them.

An on-use script is prepared once per agent, by the first use, so that its author
gets a located diagnostic there. Every use after it runs the prepared form, so a
repeat use costs a run and no compiler.

The figure is reported for the turn whose program the compiler rejected too. A
compile that spent four seconds refusing a program spent them.

## Preparation failures

A language reports the two failures as different values, and gg keeps them apart
from there to the run record.

|                                   | What happened                                                                                | What the model is told                                                           | How the turn is recorded                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The compiler rejected the program | It read the reply whole and found a type error, a borrow error, a name that does not resolve | a `Compiler error` band carrying the compiler's own diagnostics and nothing else | one of the `transpile` error types, under the `transpile` base kind: the model's to fix |
| The compiler could not finish     | It crashed, its own timeout killed it, or the binary is missing from the image               | nothing                                                                          | a fatal turn, and the run ends under `internal_error`                                   |

Routing a compiler's crash into the `Compiler error` band is the failure this
split exists to prevent. The model would read that its program did not compile
over a program nothing read, and spend its next turn rewriting something that
was never wrong.

A rejected program arrives as one of three bands, each with its own error type:
`transpile_syntax`, `transpile_compile` and `transpile_unsupported`. It is
recoverable, and the next turn's program may compile. It is an error turn and
counts against the run's [error ceilings](/gg/execution-limits/). It is not the
prebuilt interpreter component failing to compile, which is an artifact defect
that ends the session.

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
back on the use, and a compiler that could not finish ends the run with the
crash detail on the operator's stream.

A module is compiled at the read that binds it, so an arm rebuilding one beside
a program is compiling a source it already accepted. A rebuild the compiler
refuses is a lowering failure naming the binding, whatever band the compiler's
own diagnostic would otherwise fall in. The author reads that diagnostic on the
read that loaded the module; the model that wrote the program reads nothing,
because the file the diagnostic names is one it did not write.

A gate holds every arm to that. It hands each arm's program step a module the
arm's own compiler refuses and no build is recorded for, and reads the band
back, so an arm that files a rebuild's diagnostic against the model fails rather
than passing quietly. An arm that compiles no module beside a program says so in
the same table.

## Authorship

The bytes a language compiles are the bytes it was handed. A preparation writes
no prologue, no epilogue, no entry point and no import around a model's reply,
and it reaches a line number through a source map or reports none. Making the
SDK available to a compiler is packaging and is allowed, while a name a program
can write with no line the model wrote is not. The
[invariants](/gg/responses-as-code/invariants/) state the rule, and this section
states how it is held.

The authorship gate drives every registered language's program step and module
step with a whole program of that language's own, and reports what the
preparation did to the bytes: kept them, wrapped them in something larger, or
rewrote them. It reads what the preparation wrote into the compile workspace and
the source it handed the guest, and takes the least faithful relation either of
them has to what it was given. What a preparation does other than keep its bytes
is recorded in a table the gate holds it to, so an arm that starts keeping them
fails until its row is deleted, and an arm that stops fails because nothing
records it. Every arm keeps the bytes of a model's reply, and every row the
table still carries is a module half, which the invariants put outside the
rule.

A byte comparison leaves three shapes to each arm's own preparation step: an SDK
reaching a program through a compiler flag, a second compilation unit that names
the model's, and a transform that fires only on a construct gg's own generated
program does not contain.

## Per-agent compiler isolation

The rule is that what a preparation returns is a function of that preparation's
input alone. Nothing a language compiles with may be reachable from another
agent's preparation.

Several preparations are in flight at once routinely: language is resolved per
agent, agents run in parallel up to `limits.maxParallel`, each turn may chain up
to four programs, and each of those may compile modules beside its own program.
Every one of them happens in the same process. One agent's preparations are
sequential, since a turn's chained programs, the modules its reads load and the
on-use scripts they queue all run in order on one blocking task.

### The compile workspace

A compile workspace is a private tree created when an agent starts and held for
that agent's lifetime, so the agent's preparations share one tree and two agents
never share one. It carries four directories: the working directory a compiler
runs in, the directory a compiler is told to write artifacts into, the `HOME`
that roots the `XDG_*` variables, and the `TMPDIR`.

A preparation is handed the artifact and temporary directories empty, and the
working directory holding nothing but the two bands named below. What a compiler
reads, and what a language reads back out afterwards, is therefore this
response's own sources and this response's own build output. The redirected
`HOME` is kept across an agent's preparations, so a toolchain's own cache warms
once per agent.

Two bands inside the working directory outlive a preparation.

- The **loaded-module band**, `modules/<key>`, holds what each loaded code
  module was compiled to. The seam owns it and clears one key's directory when
  that key is loaded.
- The entries a language declares in `persistent_work`, for a toolchain that
  owns its own build tree and keys its incremental work on it. `purs` is the one
  declarer: its staged library set and its output directory are laid out once
  for the agent rather than once per preparation.

Everything else under the working directory is removed by name, so a file a
compiler wrote that no language registered goes with the ones a language wrote.

What a staging lays out is named in the call that lays it out, and the tree
keeps it from then on. That is what ties the two halves of a staged tree
together: a language declares the same entries in `persistent_work` and passes
them to `stage_once`, so a tree laid out once for the agent cannot be swept by
the next preparation.

A tree serves one preparation at a time. A preparation takes it when it first
asks for a workspace and holds it until it ends, so a second preparation of the
same agent waits rather than clearing the files the first is compiling.

The tree is created on first use, so a language that compiles nothing pays no
syscall for one, and it is removed when the agent's last hold on it is dropped.
Its name folds in the process id, the moment it was created and a monotonic
counter, so a tree left behind by a killed process cannot collide with a live
one.

A language arranges none of that itself. `prepare_program` and `prepare_module`
are each handed a `PrepareContext`, minted per preparation by the sandbox and by
nothing else, and it hands out the only ground the seam offers.

| Need                                               | The sanctioned answer                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Somewhere to put files while compiling             | `context.workspace()`, cleared of the previous preparation's files before this one writes                                                                 |
| Somewhere for a compiler's artifacts               | `workspace.output()`, inside that same private tree and cleared on the same terms                                                                         |
| Somewhere for a loaded module's build output       | `workspace.open_module(key)`, cleared when that key is loaded and kept for as long as it stays loaded                                                     |
| Running a compiler                                 | `context.compiler(program)`, with the working directory, `HOME`, `TMPDIR` and the `XDG_*` roots inside that tree, plus the timeout, the kill and the reap |
| A long-lived compiler instance                     | `CompilerPool::checkout`, which lends an instance exclusively                                                                                             |
| A long-lived compiler process to pool              | `daemon(program)`, started on a private tree of its own and spoken to one request at a time                                                               |
| Toolchain inputs too big to unpack per preparation | `shared_toolchain_dir(key)` with `place` or `place_tree`                                                                                                  |
| A tree a toolchain lays out once for the agent     | `workspace.stage_once`, together with a `persistent_work` entry naming it                                                                                 |

The environment redirection is what a toolchain benefits from without its
language having thought about it. A compiler that writes to `output/`, to
`~/.cache/<toolchain>` or to `$TMPDIR` lands inside the private tree. Departing
from it takes naming an absolute path somewhere else on purpose.

A shared toolchain directory is the one sanctioned exception to the private
tree, and it holds under one discipline: the key folds in everything that could
change the bytes, files are written by rename, and everything placed is
read-only from then on.

### Compiling each source once

A response is compiled once: each preparation writes the program to one fixed
name in the working directory, so a submitted program stays out of every later
compilation, including when one turn submits several programs.

A loaded code module is compiled once per session, when the read that binds it
loads it. `prepare_module` is handed the binding key, so the module is compiled
under the name a program will really reach it by, which is the crate, class,
package, Swift module, C++ module, assembly or PureScript module named for the
key. Its build output is written into that key's directory in the loaded-module
band. A program's preparation names that build output the way it names gg's own
SDK, and compiles the response alone.

A module is compiled against gg's surface and the arm's library set, so it sees
those and its own declarations. One loaded module reaches another the way any
other caller does, by being written to take what it needs as an argument.

Reading the same skill or memory again costs no compiler. A read is a use and a
use is answered every time, but a key already holding those bytes is answered
from the preparation that produced them, so a skill an agent reaches for on
every turn is one compile for the session. The exports the repeat read reports
are that preparation's, so the documentation a use opens describes the module
that is bound.

A build is recorded against the source it was built from. A program's
preparation rebuilds a module when the recorded source differs from the one it
was handed, or when an artifact the build produced is no longer on disk, so a
rewritten memory re-loaded under the same key can never link the version it
replaced.

Turn cost therefore stays flat as an agent's loaded set grows: what a turn's
`compileMs` covers is the response, and the modules were charged to the turn
that read them.

### The isolation gate

The isolation gate drives every registered language's program step and module
step in two phases, each input carrying a distinguishable marker inside a call's
argument.

The sequential phase prepares sixteen inputs one after another in a single
agent's compile workspace. It asserts three things: each input prepared, each
artifact carries its own marker and no earlier preparation's, and every one of
the sixteen was handed the same workspace path. An input that fails to prepare
here is failing on its own account rather than under contention, so it is
reported as a baseline failure and the concurrent phase is abandoned.

The concurrent phase drives sixteen agents at once, each with a compile
workspace of its own and one preparation in it. It asserts the same three things
per agent: each preparation succeeded, each artifact carries its own marker, and
each artifact carries no other agent's marker. Alongside them the gate reports
any workspace path handed to more than one agent.

A third gate counts. It loads code modules into one agent and then prepares
program after program in that agent's workspace, and requires the number of
module builds that workspace has recorded after the last program to be the
number it had recorded after the loads, so a module compile that came back per
turn fails rather than only costing. Beside the count it takes a per-file
reading of everything the read left standing, the loaded-module band and the
arm's declared entries both, so a rebuild that registered nothing is caught by
the file it rewrote. An arm that names a checker is also held to leaving that
read's work somewhere a turn can reach, either as a recorded build or as the
compiled source it hands back, so an arm that had abandoned the band cannot pass
on a count of zero.

A fourth counts through the loop rather than through the seam. It drives a real
session whose turns read one code skill twice and call it, and requires the
number of preparations that session's tree was handed to be one per program plus
one for the read that loaded the module.

That is the whole of the guarantee. The gate compares markers, not artifacts.
The remaining paths are closed by the seam's own structure: the workspace is a
private tree created with `create_dir` so a collision is a loud error, with the
environment redirected into it, and a preparation reaches it only through the
context the sandbox minted for that one call.

An arm may make its artifact more readable for the marker search, through
`isolation_readable`, and may never hide, mask or summarise any part of it. Its
only implementor is C#, whose artifact is a base64-encoded IL assembly that
would otherwise carry no findable marker.

Two further gates hold a language to the rule. The isolation gate is generic
over a preparation rather than over a language, so its tests point it at five
deliberately broken preparations: a shared output tree, a shared build strategy,
a memoised compile, a cache keyed on something other than the program, and a
compiler that keeps its output where a preparation's reset does not reach. It
must catch each, and must pass the two correct ones beside them. A source-level
gate refuses `Command::new`, `process::Command`, `env::temp_dir` and `TempDir`
anywhere under `crates/gg/src/sandbox/language/` except the seam's own
`compile.rs`.

Preparation runs on a blocking task, so a slow compiler holds up neither the
loop nor any sibling agent. The hazard this guards is shared mutable state.

## Diagnostic bounds

A bound shortens a diagnostic by deleting from it, so what a model reads is a
subsequence of what the compiler wrote and each bound closes by counting what it
dropped. Rewording a compiler's own account of a program is the one edit no
bound makes.

Nothing downstream of an arm shortens a diagnostic. `PrepareError::Compile`
carries the arm's string, `CodeFeedback::compiler` is built straight from it,
and the next request to the model carries it verbatim, as does every request
after while the turn stays in the transcript. The size of a compiler's opinion
is therefore decided in exactly one place, the arm that renders it, and the
shared bound in `sandbox/language/diagnostics.rs` is what the arms decide it
with.

A compile failure carries supporting material beside the diagnostic, after a
blank line, so the compiler's own first line stays the message's first line.
Every arm holds that material to one bound, `diagnostics::SUPPORTING`, of 1024
bytes of UTF-8, so what a rejection costs the next turn is comparable across
arms. An arm whose catalogue declares no library set is answered with the
diagnostic alone.

The material is drawn from the arm's library set, which is what the compiler
measured the program against and the reason no [prompt](/gg/prompts/) carries a
package inventory. Where the diagnostic names imports the compiler could not
resolve, the material is the modules of that set which match those names. Where
it names none, or none of them match, the material is the whole set, because a
program that named nothing recognisable is the one with most to learn from the
inventory.

Each arm reads the unresolved names out of its own compiler's wording, through
`ProgramLanguage::unresolved_imports`, and one shared rule decides what a name
matches: a module equal to it, a module it extends or that extends it at a path
separator, or a module whose last path segment is within two edits of its own.
An arm whose compiler names an unresolved import in no wording of its own
answers with an empty list, and is answered with the whole set.

The bound drops whole module names off the end and closes with the count line
the diagnostic bounds close with, so a set it cut is counted rather than quietly
shortened.

Two gates hold the arms to this. One walks the registry and holds every arm that
declares a library set to the bound, in the largest case its own catalogue can
produce. The other drives a program naming an unresolved import through each
arm's real compiler and asserts the arm recovered the name the program wrote,
so a compiler that rewords its diagnostic fails here rather than silently
answering every rejection with a whole inventory.

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
`SyntaxError`, and neither Python nor JavaScript reads a program on the host at
all: each hands the reply to its guest, which is the first thing to parse it.

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
