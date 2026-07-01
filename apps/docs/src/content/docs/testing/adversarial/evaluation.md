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

Each match produces an outcome — a win, a loss, or a draw — and a forfeit on
disqualification. The winner is the colony with the higher banked score, or the
side that swept; **a level banked score at `max_ticks` is broken by efficiency** —
the controller that consumed the **least total fuel** over the match wins, since it
reached the same result for less work. A match is only a true **draw** when the
banked scores *and* the total fuel are level (or both controllers forfeit on the
same tick) — a vanishing case between two distinct controllers. The fuel a
tie-break compares is the whole-match total, not the per-tick peak the sandbox caps
(see [Game code & replay](/testing/adversarial/foray/architecture/)).

The match [`structure`](/testing/adversarial/manifests/) declared by the case (for
example round-robin or a bracket) decides how the field is paired, and a model's
standing follows from its **number of wins** across the matches it played —
tournaments rank by wins, not by total points banked. Because the faked, fixed
[timestep](/testing/adversarial/overview/#lockstep-simulation-and-replays) makes a
recorded match reproducible, a result does not depend on which machine produced
it.

:::note[v1 scores one match against a committed baseline]
Field-wide round-robin / bracket standings are the **design target**, but they are
not what the first adversarial case does today. In v1, a run is scored on a
**single canonical match** against a baseline opponent the case commits — for
[Foray](/testing/adversarial/foray/references/#the-canonical-opponent-v1-scoring)
that is `border-soldier`. The manifest's `[match]` structure is still recorded
faithfully; cross-model tournaments are a planned later step.
:::

## Proof replays

On completion, a run is auto-replayed against **every committed reference
opponent**, not just the canonical one, and each match's replay is published as a
run asset. For [Foray](/testing/adversarial/foray/references/) that
is the three baselines — `border-soldier`, `greedy-raider`, and `random` — plus a
**hidden** stronger reference, `fuel-probe`, that is never given to the model.
`border-soldier`'s match is the canonical scored one (mirrored to the run's
recorded outcome); `greedy-raider` and `fuel-probe` are recorded as scored
evidence too; `random` is kept as an unscored *exhibition* (beating it carries no
signal, but the replay is still watchable).

These replays **replace proof-of-implementation** for adversarial cases. Other
test types declare proof artifacts the agent must produce and a reviewer checks
are present; an adversarial run instead proves itself by *playing* — the matches
are programmatic and reproducible from the recorded ticks, so there is nothing for
the model to fake and nothing for a reviewer to take on trust.

## Replays and review

Every match is recorded as **replay data** sufficient to reconstruct the
simulation deterministically. The replay is what is published: it is rendered in
the browser on the [public site](/components/site/overview/) so a reader can watch
the match unfold, the same way an end-to-end build is embedded and played. The
run-detail view offers an opponent selector so a reviewer can watch the submission
against each reference opponent in turn. A human
[review](/components/core/results/#reviews) may still accompany a published run — a
writeup of how a controller played, what strategy it appeared to use, and where it
failed — but the decisive signal for an adversarial case is the match record
itself, not a reviewer's rating.

## The arena: reviewing before publishing

A controller need not be published to be watched. The **arena** (a console-only,
adversarial-only surface) pits any two controllers in a transient *quick match* or
runs a whole field as a *tournament*. Its controller list is the committed
opponents (including the hidden `fuel-probe`), a chosen **worker's**
locally-produced runs, and every **pushed** controller. Local runs are resolved
from the worker that produced them — a dropdown selects which worker contributes
its local implementations — so a reviewer can pit an implementation **before**
pushing it. A pushed run uploads its controller wasm to the backend at push time,
so a pushed implementation is always selectable from any host, even one that did
not produce it.
