---
title: "The query language"
---

TCQ is the query language of the gg analysis surface. Every recorded gg run is
reified as one flat document of dotted, typed field names, and a query is a
pipeline over that corpus:

```text
<filter>                            → the runs that match
<filter> | stats <aggs> by <keys>   → aggregations over them
```

Field resolution is a map lookup rather than a match arm. A number a feature
newly emits onto a session summary is therefore queryable, chartable and
groupable with no Rust change, no contract regeneration and no TypeScript label.

## The run document

One document is built per run, from its [run
record](/components/core/run-records/) plus the store's lifecycle columns. It is
plain JSON, an order of magnitude smaller than the structures it derives from,
and carries configuration ids and outcome numbers rather than source, prompts or
model output.

| Namespace | Holds |
| --- | --- |
| `id`, `started`, `finished`, `state`, `published`, `rating`, `score`, `reviewCount` | identity, timing, lifecycle |
| `case`, `caseVersion`, `variant`, `testType` | what was run |
| `model`, `orchestrator`, `harnessVersion`, `preset`, `agents`, `agent.<profileId>.model` | how it was configured |
| `cap.<id>`, `cap.<id>.impl`, `cap.<id>.<param>`, `agent.<profileId>.cap.<id>` | the capability set, flattened and typed |
| `tool.<name>` | the root agent's effective toolset |
| `status`, `mode`, `limit` | how it ended |
| `summary.<path>` | the whole session summary, flattened |
| `model.<id>.tokens`, `model.<id>.cost` | the per-(profile, model) spend rollup |
| `metric.*` | run time, the stage durations, tokens and cost |
| `code.<path>`, `code.language` | the [code analysis](/gg/analysis/code-analysis/) summary |
| `has.<block>` | presence markers |

`summary.<path>` carries the entire session summary, so a figure a later feature
folds onto it becomes queryable the day it lands. `cap.<id>.<param>` is typed,
so `cap.compaction.summaryHeadroom > 0.5` compares numerically.

