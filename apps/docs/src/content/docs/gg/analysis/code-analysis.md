---
title: "Code analysis"
---

Code analysis is a deterministic, execute-nothing static read of the source tree
a run produced. It measures how the model built what it built: size and shape,
per-function complexity, the module import graph, the exported API surface,
per-language discipline, and copy-paste.

The input is the collected produced tree, the `implementation/` directory a
run's `/work` is copied into. No build, no package manager, no script. The only
subprocess the analyzer starts is a read-only `git`, to resolve which files the
model wrote.

## The authored set

Which files the model wrote, as opposed to which were seeded into the workspace
before it started, is the analysis's most important correctness question.
Getting it wrong pollutes every figure differently per test case, which breaks
the cross-case comparison the analysis exists for.

The seeder computes the exact seed commit and records it on the run record. The
authored set resolves by a ladder, and the rung that answered is recorded on the
result:

| Basis | Condition | Claim |
| --- | --- | --- |
| Seed commit | The record carries a seed commit and it is present in the tree | Exact |
| Root commit | Exactly one root commit, and its message is the seeding message | Inferred |
| All files | Neither check passed | Degraded: seeded scaffolding is included |

The message check on the middle rung is what distinguishes a seed root from a
model-created one. Taking the root commit unconditionally would fail in the
worst direction: a model that amends, squashes, rebases or reinitialises the
repository produces a root commit whose tree contains its own work, so the
authored set would come back empty and the run would report near-zero authored
code stamped as an exact measurement. A tree that fails both checks lands on the
degraded rung, which says so.

The set is computed with three non-mutating git invocations: list the seed tree,
diff the seed against the working tree so uncommitted edits count, and list
untracked files as a cross-check.

## The walk

The walk honours `.gitignore`, `.git/info/exclude` and nested ignore files, so a
case's own declaration of where its build output goes is what removes it. The
ignore files are content of the tree being measured, which keeps the walk
deterministic; a global `core.excludesFile` and any ignore file in a parent of
the tree are machine state and are switched off explicitly.

A hardcoded floor applies on top, and everything it removes is counted:
dependency and vendored trees, the build-output directory names the validator
looks for, minified and generated files, binaries, and files over 8 MiB.

A file too large to parse is still counted for size. A 300 KB god-file is
precisely the interesting case, and dropping it entirely would bias every size
metric against the worst outcomes.

Because the walk honours the ignore files, gg's session-capture journal is
excluded through the same mechanism that hides it from the run, and can never
pollute an analysis.

## Languages

TypeScript, TSX, JSX and JavaScript are parsed by one front end; Rust by
another. `Cargo.toml` and `package.json` are read as manifests, to discover
crate roots and name external packages. Everything else, including JSON,
Markdown, CSS and shaders, is counted for size only.

HTML gets one extra pass, for `<script src>` targets. Every end-to-end case is a
bundler project whose real entry point is named from HTML and is otherwise
invisible to an import walk, and without the pass the whole application reads as
orphaned.

## The metrics

### Size and shape

Beyond the totals, three shape metrics distinguish a modularised tree from one
god-file surrounded by stubs:

- The Gini coefficient of code lines across files. Zero means every file is the
  same size; approaching one means a single file holds everything.
- Root share, the fraction of code living directly in the source root. A model
  that never created a subdirectory scores one.
- Directory depth and mean files per directory.

The tail is reported too: the largest, median and 90th-percentile file, and how
many files exceed 500 and 1000 code lines.

### Per-function complexity

Both front ends feed one scorer, which owns the definition. Paired fixture tests
assert that the same control-flow shape scores identically in each language.

Cyclomatic complexity is McCabe: one, plus each branching construct, each
non-default `case` or match arm, each loop, each `catch`, each short-circuiting
or nullish operator, each conditional expression, each optional chain, and
Rust's `?`.

Cognitive complexity is Sonar: every branching construct scores one plus the
current nesting depth, `else` scores a flat one, and a boolean-operator sequence
scores once however long it is. It sits beside cyclomatic complexity because
cyclomatic is blind to nesting, and nesting is what makes generated code
unreadable.

A `switch` or `match` carries the cognitive weight on the construct and a
cyclomatic point on each non-default arm. Maximum nesting, parameter count, exit
count and function length are also folded per function.

### The module graph

