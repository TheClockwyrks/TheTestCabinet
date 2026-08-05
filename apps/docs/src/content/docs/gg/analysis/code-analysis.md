---
title: "Code analysis"
---

**Code analysis** is a deterministic, execute-nothing static read of the source
tree every run already collects. It answers the question no other measurement in
The Test Cabinet touches: not what the run cost or whether it worked, but **how
the model built it**.

Nothing in the repository computes a single figure over produced source today —
no line counts, no complexity, no module graph, no duplication. The
[validator](/components/core/validation/) runs only the case's install and build
commands; it never inspects what it built.

## What is measured, over what

The input is the collected produced tree — the `implementation/` directory every
run's `/work` is copied into.

### Which files did the model write?

This is the most important correctness question on the page, and getting it wrong
pollutes every figure **differently per test case**, silently breaking exactly the
cross-case comparison the analysis exists for.

Measuring the seeded scaffolding is the obvious hazard. The tempting fix — take the
tree's root commit as the seed — fails in the worst possible direction: if the
model amends, squashes, rebases, or runs a fresh `git init`, the root commit's tree
**contains the model's own work**. The seeded set swallows the authored files, the
modified set is empty, and the run reports near-zero authored code *stamped as an
exact measurement*.

Meanwhile the exact seed commit is **already computed** when the workspace is
seeded, and thrown away. So it is recorded on the run record, and the authored set
resolves by a ladder whose rung is itself recorded:

| Basis | Condition | Claim |
| --- | --- | --- |
| **Seed commit** | The record carries a seed commit and it is present in the tree | **Exact** |
| **Root commit** | Exactly one root commit, and its message is the seeding message | **Inferred** — for the historical corpus, which predates the recorded field |
| **All files** | Neither check passed | **Degraded** — seeded scaffolding is included |

The message check on the middle rung is not cosmetic: it is the only thing
distinguishing a seed root from a model-created one. A tree failing both checks
degrades loudly rather than reporting a confidently-wrong empty authored set.

The set is then computed with three **non-mutating** git invocations — list the
seed tree, diff the seed against the *working tree* (so uncommitted edits count),
and list untracked files as a cross-check. Nothing is staged, nothing is committed.
Reading repository metadata is not "executing the produced code."

### Which files are skipped

The walk honours **`.gitignore`**, `.git/info/exclude`, and nested ignore files,
rather than a hardcoded list of output directory names. A hardcoded list is both
too narrow — a model-configured output directory, a framework cache — and
unnecessary, because a case's own ignore file already declares where its build
output goes. This is deterministic (the ignore files are content of the tree being
measured) and it tracks whatever the case actually declares.

A hardcoded floor applies on top, and everything it removes is **counted**, never
silently dropped: dependency and vendored trees, the build-output directory names
the validator itself looks for, minified and generated files, binaries, and
oversized files.

One entry in that floor is a deliberate reversal. A file too large to **parse** is
still **counted for size**. A 300 KB god-file is precisely the interesting case;
dropping it entirely would bias every size metric against the worst outcomes.