`cap.<id>` is a run-wide read: true when any agent of the run has the capability
enabled. It is total over the union of gg's capability catalog and the ids the
run's own agents declare, so a capability a run left off stores an explicit
`false` and `avg(cap.compaction)` is an enablement rate. Per-agent detail is
written sparsely as `agent.<profileId>.cap.<id>`, only for the agents that had
it. Both `agent.*` families key on the profile's
[id](/gg/configurations/#identity), which a rename leaves alone, so one query
slices the same profile across a whole study.

`code.language` is derived rather than flattened, because the analyzer reports a
list of languages: it reads `"none"`, the single language's token, or `"mixed"`.

## Semantic rules

These semantics are identical in both implementations of the evaluator.

1. Absent means absent. A missing key fails every comparison, including `!=`
   and one against `false`, and passes `not`. Absence is asked for with
   `not <field>:*`.
2. `has.*` markers make denominators explicit. A gg run that never ran a session
   has a capability set but no summary; a record from another harness has
   neither. Every aggregate also reports the `contributing` count behind its
   figure.
3. Metrics are absent, never zero, on a run that produced nothing. A record
   built for a failed run carries default metrics, so the builder emits token,
   cost and stage-duration fields only when they are present, and run time only
   when the run genuinely probed a container.
4. Arrays are never flattened positionally. An array contributes only its
   length, under `<path>.count`. A field added to the session summary must
   therefore be a scalar or a map.
5. Booleans project to `1` and `0` in numeric context, so averaging one is a
   rate. There is no `rate()` function.
6. Dates are numbers, epoch milliseconds in UTC, so ranges, sorts and histograms
   need no date machinery in the evaluator. A bare date as the upper bound of an
   inclusive range means end of day.
7. Non-finite values are dropped at build time.

`tool.<name>` stays sparse, because the tool universe is per-run rather than a
closed catalog. The field sidebar reports each field's document count, so a
sparse field is visible before a query is run. A run whose root answers with
[programs](/gg/responses-as-code/overview/) writes none of these fields, since it
is offered no tools and its surface is its granted operations.

## Grammar

```text
query        ::= filter ( "|" stage )*
filter       ::= orExpr | ε
orExpr       ::= andExpr ( "or" andExpr )*
andExpr      ::= unary ( "and"? unary )*          (* juxtaposition = AND *)
unary        ::= ("not" | "-") unary | primary
primary      ::= "(" orExpr ")" | predicate

predicate    ::= field ":" "*"                              (* exists    *)
               | field ":" "(" literal ("or" literal)* ")"  (* one-of    *)
               | field ":" "[" bound "to" bound "]"         (* range     *)
               | field op literal                           (* compare   *)
               | literal                                    (* free text *)
op           ::= ":" | "!=" | ">=" | "<=" | ">" | "<"

stage        ::= "stats" aggList ("by" groupList)? | "sort" sortList | "limit" INT
agg          ::= aggFn "(" field? ")" ("as" IDENT)?
aggFn        ::= count | distinct | avg | sum | min | max | median | p90 | p95 | dist
group        ::= field | "bucket" "(" field "," interval ")"
```

The grammar is frozen for v1. Every added function is a parse path, a completion
rule, a formatter arm and a set of conformance cases.

`:` is equality rather than an analyzed match: case-insensitive, with `*` globs,
as in `model:"anthropic/*"`. A range is inclusive on both ends and either bound
may be open. A bare literal matches any string-valued field of the document,
case-insensitively.

A `stats` stage takes at most three group keys. Visualizations bind the first
two; a third is table-only. Histogram intervals are minutes, hours, days and
weeks, always written explicitly: there is no `auto` interval, and the
time-range presets carry the interval that suits their range.

Worked examples, which are also the editor's example menu:

| Question | Query |
| --- | --- |
| Long recent sessions on one provider | `started >= now-30d and model:"anthropic/*" and metric.sessionSeconds >= 1800` |
| Runs never offered the edit tool | `has.summary:true and not tool.edit_file:*` |
| Everything that terminated abnormally | `state:(hung or timed_out or catastrophic)` |
| Abnormal-termination share per configuration | `not state:completed \| stats count() by preset` |
| Context overflow with compaction off, per model | `cap.compaction:false and has.summary:true \| stats avg(summary.ranOutOfContext) as overflow_rate by model` |
| Score distribution, agent persistence on versus off | `\| stats dist(score) by cap."agent-persistence"` |
| Sessions over time | `\| stats count() by bucket(started, 1d)` |
| Compilation cost per [language arm](/gg/languages/overview/) | `has.summary:true \| stats avg(summary.compileMs) as compiling by summary.programLanguage` |
| Cognitive complexity per model | `\| stats median(code.complexity.meanCognitive) by model` |

## Parser and evaluator

The parser, compiler, completer and formatter are TypeScript only. They run on
every keystroke, to highlight tokens, underline an error span and answer what
may follow the caret. The backend receives compiled queries and never parses
query text; the URL and the saved object carry the text, so a relative date such
as `now-30d` re-resolves on every run while the server sees absolute
milliseconds.

The evaluator is mirrored: authoritative in Rust, twinned in TypeScript. It runs
on the backend for the console and in the browser for the public static site,
which has no backend behind it. The field catalog is mirrored for the same
reason.

Cross-implementation drift is bounded by a checked-in conformance fixture of
documents, queries, expected results and the expected field catalog, executed by
both test suites. Any change to the semantics on this page must grow that
fixture. It pins these determinism rules:

- Document order is `finished` descending, ties by `id` ascending, absent
  timestamp last. The order is imposed before filtering, so every fold iterates
  identically and floating-point summation is bit-identical.
- Bucket order is count descending, except when the first group key is a date
  histogram, where it is key ascending. A line chart connects points in input
  order.
- String comparison is by Unicode code point, and Rust is the reference. The
  TypeScript twin reaches for code-point arrays, since `<` and `localeCompare`
  both disagree above the BMP.
- Quantiles use the repository's existing linearly interpolated definition, so
  gg's box plots match the comparison charts'.
- Bucket alignment is UTC. Minute, hour and day intervals floor against the
  epoch; week intervals floor against the Monday before the epoch.
- Distinct counts use the same total order as bucket keys.
- The engine formats no numbers. Formatting is a UI concern.

A `dist()` column carries a five-number summary and a mean, with no confidence
interval. Reproducing a seeded bootstrap resample bit-for-bit across the two
hosts would need 64-bit integer arithmetic over thousands of iterations per
bucket. Inferential claims are made on the
[comparisons](/comparisons/statistics/) surface, which keeps its interval.

## The editor

The editor is a transparent textarea over a syntax-highlighted layer, scroll
synced, with no code-editor library behind it. The public site is CSP-strict and
runs this same surface off a snapshot.

- Validation is live, and the parser is error-tolerant. It always returns a
  partial tree and resynchronises past a bad token, so a half-typed query still
  drives completion.
- Completion is context-sensitive: field names ranked by document count at a
  field position, that field's top values with their counts after a colon, stage
  keywords after a pipe, and aggregation functions after `stats`.
- A field-browser sidebar lists every field of the corpus with its kind,
  document count and top values, click-to-insert.

The completions, the sidebar and the example menu are what make a text language
discoverable, and the document counts they carry are what make a sparse field
visible before a query returns nothing.

## Surfaces

The console's analysis chrome carries Sessions, Dashboards, Discover, Saved and
Reference. The public static site carries Discover alone, since the other tabs
need an account or a backend.

Discover is the query surface: a filter row holding the time range and the open
and save controls, the editor, a view switcher, the field sidebar, and either
the matching documents or the buckets plus a visualization. An aggregate cell
renders its `contributing` count whenever that is less than the bucket's `n`.

Dashboards are panels of saved or inline queries on a 12-column grid, under one
board-level time picker. The board's range is ANDed onto every panel's own
filter, and a panel's first date-histogram key is retuned to the range's
interval. A board is answered by one batched request, so every panel reads one
corpus. The built-in overview dashboard is defined as ordinary query text
through the machinery every user dashboard uses.

A single query returns at most 1000 rows and a batch carries at most 32 queries.
A response that was cut off is marked truncated, and a view renders that as
showing the first N.

Visualizations follow the repository's [data-visualization
conventions](/comparisons/statistics/) and mint no new colors. The chart is
chosen from the query's shape rather than from a picker, so a pasted link draws
the same picture for its recipient:

- One bucket with scalar columns renders stat tiles.
- A date-histogram first key renders a line over a UTC time axis.
- An ordinary field key renders bars in a single hue.
- Two keys stack only under `count()` and `sum()`, whose parts sum to the whole.
  Other aggregations render a flat bar per composite key.
- A `dist()` column renders box plots.
- Two aggregations render two stacked charts rather than a dual axis.

An absent value is dropped rather than charted as zero, and every row a chart
drops is counted and reported. The table view is always reachable.

## Persistence and publishing

Saved queries and dashboards are per-account objects, served under
`/gg/saved-queries` and `/gg/dashboards`. A saved query stores its source text,
so a relative date re-resolves on every run and a later grammar addition leaves
stored queries valid. The corpus itself is deployment-wide rather than
account-scoped, matching the run listings.

The backend holds an in-memory document index. Freshness is reconciled per id
against a mutation timestamp the run row carries and every mutator stamps:
reload the ids whose stamp moved, evict the ids that are gone, leave the rest
alone. A watermark on the record's own finish timestamp would be unsound, since
adding a review, publishing and re-pushing a run all change what a document must
contain without moving it. A document's `score` field is a fraction of the case
manifest's checklist weights, which no run row records, so a re-ingest drops the
whole index instead.

For the public site the documents are exported as a snapshot artifact and the
same mirrored evaluator runs in the browser. Three rules govern the export:

- It is decoupled from run publication. A document carries configuration ids and
  outcome numbers, so gating it on publication would export almost nothing.
- A run whose case is experimental, or whose manifest the definition store
  cannot resolve, is withheld. Exporting it would publish an unreleased case's
  slug, existence, run count and scores.
- It is field-redacted, then scrubbed for secrets. Redaction drops the named
  private fields and anything longer than 200 characters, in a field's name as
  well as in its value, because a field name is minted from operator-authored
  configuration keys exactly as a value is.

The public corpus is a build-time export and lags the console's, so the site
renders the snapshot's build time beside its figures.

## Obligations on emitted fields

Any scalar the session record, the session summary or the code analysis emits
becomes queryable, chartable, groupable and publishable with no change to the
query layer. Two obligations come with that: emit scalars rather than arrays,
and keep field names stable, since a field name is visible in autocomplete and
stored inside saved queries and dashboards.
