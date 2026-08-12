---
title: "Result aggregation"
---

gg exists to run experiments, so its sessions are analyzed in aggregate: one
question asked across every recorded run and answered as buckets, rather than as
a list of runs to open one at a time.

Questions of this shape are what the surface is required to answer:

- across every run with compaction off, how often did the model run out of
  context?
- which memory implementation produced fewer reopened issues?
- how does subagent depth correlate with score?
- does agent persistence beat a fresh instance per dispatch at a fixed budget?

Each of them is one line of query text.
[The query language](/gg/analysis/query-language/) specifies the run document a
question is asked against, the pipeline syntax, and the console surfaces that run
a query.

## What a query groups by

The capability set recorded on each run is the dimension an aggregate slices by.
It is flattened into the run document as `cap.<id>`, `cap.<id>.impl`,
`cap.<id>.<param>` and the per-agent `agent.<name>.cap.<id>`. `cap.<id>` is a
run-wide read, true when any agent has the capability on, so an enablement rate
averaged over it is honest for a run that enabled a capability on one subagent.

Capability params are typed in the document, so a numeric comparison such as
`cap.compaction.summaryHeadroom > 0.5` is expressible. Ablating one setting of a
capability needs nothing beyond its param field: a run that left the setting at
its default records no value and buckets as absent.

A query reaches only fields a run durably records, so aggregation and the
[telemetry](/gg/telemetry/overview/) schema are designed together. A figure
worth grouping by has to reach the run's summary first.