A free consequence of honouring the ignore files: the [capture
journal](/gg/analysis/session-records/#the-journal-must-be-invisible-to-the-run-it-observes)
is excluded at seed time through the same mechanism, so it can never pollute a code
analysis. No coordination between the two features was needed.

### Languages

TypeScript, JSX, and JavaScript through one front end; Rust through another.
Everything else — JSON, Markdown, CSS, shaders — is counted for size only. HTML
gets one extra pass, because every end-to-end case is a bundler project whose real
entry point is named from HTML and is otherwise invisible to an import walk.

## The metrics

### Size and shape

Beyond the obvious totals, three shape metrics carry most of the signal, because
they are what distinguish "modularised" from "one god-file and forty stubs":

- **The Gini coefficient of code lines across files.** Zero means every file is the
  same size; approaching one means a single file holds everything. One number that
  answers "did the model split the work?", and it costs a sort.
- **Root share** — the fraction of code living directly in the source root. A model
  that never created a subdirectory scores one.
- **Directory depth and files per directory.**

Plus the tail: files over 500 and over 1000 lines, and the code-line distribution.

### Per-function complexity

Both languages, from a **single normative definition** reproduced on this page and
enforced by paired fixture tests that assert the same control-flow shape scores
identically in each.

- **Cyclomatic** — McCabe: one plus each branching construct, each non-default case
  or match arm, each loop, each catch, each short-circuiting or nullish operator,
  each conditional expression, each optional chain, and Rust's `?`.
- **Cognitive** — Sonar: every branching construct scores one **plus the current
  nesting depth**; `else` scores a flat one; a boolean-operator sequence scores
  once. Included deliberately alongside cyclomatic, which is famously blind to
  nesting — and nesting is precisely what makes generated code unreadable.
- **Max nesting, parameter count, exit count.**

### The module graph

One node per authored source file, edges from resolved intra-tree imports. Rust
crate roots are discovered by parsing manifests directly — never by shelling out to
the package manager, which resolves the dependency graph and therefore needs the
registry.

The graph metrics are where the "did the model think about layering?" signal lives:

- **Import cycles** — strongly connected components. The clearest "did not think
  about layering" signal there is, and **invisible to every other metric**.
- **Instability** — outgoing over total coupling, averaged. Distinguishes a
  codebase of leaves from a codebase of tangles.
- **Fan-out and fan-in distributions** — a file importing thirty others is a
  god-module by another name.
- **Orphans** — files nothing imports and no entry point declares: dead modules the
  model wrote and abandoned. Deliberately *not* transitive reachability, which
  collapses on a library: one stray fixture HTML naming one module makes every other
  module unreachable, and a healthy tree reports almost all of itself as dead.
- **Dependency depth** and **external package count**.

### API surface and type discipline

Exports, exports per module, and **unreferenced exports** (see the approximation
note below). For Rust, whether visibility was narrowed at all or everything is
public.

For TypeScript: `any` density, the honest `unknown` alternative, suppression
comments, non-null assertions, assertion casts, annotated parameter and return
ratios — and separately the **exported** annotated ratio, which is the
API-boundary version and the one that actually matters. Plus type declarations per
thousand lines: did the model model its domain, or pass object literals around?

For Rust: `unsafe`, `unwrap`/`expect` density (the Rust analogue of `any` —
papering over the type system), panic sites, `todo!` macros (holes in shipped
code), suppressed lints, clone density as a proxy for fighting the borrow checker
instead of designing ownership, and abstraction actually used.

### Duplication

A normalised sliding-window clone detector — one hash pass — reporting the cloned
line ratio, clone group count, and largest clone. This answers "did the model
abstract, or copy-paste the enemy AI five times?", and **no other metric here
catches it**.

## Two tiers, on purpose

- **A small typed summary** rides on the run record. Every leaf is a number or a
  boolean, so any of it is directly aggregable by the
  [query language](/gg/analysis/query-language/) under the `code.*` namespace.
  Bounded at roughly ninety-five scalars, because the record is deserialized on
  every run listing.
- **A full exploration document** is served per run and carries the unbounded
  detail: every file, every symbol with its complexity and reference count, every
  import edge, every cycle, every clone group. Same posture, and the same reason,
  as the [replay record](/gg/analysis/session-records/#serving-and-consuming).

### Why a typed struct and not an open bag

An open map of names to numbers buys exactly one thing — a new metric with no
per-metric code change — and the document model already provides that for free at
the *query* layer, because a typed block flattens to the same dotted keys a bag
would.

What it costs is decisive: no JSON Schema, no TypeScript type, no units, no
polarity, no `approximate` flag, and no CI gate that fails when a field is renamed
out from under a saved query. And three of the most load-bearing fields are **not
numbers** — the truncation flag is a boolean, and the authored basis, tree basis,
and language are enums. A bag would have forced a parallel typed block anyway.

A generic sink with exactly one producer is a typed field with extra steps.

## Where it runs, and when

On the host, **after collection and before validation**, outside the runtime cap.
Two independent reasons, and the second is the one that is easy to miss:

1. **The budget.** The run's timer is already stopped and the cap wraps only the
   harness session, so this costs the test case nothing — by construction rather
   than by policy. This is the shared
   [post-run stage](/gg/analysis/overview/#design-principles) the record assembly
   also uses.
2. **What is being measured.** The validator runs the case's install and build
   commands **in the produced tree itself**. After validation the tree carries build
   output, a rewritten lockfile, and toolchain caches — and carries *different
   amounts of them* depending on whether validation ran at all (a canceled run skips
   it) and how far it got. Measuring before it is the only way "what the model
   wrote" is literally true.

A consequence worth stating: **a canceled run is analysed too.** Validation is
skipped for a cancellation because it is fresh work that judges output; analysis is
neither — it reads bytes that already exist and renders no verdict. This matches
the established posture that killed runs keep their metrics.

A tree can only ever be re-read later in its **archived, post-validation** state, so
which state was measured is itself recorded and queryable, and a bucket spanning
both says so. That is also why there is no backfill: see
[below](#publishing-and-the-analyzer-version).

### Offline, against any directory

The analyzer is a library with a one-way dependency on the core, so nothing about
it needs a run. [`tcab analyze <dir>`](/components/cli/overview/#commands) points
the very same pass at any tree on disk and prints the result — no run, no
container, no backend, no credentials, and nothing executed in the tree it reads.

That is not a convenience wrapper; it is what makes the analyzer *reviewable*. A
figure a run reports can be reproduced, questioned and improved by anyone with the
tree, and a change to the analyzer can be judged against real trees — this
repository's own crates included — before it is stamped onto a corpus. The
`--seed-commit` flag supplies the exact top rung of the
[authored-set ladder](#which-files-did-the-model-write) when the directory *is* a
seeded run workspace; without it the whole tree is treated as authored, which is
the correct answer for an ordinary source tree and is stated on the report rather
than assumed.

## Deterministic means deterministic

The analysis is a pure function of the tree's bytes. That claim has teeth, and one
tempting feature had to be removed to keep it: **there is no wall-clock budget in
the record-producing path.**

A time cutoff would make the output a function of machine speed and load — the same
tree analysed in a loaded pod and re-analysed later on a quiet host would yield two
different figure sets, both stamped with the same analyzer version, which is
*precisely* the corruption the version field exists to make visible. A "analyse it
twice, assert equal" test would pass and prove nothing.

So every bound is **content-derived** and recorded alongside the figures: a file
count, a per-file parse size, a total parse size, a symbol budget. Files are visited
in sorted order, so *which* files a cap drops is deterministic too. Hitting a cap
marks the result **truncated**, and a truncated analysis is **excluded from
aggregation by default** — a partial figure that looks complete is worse than a
missing one. A wall-clock guard exists only in the operator tools, and its effect is
a hard abort producing no document at all, never a partial one.

## Approximation, stated as data

Two honesty requirements, both structural rather than prose.

**Everything here is syntactic.** Neither front end performs type inference. There
is no implicit-`any` detection and no "is this cast actually unsound." For the
question being asked — *did the model annotate its own API?* — that is arguably the
better definition, and it makes the two languages symmetric, which is what keeps a
cross-language comparison honest.

**Cross-file reference counting is approximate in both languages.** The TypeScript
semantic model resolves references within one program, so *all* cross-file
attribution rests on a hand-rolled resolver. It handles re-export barrels, aliased
re-exports, namespace member access, and HTML entry points — that last one being the
one that matters most for this corpus. It cannot see dynamic imports, computed
member access, or references that exist only in a bundler config. Rust's rule is
identical in spirit and labelled identically.

The label is a **field on the metric definition**, not a sentence in a doc. That
matters: it means the field sidebar, the chart axis, the symbol table header, and
this page all read one flag and cannot drift apart.

## Publishing and the analyzer version

Three ranking-relevant figures — **code lines**, the **size Gini**, and **mean
cognitive complexity** — are lifted onto every run's public summary card, so a "which
model writes the tightest code?" ordering can be computed from the bounded summary set
without loading every record. They travel with the analyzer generation, the authored and
tree basis, and the truncation flag, because two analysed runs are not automatically
comparable and a card carrying only numbers would let a list rank two incomparable ones
side by side with nothing to say so.

The full document is published as its own content-stable object with **the generation in
its key** (`media/runs/<id>/code-analysis/v2.json`), which does two jobs at once: a
snapshot refresh that finds it already in the bucket references it without re-reading or
re-uploading, so N refreshes upload it once; and a re-analysis under a newer generation
mints a *new* object rather than silently overwriting figures an already-published
snapshot still points at. It is **scrubbed** on its way out — model-written source
contains hard-coded credentials often enough that redaction exists at all, and a symbol
name or a file path is text like any other, and the snapshot builder redacts the per-run
document and only that document, so a sibling object that skipped the scrubber would
reach the open internet unredacted.

An **absent** figure is the common case and means *never measured*. Every surface that
renders one says so — the run log's CODE cell reads "not measured" rather than drawing a
zero, and an aggregate over `code.*` reports the contributing count against the bucket's
size. That is not politeness: with no backfill, a chart that quietly plots only
post-analyzer runs beside older ones reads as "these models wrote no code", which is a
false claim about the models rather than an honest one about the measurement.

Every result is stamped with the **analyzer version** — the generation of the
analyzer that computed it — lifted onto a column of the run row so it can be sliced
in SQL rather than by deserializing every record. It makes a mixed corpus *visible*
rather than a silent step change that reads as a model getting worse, and — the real
reason — it **licenses improving the analyzer**. Without a version, every improvement
is a silent data-corruption event, so nobody makes one.

The bump policy: bump when an existing metric's **definition** changes **or when
any cap changes** — a cap change is a definition change, because it changes which
files contribute. Do not bump for a purely additive metric, which older records
simply lack.

**The historical corpus is not backfilled.** It is tempting — the document is
derived from a tree that is still archived, so a later generation could recompute it
— but that tree can only be read in its **post-validation** state, carrying build
output, a rewritten lockfile and toolchain caches in amounts that differ per case and
per run. Stamping those figures into the same corpus as freshly-measured ones would
manufacture exactly the incomparability the version exists to prevent. So the corpus
starts on the day the analyzer shipped, an absent version means *never analysed*, and
the column is forward comparability only.

## What it is not

**Not coverage, and not mutation testing.** Both are out of scope for the
[two reasons on the overview](/gg/analysis/overview/#what-is-deliberately-out-of-scope),
either of which alone decides it. The counts of `#[test]` functions and test files
that appear here are **static counts of test code the model chose to write** —
computed by parsing, executing nothing. They are an authorship signal and must never
be presented as coverage.

**Not a score, and not a gate.** Nothing here influences a run's verdict, its
review, or whether it publishes. A run is judged on what it built, never on what a
metric said about it — consistent with the site-wide stance that
[The Test Cabinet does not reduce a run to a single score](/components/core/results/).
Metric definitions carry a polarity only to orient a sort and pick an arrow's
direction, never to rank.

**Not gg-only.** The per-run Code tab is offered for every harness's runs, because
analysing a directory involves zero harness-specific work and restricting the tab
would cost coverage for nothing. The gg-only constraint binds where it matters — the
aggregate query surface.
