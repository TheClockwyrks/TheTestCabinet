# Volute — Matching, extraction, scoring, and chains

This file defines when cores leave the channel, what a removal pays, how the
cores behind it recoil, and how consecutive extractions build a chain. It uses
the channel, its segments, its spacing, and its merging rule as
`specs/channel.md` defines them, and the insertion as `specs/injector.md`
defines it.

## Figures

| Figure                  | Value        |
| ----------------------- | ------------ |
| Minimum extracted run   | 3 cores      |
| Score for an extraction | `10 × n × k` |
| `RECOIL`                | 42 units     |
| `RECOIL_HOLD`           | 0.4 s        |
| `CHAIN_RESET`           | 2.0 s        |

## Runs

A run is a set of consecutive cores of one segment that all carry the same
charge. A run is maximal when the core immediately ahead of it and the core
immediately behind it either carry a different charge or lie outside the
segment. A maximal run of at least 3 cores is extracted by the two events below,
and a run that reaches 3 cores by any other means stays on the channel.

## Extraction on an insertion

When an insertion resolves, take the maximal same-charge run containing the
inserted core within that core's segment. That run is extracted on the same tick
when it holds at least 3 cores. The extraction removes every core of the run at
once and scores at chain step 1.

## Extraction on a merge

When a segment merges with the segment ahead of it, and the merging segment's
head core and the segment ahead's tail core carry the same charge, take the
maximal same-charge run spanning that join within the merged segment. That run is
extracted on the tick the merge occurs when it holds at least 3 cores. The
extraction removes every core of the run at once and scores at the incremented
chain step.

## Removals and recoil

A removal takes one or more cores off the channel at once. An extraction and a
bore are the removals, and each of them recoils the cores behind it by the rule
here.

Every remaining core ahead of the frontmost core the removal took keeps its arc
position. Behind that point, each maximal set of consecutive remaining cores
whose arc positions differ by exactly the channel spacing is a trailing group,
and every trailing group moves back as one, preserving the spacing within it.
With `t` the group's last core and `b` the head of the group behind it, both
read at the arc positions they held before any group moved:

```
room  = min(t.s, b exists ? t.s - b.s - SPACING : RECOIL)
moved = clamp(room, 0, RECOIL)
```

Every core of the group has `moved` subtracted from its arc position. The group
then holds for `RECOIL_HOLD` (`0.4` s) of simulation time and advances again
once that hold expires. Two groups a recoil leaves exactly the channel spacing
apart are one segment, carrying the hold of the group ahead.

Every core a removal takes off the channel lowers the pressure, as
`specs/channel.md` states.

## The chain step

The chain step `k` is an integer that is 1 when a level begins. Each extraction
takes the value this table gives, then scores at it.

| Event                                            | Chain step               |
| ------------------------------------------------ | ------------------------ |
| Extraction on an insertion                       | 1                        |
| Extraction on a merge                            | the previous step plus 1 |
| `CHAIN_RESET` (2.0 s) elapses with no extraction | 1                        |

An insertion-caused extraction therefore scores at step 1, the merge-caused
extraction that follows it scores at step 2, and a third extraction reached by a
further merge scores at step 3. The elapsed time since the most recent
extraction falls with the ticks that advance play, and every extraction restarts
it.

## Score

An extraction of `n` cores at chain step `k` adds `10 × n × k` to the score,
where `n` counts every core the extraction removed. The score updates on the tick
the extraction resolves.

## Bore removals

The cores a bore removes score `10 × n × k` for the `n` cores it removed, at the
chain step `k` in force. The chain step and the elapsed time that resets it are
both unchanged by a bore, so a bore pays at the step the chain already stands at
and carries the chain no further.
