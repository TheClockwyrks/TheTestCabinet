---
title: "The query language"
---

Every gg run is reified as a **flat document of dotted, typed fields**, and every
query is a text program in a pipeline language:

```text
<filter>                        → the sessions that match
<filter> | stats <aggs> by <keys>   → aggregations over them
```

That single distinction — one stage added — is the two things a reader wants
(_find sessions_, _visualize data_) expressed in one language. It replaces the
current [result-aggregation](/gg/result-aggregation/) surface wholesale.

## Why replace rather than extend

Today's aggregation is a widget builder over a **closed enum vocabulary**: a
fixed facet enum, a fixed metric enum, a hand-matched 27-variant summary-field
enum, ANDed clauses only. The consequences compound:

- **Adding a metric is a code change** — a Rust enum arm, a hand-written match,
  a contract regeneration, a TypeScript label, a URL codec entry, a picker option.
  So metrics get added rarely, and only the ones somebody was already charting.
- **`or` is inexpressible.** "Hung or timed out" — half of "terminated
  abnormally" — cannot be asked.
- **There are no dates**, no document view, no persistence, and no path to the
  public site.
- **A whole namespace was silently missing.** There is no plain "which model?"
  facet: the model facet keys on an **agent name**, so grouping by model requires
  knowing the run's agent names. "Which model writes better code?" — the first
  question [code analysis](/gg/analysis/code-analysis/) invites — is currently
  unaskable.

The document model fixes all of it in one move, because **field resolution becomes
a map lookup rather than a `match` arm**. A newly emitted number is queryable with
no Rust change, no contract regeneration, and no TypeScript label. That property is
the whole design; everything below follows from it.

## A run is a document

One flat map of dotted names to scalars, built once per run from its
[run record](/components/core/run-records/) plus the store's lifecycle columns.
This is the document/mapping model, and it buys four things at once: an open metric
side, a free autocomplete source (the union of keys **is** the field catalog; the
observed values **are** the value suggestions), a trivially publishable payload
(plain JSON, an order of magnitude smaller than the structures it derives from, and
carrying no source, prompts, or model output), and a cheap mirrored evaluator.

The namespaces:

| Namespace | Holds |
| --- | --- |
| `id`, `started`, `finished`, `state`, `published`, `rating`, `score`, `reviewCount` | run identity, timing, lifecycle |
| `case`, `caseVersion`, `variant`, `testType` | what was run |
| `model`, `orchestrator`, `preset`, `agents`, `agent.<name>.model`, `model.<id>` | how it was configured |
| `cap.<id>`, `cap.<id>.impl`, `cap.<id>.<param>` | the [capability set](/gg/configurations/), flattened and **typed** |
| `tool.<name>` | the effective toolset |
| `status`, `mode`, `limit` | how it ended |
| `summary.<path>` | the **whole** session summary, flattened |
| `code.<path>` | the [code analysis](/gg/analysis/code-analysis/) summary |
| `has.<block>` | presence markers |

Two of those rows deserve emphasis. `summary.*` **subsumes the entire closed
summary-field enum and every field it never covered** — including ones nobody
wrote an enum arm for. And `cap.<id>.<param>` is **typed**, so
`cap.compaction.summaryHeadroom > 0.5` works; the current implementation
stringifies every capability param, which makes numeric comparison impossible.

### Seven rules, stated once

These are the semantics, and they are identical in both implementations.

**1. Absent means absent, with no exceptions.** A missing key fails every
comparison — including one against `false` — and passes `not`. An earlier draft
made a boolean compared against `false` also match an absent field; that was
dropped because it conflated "configured and off," "never mentioned," and "the
block is missing entirely," and it made every average's denominator dishonest.

Two things make the exception unnecessary. **`cap.<id>` is total**: the document
builder walks gg's full capability catalog and emits `false` for every capability
the run did not enable, so `cap.compaction:false` is a stored `false` and
`avg(cap.compaction)` is an honest enablement rate. **`tool.<name>` stays sparse**
— the tool universe is per-run, not a closed catalog — so "never offered this tool"
is written explicitly, and the field sidebar shows each tool field's document count
so the sparseness is *visible* rather than inferred.

**2. `has.*` markers make denominators explicit.** A gg run that never ran a
session has a capability set but no summary; a non-gg-shaped record has neither.
Every honest rate query scopes on a marker, and every aggregate renders its
`contributing` count so an unscoped one is still legible.

**3. Metrics are absent, never zero, on a run that produced nothing.** A failed
record is built with default metrics — zero seconds, no tokens, no cost. Flattened
naively, a `timed_out` run would report zero run time, dragging average cost toward
zero with **exactly the runs that burned the most budget** and excluding the
longest runs from a long-run filter. So the builder emits token and cost fields only
when they are actually present, and run time only when the run genuinely probed a
container.

**4. Arrays are never flattened positionally.** Positional keys are unqueryable,
duplicate the purpose-built per-model and per-tool namespaces, and would flood the
field sidebar. An array contributes only its length.