One node per authored source file, edges from resolved intra-tree imports. Rust
crate roots come from parsing manifests directly rather than from shelling out
to the package manager, which would resolve the dependency graph and therefore
need the registry.

- Import cycles, as strongly connected components. The clearest signal that
  layering was not considered, and invisible to every other metric here.
- Instability, outgoing over total coupling, averaged. This separates a codebase
  of leaves from a codebase of tangles.
- Fan-out and fan-in, mean and maximum. A file importing thirty others is a
  god-module by another name.
- Orphans: files nothing imports and no entry point names. The definition holds
  in a library as well as in a bundler project, which transitive reachability
  does not: a library has no entry point to be reachable from.
- Dependency depth and external package count.

### API surface and type discipline

Exports, exports per module, and unreferenced exports.

TypeScript contributes `any` density, the `unknown` count beside it, suppression
comments, non-null assertions, assertion casts, and the annotated parameter and
return ratios. The exported annotated ratio is reported separately, because it
is the API-boundary version. Type declarations per thousand lines answer whether
the model modelled its domain or passed object literals around.

Rust contributes `unsafe` items, `unwrap` and `expect` density, panic sites,
`todo!` and `unimplemented!` macros, suppressed lints, clone density, public
ratio, traits and generic items. The pairing is deliberate: `unwrap` is the
analogue of `any`, and clone density is a proxy for fighting the borrow checker
rather than designing ownership.

### Duplication

A normalised sliding-window clone detector over six consecutive code lines, one
SHA-256 hash pass, reporting the cloned line ratio, the clone group count and
the largest clone. A window must carry at least 60 normalised characters to
count, so six lines of closing braces are not a clone group. This is the only
metric that catches a model copy-pasting the enemy AI five times.

Changing the window length changes what duplication means, so it requires an
analyzer version bump.

### Tests

Test files, test functions and test code lines are static counts of the test
code the model chose to write, computed by parsing and executing nothing. They
are an authorship signal and must never be presented as coverage.

## Two tiers

A bounded typed summary rides on the run record. Every leaf is a number, a
boolean or a small enum, roughly ninety of them, so the whole block flattens
into the [query language](/gg/analysis/query-language/)'s `code.*` namespace
with no per-metric code. It is bounded because the record is deserialized on
every run listing.

A full document is written to the run tree as `code-analysis.json.gz` at the run
root, mirrored into the backend store and served per run. It carries the
unbounded detail: every file, every symbol with its complexity and reference
count, every import edge, every cycle, every clone group. A consumer holding the
document never needs the record.

The summary is a typed struct rather than an open map of names to numbers. An
open map buys a new metric with no per-metric code change, which the document
model already provides at the query layer, since a typed block flattens to the
same dotted keys. What it costs is a JSON Schema, a TypeScript type, units,
polarity, the `approximate` flag, and the test that fails when a catalogued path
stops resolving. Three of the load-bearing fields are not numbers anyway: the
truncation flag is a boolean, and the authored basis, tree basis and language
are enums.

Each numeric and boolean leaf has a catalog entry carrying its label, unit,
family, polarity and `approximate` flag. The field sidebar, the chart axis, the
symbol-table header and this page all read that one entry. A path in the catalog
must resolve against a serialized summary, so renaming a field fails the suite.

## Where it runs

The analyzer is a post-run stage: on the host, after the tree is collected and
before validation, outside the run's runtime cap.

The run's timer is already stopped and the cap bounds the harness session and
each in-container setup step, each on its own, so the analysis costs the test
case nothing. The validator runs the case's
install and build commands in the produced tree itself, so after validation the
tree carries build output, a rewritten lockfile and toolchain caches, in amounts
that vary with how far validation got. Running before it is what makes
`treeBasis: preValidation` literally true, and the ordering is asserted end to
end.

A canceled run is analysed like any other. Validation is skipped for a
cancellation because it is fresh work that judges output; analysis reads bytes
that already exist and renders no verdict.

The stage runs for every harness, since analysing a directory involves no
harness-specific work. A run whose tree never reached the host is not analysed
at all, and its record carries no summary.

## Offline analysis

