# Meltdown's Only-Failure Point Costs Nine Minutes Against A Ten-Minute Budget

`test-cases/end-to-end/medium/meltdown/v2.0.0` grades `trip/only-failure`
through a drive that takes about nine minutes of wall clock on an idle
machine. Its validator project raises `testTimeout` to `600_000` ms, twice the
harness default of `300_000`, so the point finishes with roughly a tenth of its
budget to spare.

## Current behaviour

The point passes when nothing else is running. Under load it does not: in a
sweep of all 100 produced runs from the 2026-09-10 batch, four suites running
at once, it reported

    Error: Test timed out in 600000ms.

on `meltdown/base/simple-2d/gpt-5.6-sol`, and the whole
`meltdown/base/structured-2d/gpt-5.6-sol` suite exceeded a 25-minute cap
without reporting at all. Re-run alone, the same point passes in 8m58s.

A timed-out point is reported as `[fail]` with no expected and no actual, which
is indistinguishable in a run record from a real assertion failure — see
`development/` on reading validator output. So the cost does not merely make
runs slow; it charges a model with a failure it did not cause, and does so
non-deterministically.

## Design

Make the drive cost what it reads, the way cascade's four `trail-*` points were
changed in this batch: they stepped at the flight clock's 240 Hz for a drive
whose readings only change at the case's own runout rate, and stepping at that
rate turned 960 frames into 120 with no loss of what the point decides.

Read `trip/only-failure`'s drive for the same shape — a sampling rate finer
than anything it asserts, a sweep that runs past the state it waits for, or a
per-frame read that could be a `page.evaluate` returning only numbers. Land the
budget comfortably inside the default `300_000` ms rather than raising the pin
again.

The sibling `trip/returns-cold` in the same directory is worth reading at the
same time; it was the next-slowest point in that suite.