This rule binds every other feature: **a field added to the session summary must be
a scalar or a map, never an array**, or it is silently unqueryable. It is also why
the code analysis's language list surfaces as a **derived scalar** rather than as a
list — `"typescript"`, `"rust"`, `"mixed"`, or `"none"`.

**5. Booleans project to 1 and 0 in numeric context**, so averaging one is a rate.

**6. Dates are numbers** — epoch milliseconds — so ranges, sorts, and histograms
need no date machinery in the evaluator. Everything is UTC; a bare date as the
upper bound of an inclusive range means end of day, so a whole month is a whole
month.

**7. Non-finite values are dropped at build time**, never stored.

## The language

```text
query        ::= filter ( "|" stage )*
filter       ::= orExpr | ε
orExpr       ::= andExpr ( "or" andExpr )*
andExpr      ::= unary ( "and"? unary )*          (* juxtaposition = AND *)
unary        ::= ("not" | "-") unary | primary
primary      ::= "(" orExpr ")" | predicate

predicate    ::= field ":" "*"                          (* exists    *)
               | field ":" "(" literal ("or" literal)* ")"  (* one-of *)
               | field ":" "[" bound "to" bound "]"     (* range     *)
               | field op literal                       (* compare   *)
               | literal                                (* free text *)
op           ::= ":" | "!=" | ">=" | "<=" | ">" | "<"

stage        ::= "stats" aggList ("by" groupList)? | "sort" … | "limit" INT
agg          ::= aggFn "(" field? ")" ("as" IDENT)?
aggFn        ::= count | distinct | avg | sum | min | max | median | p90 | p95 | dist
group        ::= field | "bucket" "(" field "," interval ")"
```

The decisions worth defending:

- **`:` is equality, not a match.** Case-insensitive with `*` globs
  (`model:"anthropic/*"`), which is strictly more predictable than an analyzed
  match while still covering prefix search. There is one equality operator, so
  there is no ambiguity about which to reach for.
- **Boolean composition is the point.** The current all-AND engine cannot express
  "hung or timed out." A predicate tree costs about forty lines of evaluator.
- **Relative dates resolve in the client**, so a *saved* query stays relative and
  re-resolves on every run, while the compiled query the server sees carries
  absolute milliseconds and the server needs no clock.
- **There is no `rate()` function.** Averaging a boolean **is** a rate, and
  `contributing` is its denominator.
- **Group-by is capped at three keys.** Visualizations bind the first two; the rest
  are table-only.
- **There is no `auto` interval.** It has no representation in a compiled query and
  is genuinely unresolvable client-side for a query with no time bound. Time-range
  presets carry explicit intervals instead.

Worked examples, which double as the editor's example menu:

| Question | Query |
| --- | --- |
| Long recent sessions on one provider | `started >= now-30d and model:"anthropic/*" and metric.runTimeSeconds >= 1800` |
| Abnormal-termination share per configuration | `not state:completed \| stats count() by preset` |
| Context overflow with compaction off, per model | `cap.compaction:false and has.summary:true \| stats avg(summary.ranOutOfContext) as overflow_rate by model` |
| Score distribution, speculation on vs off | `\| stats dist(score) by cap."speculative-execution"` |
| Sessions per day | `started >= now-90d \| stats count() by bucket(started, 1d)` |
| Which runs never got the edit tool | `has.summary:true and not tool.editFile:*` |
| A code metric, once code analysis lands | `\| stats median(code.functions.cognitive.p90) by model` |

## Where the parser lives, and why the evaluator is mirrored

**The parser, compiler, completer, and formatter are TypeScript only.** They must
run on every keystroke to highlight tokens, underline an error span, and answer
"what can follow the caret" — a round trip to a compiled artifact is the wrong
shape for that, and the core crate cannot be compiled to the browser anyway. The
backend never parses text: the client sends the **compiled** query, which stays the
single wire form, while the URL and the saved object carry the **text**.

**The evaluator is mirrored** — authoritative in Rust, twinned in TypeScript —
because it must run in two places: on the backend for the console, and in the
browser for the public site with no backend at all.

Cross-implementation drift is therefore the design's single largest risk, and it is
bounded rather than trusted. A **checked-in conformance fixture** — documents,
queries, and expected results — is executed by **both** test suites, and it covers
the field catalog too, because that is the *second* mirrored function and a drift
there is a one-host-only autocomplete regression. Seven determinism rules are
pinned by it:

- **Document order** is finished descending, ties by id, absent-timestamp last —
  so every fold iterates identically and floating-point summation is bit-identical.
- **Bucket order** defaults to count descending — **except** when the first group
  key is a date histogram, where it is key ascending. A time bucket has an
  intrinsic order, "largest bucket first" is meaningless for it, and a line chart
  connects points in input order, so a count-descending histogram draws a zigzag
  rather than a time series.
- **String comparison is by Unicode code point, and Rust is the reference.** Rust's
  ordering already _is_ code-point order; the hazard is entirely on the TypeScript
  side, which must not use `<`, `>`, or locale collation — both disagree with
  code-point order above the BMP. A conformance case with an astral character is
  mandatory.
- **Quantiles use one definition** — the repository's existing linearly
  interpolated one, reused verbatim rather than reinvented, so gg's box plots match
  the comparison charts'.
