---
title: "Result aggregation"
---

gg sessions must be **queryable Kibana-style**: run structured queries across many gg
sessions to gather and analyze data — not just look at one run at a time.

The point is to make the experiments gg enables **analyzable in aggregate**:

- "across every run with compaction off, how often did the model run out of
  context?"
- "which planning implementation produced fewer reopened issues?"
- "how does subagent depth correlate with score?"
- "does [speculative execution](/gg/speculative-execution/) beat single-attempt at a
  fixed budget?"

This is where the [capability set](/gg/overview/#the-capability-set) recorded on each
run pays off — it is the dimension every aggregate query slices by. Result
aggregation depends directly on the [telemetry](/gg/telemetry/) schema: we can only
aggregate over fields we durably record, so the two are designed together.

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
