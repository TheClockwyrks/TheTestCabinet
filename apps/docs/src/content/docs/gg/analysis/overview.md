---
title: "Overview"
---

**gg analysis** is the layer that makes a gg run answerable after the fact. A run
already emits a rich [telemetry](/gg/telemetry/) stream and a durable
[session summary](/gg/overview/#the-capability-set), but four questions a reader
actually asks are, today, either unanswerable or answerable only by hand:

1. _What exactly did each agent see, turn by turn, and can I get that back?_
2. _Would this session still happen the same way on today's build of gg?_
3. _Across every session ever recorded, which configurations produce which
   outcomes?_
4. _What did the model actually **write** — not how much it cost, but how it was
   built?_

Four features answer them: **[replay records](/gg/analysis/replay-records/)**,
**[playback](/gg/analysis/playback/)**, the
**[query language](/gg/analysis/query-language/)**, and
**[code analysis](/gg/analysis/code-analysis/)**. They were designed together and
share one contract surface, one artifact convention, and one post-run execution
seam, which is why they live in one section rather than four.

:::note[Status]
This is the design specification for work landing in **v0.7.0**, written to be
implemented from directly. Where a page names a concrete file, function, type, or
column, that is the current code the change builds on — verify it still exists
before relying on it. The internal implementation companion is
`HANDOFF-gg-analysis.md` at the repository root.
:::

## Why these four belong together

They are not four unrelated improvements that happen to share a release. They are
one arc — **capture it, re-run it, query it, and measure what it produced** — and
each one's output is another one's input.

- The **replay record** is the capture. It is rewritten from a per-turn transcript
  into a content-addressed lockstep input log, which is what makes it small enough
  to keep on every run instead of only the runs somebody remembered to enable it
  on.
- **Playback** consumes that record and drives the **real** turn loop from it,
  substituting only the model call and the shell. It turns a record from something
  you _read_ into something you _run_.
- The **query language** consumes every run's durable summary — and now its code
  analysis — as a flat document, so a study is a text query rather than a widget
  builder over a closed enum.
- **Code analysis** produces the data that was missing from that query space
  entirely: nothing in The Test Cabinet has ever computed a single figure over the
  source a run produced.

Two of the four are genuinely coupled and one of those couplings blocks:
**playback cannot begin until the replay record's format v2 exists**, because
playback binds to the record's agent provenance, its per-turn fingerprints, and
its seeded files. **Code analysis and the query language are coupled only in one
direction and only softly**: code metrics are visible on a run's own page the day
code analysis lands, and become _queryable_ the day the query language does.

## The four features

### [Replay records](/gg/analysis/replay-records/)

The record becomes `seed + four content-addressed pools + an ordered input log`.
A message that survives forty turns is stored **once** and referenced forty times
by index; the offered tool definitions are stored once per distinct toolset; an
image's bytes are stored once however many windows carried it. Size goes from
`O(Σ window bytes)` to `O(unique bytes) + O(Σ window items)`.

Because that removes the quadratic term — a measured real record shrinks ~7×
uncompressed and ~40× gzipped — **capture becomes always-on**, and the `replay`
capability is repurposed to escalate a run to full fidelity. Capture also becomes
streaming and append-only, assembly moves out of the container onto the host, and
three correctness holes are closed: an incomplete record is always
self-identifying, the capture journal can never leak into a diff or a public
repository, and a `hung` run's journal is salvaged out of the dying container —
which is the case replay most exists for.

### [Playback](/gg/analysis/playback/)

A gg session has exactly **two** inputs that are not a function of its own state:
the model call and `sh -c`. Playback answers both from a record and performs
everything else for real — the scheduler, git and worktrees, the filesystem, the
wasm sandbox, compaction, the modules, the limits, the full telemetry stream. A
38-minute session reconstructs in seconds, for free, emitting what **this build**
of gg would emit.

That is two capabilities at once: extracting data a run was never instrumented to
record, and a regression detector for gg's own prompt construction. Change one
line of a system prompt template and every recorded fixture fails at once, naming
the diverged component and showing the diff.

### [The query language](/gg/analysis/query-language/)

Every gg run is reified as a **flat document of dotted, typed fields**, and every
query is a text program: `<filter> | stats <aggs> by <keys> | sort … | limit …`.
Omitting `| stats` yields the matching sessions; including it yields buckets.

Because field resolution is a map lookup rather than a `match` arm, any newly
emitted number becomes queryable with **zero code change** — no contract
regeneration, no TypeScript label, no picker entry. That property is what lets
code analysis, replay, and playback all add measurements without touching the
query layer, and it is why this design replaces the current closed-enum
aggregation surface wholesale rather than extending it.

### [Code analysis](/gg/analysis/code-analysis/)

A deterministic, **execute-nothing** static read of the source tree every run
already collects: size and shape, per-function cyclomatic and cognitive
complexity, the module import graph with its cycles, the exported API surface,
per-language type discipline, and copy-paste detection. Two tiers — a small typed
summary on the run record (queryable, publishable) and a full exploration document
served per run (per-file, per-function, symbol table, cycles, clone groups).

No Node, no `tsc`, no rust-analyzer, no `cargo metadata`, no toolchain, no
network. The analyzer is a pure function of the tree's bytes.

## Design principles

Five principles run through all four pages. Each was arrived at by rejecting a
plausible alternative, and each is load-bearing somewhere specific.

**Post-run analysis never costs the run.** No analysis work counts against
`max_runtime_hours`, and none runs inside the container while the harness session
is live. This is architectural, not a preference: it is satisfied _by construction_
by a single host-side stage that runs after artifact collection, **before**
validation, and outside the runtime cap. Both replay assembly and code analysis
land in that one seam. It also rules out anything that builds or executes the
produced tree.

**Deterministic over agentic.** Every measurement here is computed by parsing
bytes. A second model pass to judge refactoring quality was considered and
rejected: it doubles cost and latency, and model non-determinism makes the
judgement noisier than the thing being judged. Where a figure is an approximation
— cross-file reference counting is, in **both** languages — it is labelled as
data, not as prose, so the picker, the axis, and the table header cannot drift
apart.

**A partial answer must never look complete.** A replay record with no terminator
is always marked truncated; a code analysis that hit a cap is excluded from
aggregation by default; an aggregate always carries the `contributing` count that
is its honest denominator; a run analysed on a degraded basis says which basis.
The recurring failure mode this guards against is a low number being read as a
clean result rather than as an unmeasured one.

**Open where it counts, typed where it counts.** The query language's *field*
space is open — a map, so a new number is free. The *data* behind it is typed —
a struct, so it has units, labels, a JSON Schema, and a CI gate that fails when a
field is renamed out from under a saved query. A generic `Map<String, f64>` sink
was considered as the code-metric ingestion point and rejected: it has exactly one
producer, and three of its most load-bearing fields are not numbers.

**Never merge what the reader must distinguish.** A figure computed on a different
basis, by a different analyzer generation, or over a different tree is a different
measurement. Each is recorded, each is a queryable field, and a bucket that spans
two of them says so. This is the same instinct as
[never merging harnesses](/comparisons/overview/#design-principles).

## What is deliberately out of scope

**Code coverage and mutation testing.** Not designed, not sketched, and no
structure here is shaped by them — for two independent reasons, either of which
alone is decisive. First, **there is generally nothing to measure**: a test case is
not required to define a test script, and the
[validator](/components/core/validation/) runs only the case's install and build
commands, never a suite in the produced repo. Second, the owner deferred both
outright. Consequently the analyzer's counts of `#[test]` functions and
`*.test.*` files are **static counts of test code the model chose to write** — an
authorship signal, computed by parsing, executing nothing. They are not coverage
and must never be presented as such.

**Third-party harness support.** These are gg-only features. The one exception is
the per-run **Code** tab, and deliberately: analysing a directory involves zero
harness-specific work, so restricting the _tab_ would cost coverage for nothing.
The gg-only constraint binds where it matters — the aggregate query surface.

**Capability tests.** Out of scope for this work entirely.

## Reading order

The pages are ordered so each is readable on its own, but the dependencies run
left to right:

1. **[Replay records](/gg/analysis/replay-records/)** — the format everything else
   in track A is built on.
2. **[Playback](/gg/analysis/playback/)** — consumes that format. Read the record
   page first.
3. **[The query language](/gg/analysis/query-language/)** — independent of both.
4. **[Code analysis](/gg/analysis/code-analysis/)** — independent; its metrics
   surface through the query language once that lands.