- **Bucket alignment is UTC and explicit.** Minute, hour, and day intervals floor
  against the epoch; **week intervals floor against a Monday**, because the epoch
  was a Thursday and Thursday-to-Wednesday weeks read as a bug.
- **Distinct counts** use the same total order as bucket keys.
- **The engine never formats numbers.** Formatting is a UI concern.

One thing deliberately **not** mirrored: a bootstrap confidence interval on
distributions. Reproducing a seeded resample bit-for-bit in the browser would need
64-bit integer arithmetic across thousands of iterations per bucket — by far the
most drift-prone construct that could enter a mirrored evaluator, for a decoration
on an exploratory chart. Distributions carry a five-number summary and a mean, the
CI mark is simply omitted, and the [comparisons](/comparisons/statistics/) surface —
which is where inferential claims are actually made — keeps its interval untouched.

## The editor

No code-editor library is added. The CSP-strict public site and the bundle budget
both argue against one, and the feature needed is small: a transparent textarea
over a syntax-highlighted layer, scroll-synced.

- **Validation is live**, and the parser is **error-tolerant** — it always returns
  a partial tree and continues past a bad token, so a half-typed query still drives
  completion.
- **Autocomplete** is context-sensitive: field names ranked by document count at a
  field position; that field's top values *with counts* after a colon; stage
  keywords after a pipe; aggregation functions after `stats`.
- **A field-browser sidebar** lists every field with its kind, document count, and
  top values, click-to-insert. **This is not polish.** A text language is strictly
  harder to start with than a widget builder, and without genuinely good
  autocomplete and a field browser the redesign is a downgrade for the first five
  minutes of use. The sidebar carries extra weight because it is where sparse
  fields become *visible* rather than inferred.

Because the grammar is hand-written with no library to lean on, it should be
treated as **frozen for v1**. Every "just add a function" is a parse path, a
completion rule, a formatter arm, and new conformance cases.

## Surfaces

Three tabs: **Dashboards**, **Discover**, **Saved**.

**Discover** is the query surface: one filter row (time range, open, save), the
editor, a view switcher, the field sidebar, and either the matching **documents**
or the **buckets** plus a visualization. The document view is what the old Sessions
tab becomes. Aggregate cells render `contributing` whenever it is less than the
bucket's `n`.

**Dashboards** are panels of saved or inline queries on a 12-column grid, with
**one** dashboard-level time picker — filters scope everything below them, and no
panel gets its own range. An N-panel board is **one** batched request, not N full
scans. The built-in overview dashboard is defined as ordinary query text through
the same machinery every user dashboard uses, so it cannot silently rot the way a
hardcoded breakdown did.

Visualizations follow the repository's [data-visualization
conventions](/comparisons/statistics/) and mint no new colors: a stat tile for a
single figure (not a one-bar chart), sequential single-hue bars where identity is
on the axis, categorical only where series identity is the point, a donut capped at
six slices with the rest folded into "Other", a line chart for date histograms, and
a distribution for a `dist()`. **Never a dual axis** — two selected aggregations
become two stacked charts. **Absent values are dropped, never charted as zero.**
The table view is always reachable.

**Legacy links keep working.** A transcoder turns the old URL parameters into query
text on a redirect route, because the best property of the current implementation is
that the URL *is* the query, and that property is preserved rather than replaced.

## Persistence and publishing

Saved queries and dashboards are per-account objects following the existing gg
configuration pattern. A saved query stores its **source text**, not a compiled
query, so a relative date re-resolves on every run and a later grammar addition
never invalidates a stored query.

The backend holds an in-memory document index, and its freshness rule is the one
piece of this design that had to be got exactly right. A watermark on the record's
own finish timestamp is **unsound**: adding a review, publishing, and re-pushing a
run all rewrite what the document must contain and none of them move that
timestamp, and a run pushed late lands below the watermark and is never indexed at
all. So the run row carries a **mutation timestamp** stamped by every mutator, and
reconciliation is **per id** — one cheap projection, evict what is gone, reload only
what changed. That also handles deletion and needs no monotonicity guarantee.

For the public site, the documents are exported as a snapshot artifact and the
**same mirrored evaluator runs in the browser** — the public Discover surface needs
no backend at all. Three rules govern the export:

- **It is decoupled from run publication.** A document carries configuration ids and
  outcome numbers, no source and no model output, so requiring per-run publication
  would publish essentially nothing.
- **It is not decoupled from the experimental catalog gate.** The backend
  deliberately hides experimental cases; exporting their documents would publish an
  unreleased case's slug, existence, run count, and scores. Those documents are
  dropped.
- **It is field-redacted and scrubbed**, and the site renders the snapshot's build
  time beside every figure, because the public corpus legitimately lags.

## What this hands to the other features

Nothing here needs a change from replay, playback, or code analysis. That is the
point: any scalar any of them adds to the session summary or the record becomes
queryable, chartable, groupable, and publishable **with no change to the query
layer**. The only obligations are the two stated above — **emit scalars, not
arrays**, and **keep field names stable**, because a field name is user-visible in
autocomplete and inside saved queries.
