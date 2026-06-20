---
title: Evaluation
---

An adversarial run is scored by **competition**, not by comparison to a reference.
A model's controller is run against the field of other models' controllers, and
its score is its **record** across those matches. This makes adversarial the one
test type whose results are inherently relative: a controller is only as good as
the opponents it beats, so a model's standing is meaningful only within a field
of submissions.

## Building and legality

Before a controller can compete it has to be admissible, which is a gate, not a
score:

- **It must build.** The harness runs the manifest's required
  [`[build]` commands](/testing/adversarial/manifests/) and loads the produced
  wasm module. A submission that fails to build or does not export the contract's
  [`entry`](/testing/adversarial/manifests/) function cannot compete and is
  recorded as such.
- **It must stay legal at runtime.** A controller is bound by the
  [sandbox limits](/testing/adversarial/overview/#sandbox-and-execution) on every
  tick. Exhausting its fuel, exceeding its memory cap, trapping (crashing), or
  returning an action the contract rejects is a **disqualification** for that
  match — the offending controller forfeits and the match continues. The
  authoritative game state is never exposed to the controller, so there is no way
  to win by cheating; an attempt to reach state directly simply cannot compile
  against the contract.

A submission that builds and never breaks the rules competes on the merits of its
play.

## Standings

Each match produces an outcome — a win, a loss, or a draw (including a draw on
reaching `max_ticks`) — and a forfeit on disqualification. The match
[`structure`](/testing/adversarial/manifests/) declared by the case (for example
round-robin or a bracket) decides how the field is paired, and a model's standing
follows from its aggregate record across the matches it played. Because the
faked, fixed [timestep](/testing/adversarial/overview/#lockstep-simulation-and-replays)
makes a recorded match reproducible, a result does not depend on which machine
produced it.

## Replays and review

Every match is recorded as **replay data** sufficient to reconstruct the
simulation deterministically. The replay is what is published: it is rendered in
the browser on the [public site](/components/site/overview/) so a reader can watch
the match unfold, the same way an end-to-end build is embedded and played. A
human [review](/components/core/results/#reviews) may still accompany a published
run — a writeup of how a controller played, what strategy it appeared to use, and
where it failed — but the decisive signal for an adversarial case is the match
record itself, not a reviewer's rating.
