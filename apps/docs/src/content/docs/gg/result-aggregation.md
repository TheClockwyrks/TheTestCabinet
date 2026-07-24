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
