---
title: "Turn timing"
---

A gg turn is three operations, and they drag for different reasons. gg emits one
`turn_timing` per turn, splitting the turn's wall-clock into the phase it was
spent in.

| Phase | What it covers |
| --- | --- |
| `promptMs` | Prompt construction: draining the agent's inbox, refreshing the pinned blocks, running any triggered [compaction](/gg/compaction/), resolving the offered toolset. From the turn's start to the moment the request was dispatched. |
| `requestMs` | The model call itself, including any vision-recovery retry. The same figure the turn's `prompt` event carries as `durationMs`, so the two never disagree. |
| `responseMs` | Response processing: dispatching and answering every tool call or running the turn's [program](/gg/responses-as-code/programs/), applying the state transitions the turn asked for, and closing the turn. |

The three are a partition of the turn rather than three independent stopwatches.
gg derives the response phase as the remainder, so they always sum to exactly the
turn's duration. That lets the console stack them into one bar per turn with no
gap, each bar's height being the turn, on the Time per turn graph that heads an
agent's Metrics file. Hovering a bar gives the turn's raw figures and each
phase's share.

A run can take hundreds of turns and about fifty bars is the most that stays
comparable, so the graph windows: a size control picks how many turns are in
frame and a range control slides that frame over the run. The frame follows the
newest turn until a reader moves it, so a live run keeps showing its latest work.

A turn that ends abnormally, such as a ceiling breached mid-turn or a model call
that failed, still reports a timing, carrying the phases it reached with the ones
it never entered at `0`. The accounting closes when the turn's scope does, which
is why such a timing lands after the event that ended the turn.

## The metric graphs

Under the Time per turn bars, the Metrics file plots four per-request figures,
being throughput, cost per request, cache-read share and reasoning share. Each
is one point per model call, against the same turn axis the
[context graph](/gg/context-visibility/) uses. A request with no datum for a
metric, such as throughput on a call gg did not time or reasoning share when the
harness folds reasoning into output, is skipped rather than drawn as a zero it
did not report.

A point is a single number, and a single number cannot show its own arithmetic.
Hovering one marks it and names the turn it belongs to, the value plotted, and
the figures that value came from: the tokens generated and the latency behind a
throughput, the input and output tokens behind a price (plus what the provider
charged, when that differs from the comparable figure the point plots), and the
numerator and denominator behind a share. 60% of a small prompt and 60% of a huge
one are the same point on the line and nothing like the same request.

The turn leads every tooltip, because it ties the point to the same turn on the
Time per turn and Context graphs, which is the path from a slow request to the
reason it was slow.

Each card is headed by the agent's figure rather than the last request's wherever
the metric is a property of the agent rather than of one call. Throughput heads
with the agent's whole generation over its whole model time, the same tokens per
second its Overview states, and the two shares head with their summed numerator
over their summed denominator. Cost per request is per-request by definition and
heads with the latest point. This matters most for throughput: the last request
of a session is characteristically its least representative, since a two-line
sign-off pays the same fixed round-trip as a working turn, so a card headed by it
would contradict the Overview beside it.