The analyzer is a library with a one-way dependency on the core contract.
[`tcab analyze <dir>`](/components/cli/overview/#commands) points the same pass
at any tree on disk and prints the result, with no run, no container, no backend
and no credentials.

This is what makes the analyzer reviewable: a figure a run reports can be
reproduced and questioned by anyone holding the tree, and a change to the
analyzer can be judged against real trees before it is stamped onto a corpus.

`--seed-commit` supplies the exact top rung of the authored ladder when the
directory is a seeded run workspace. `--tree-basis` defaults to
`post-validation`, which is the only honest answer for a directory the command
was pointed at.

## Determinism and caps

The analysis is a pure function of the tree's bytes. There is no wall-clock
budget anywhere in it: a time cutoff would make the output a function of machine
speed and load, so the same tree analysed in a loaded pod and again on a quiet
host would yield two different figure sets under the same analyzer version.

Every bound is therefore content-derived, and files are visited in sorted order
so that which files a cap drops is a function of the tree:

| Bound | Value |
| --- | --- |
| Files visited | 20 000 |
| Bytes parsed per file | 128 KiB |
| Bytes parsed across the tree | 64 MiB |
| Functions scored | 200 000 |
| Bracket nesting a front end will parse | 200 |

The first, third and fourth are tree-wide, and hitting one marks the result
truncated and records which cap fired. Aggregation excludes a truncated result
with the filter `not code.notes.truncated`, since a partial figure that looks
complete is worse than a missing one.

The per-file bounds do not mark a result truncated, because they fire on
ordinary trees and a flag that is usually true excludes nothing. A source file
the parse guard turned away is counted for size and recorded under
`code.notes.filesRefused`, so `code.notes.filesRefused = 0` is the filter for a
tree whose every source file was read. Whether any ignore file applied is
recorded too, so an implausibly small measurement is explicable.

## Approximation

Everything measured is syntactic. Neither front end performs type inference, so
there is no implicit-`any` detection and no judgement about whether a cast is
sound. For the question being asked, whether the model annotated its own API,
that definition keeps the two languages symmetric.

Cross-file reference counting is approximate in both languages. Every edge is
resolved by rewriting a specifier into a candidate path and asking whether the
tree holds it, which covers relative and extensionless imports, `index` barrels,
TypeScript's `.js`-for-`.ts` convention and Rust's `mod.rs`/`name.rs` pair. It
cannot see a dynamic `import()`, a path alias declared in `tsconfig.json`, or
anything a bundler config rewires.

Approximation is carried as the `approximate` flag on the metric definition
rather than as prose, so every surface that renders such a figure labels it the
same way.

## Publishing and the analyzer version

Every result is stamped with the analyzer generation that computed it, lifted
onto a column of the run row so a corpus can be sliced in SQL rather than by
deserializing every record. The generation makes a mixed corpus visible rather
than a silent step change that reads as a model getting worse, and it is what
licenses improving the analyzer at all.

Bump the generation when an existing metric's definition changes, or when any
cap changes, since a cap change decides which files contribute. A purely
additive metric needs no bump; older records simply lack it.

Three ranking-relevant figures are lifted onto a run's public summary card: code
lines, the size Gini and mean cognitive complexity. An ordering can then be
computed from the bounded summary set without loading every record. They travel
with the analyzer generation, the authored basis, the tree basis and the
truncation flag, because two analysed runs are comparable only when those agree.

The full document is published as its own object with the generation in its key,
`media/runs/<id>/code-analysis/v<gen>.json`. A snapshot refresh that finds the
object already in the bucket references it without re-uploading, and a
re-analysis under a newer generation mints a new object rather than overwriting
figures a published snapshot still points at. The snapshot builder scrubs the
document on its way out, since model-written source contains hard-coded
credentials often enough for redaction to exist.

An absent figure means the run was never measured. Every surface that renders
one says so rather than drawing a zero, and an aggregate over `code.*` reports
its contributing count against the bucket size.

The historical corpus is not backfilled. An archived tree can only be read in
its post-validation state, carrying build output, a rewritten lockfile and
toolchain caches in amounts that differ per case and per run, so recomputing
figures from one would manufacture the incomparability the generation exists to
prevent. The corpus starts on the day the analyzer shipped and the column is
forward comparability only.

## Scoring and verdicts

No figure here influences a run's verdict, its review, or whether it publishes.
A run is judged on what it built. A metric definition carries a polarity only to
orient a sort and pick an arrow's direction, never to rank.
