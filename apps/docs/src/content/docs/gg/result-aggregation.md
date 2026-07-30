---
title: "Result aggregation"
---

gg sessions must be **queryable Kibana-style**: run structured queries across many gg
sessions to gather and analyze data — not just look at one run at a time.

The point is to make the experiments gg enables **analyzable in aggregate**:

- "across every run with compaction off, how often did the model run out of
  context?"
- "which memory implementation produced fewer reopened issues?"
- "how does subagent depth correlate with score?"
- "does [speculative execution](/gg/speculative-execution/) beat single-attempt at a
  fixed budget?"

This is where the [capability set](/gg/overview/#the-capability-set) recorded on each
run pays off — it is the dimension every aggregate query slices by. Result
aggregation depends directly on the [telemetry](/gg/telemetry/) schema: we can only
aggregate over fields we durably record, so the two are designed together.

## Facets and metrics worth knowing about

Most facets come straight off the capability set — whether a capability is on, which
implementation it uses, a capability param, an agent profile's model, the preset. Two additions are
worth calling out because they answer questions the rest cannot:

- **`limitHit`** groups a run by which [execution ceiling](/gg/execution-limits/) stopped
  it, or `"none"` for a run that hit none. It is distinct from terminal status because
  two ceilings share the status `limit_exceeded` while two others have statuses of their
  own, so this is the facet that answers "which ceiling?" directly.
- **Thirteen [response-healing](/gg/response-healing/) metrics** — how many of a run's
  replies had to be repaired before they could run, how many applications each strategy
  made, how many replies were not programs at all (and, of those, how many offered several
  programs — split by whether the reply fenced them or pasted them bare, which are two
  different mistakes), and the computed `healing_rate`. Averaging that rate across a bucket
  grouped by primary model answers "which models still need their replies repaired?" in one
  query, which is exactly the instruction-following signal responses-as-code exists to
  measure.

Ablating a healing strategy needs no new facet: a **capability param** facet over
`responses-as-code` / `healing.strip-fences` resolves the dotted path, and a run that left
the strategy at its default buckets as *absent* rather than as a value it never declared.

## Where it lives

Aggregation is one tab of the console's **gg analysis** UI, entered from the
topbar's analyze control (see
[Configurations](/gg/configurations/#analyzing-across-them)). The **Dashboard** tab
answers the standing question — how gg is doing across every recorded session —
while this **Aggregate** tab is where a specific study question gets asked: narrow
by facet and metric predicates, group by one or more capability-set facets, and
aggregate metrics per bucket. **Sessions** lists the individual runs behind an
aggregate.

## A ran query is a page

The Aggregate tab only *composes* a query. Running it navigates to the query's own
page (`/gg/aggregate/results`), which carries the whole query in its URL — one
parameter per clause — and renders the buckets as a chart and a table. So a study
is **shareable**: paste the link and a colleague sees the same buckets, and the
answer is never crowded off screen by the controls that produced it. **Edit query**
leads back to the builder with every clause still loaded, so revising a query never
means rebuilding it.
