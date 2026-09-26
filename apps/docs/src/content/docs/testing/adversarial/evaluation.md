---
title: Evaluation
---

An adversarial run is scored by competition rather than by comparison to a
reference. A model's controller plays the field of other controllers, and its
score is its record across those matches. Adversarial results are therefore
relative: a controller is only as good as the opponents it beats, so a model's
standing is meaningful only within a field of submissions.

## Building and legality

Admissibility is a gate rather than a score. Two requirements must hold before a
controller competes on the merits of its play:

- It must build. The build commands run in the run container, and the validator
  loads the wasm module the manifest's `[build] module` names. A submission that
  fails to build, does not export the contract's `entry` function, or cannot
  instantiate is recorded as a forfeit loss.
- It must stay legal at runtime. A controller is bound by the
  [sandbox limits](/testing/adversarial/overview/#sandbox-and-execution) on every
  tick. Exhausting its fuel, exceeding its memory cap, trapping, or returning an
  action the contract rejects forfeits that match, and the match continues so a
  replay is still produced.

The authoritative game state is never exposed to a controller, so winning by
cheating is not expressible against the contract.

## Standings

Each match produces a win, a loss, or a draw, and a forfeit when a controller
breaks the rules. The winner is the side that swept or that holds the higher
banked score. A level banked score at `max_ticks` is broken by efficiency: the
controller that consumed the least total fuel over the match wins, having reached
the same result for less work. A match is a draw only when the banked scores and
the total fuel are both level, or when both controllers forfeit on the same tick.
The fuel a tie-break compares is the whole-match total, not the per-tick peak the
sandbox caps.

A run is scored on one canonical match: the validator loads the submission as Red
and the case's committed canonical opponent as Blue, and plays that match on the
case's fixed map and seed. The recorded outcome is from the submission's
perspective. For [Foray](/testing/adversarial/foray/references/) the canonical
opponent is `border-soldier`.

A tournament pairs a whole field by the case's declared match `structure` and
ranks its participants by number of wins, highest first, with fewest losses as
the tie-break. Because the faked, fixed
[timestep](/testing/adversarial/overview/#lockstep-simulation-and-replays) makes a
recorded match reproducible, a result never depends on which machine produced it.

## Proof replays

On completion a run is auto-replayed against every committed reference opponent,
and each match's replay is published as a run asset. For Foray those are the
three model-facing baselines `border-soldier`, `greedy-raider`, and `random`,
plus the hidden stronger reference `fuel-probe` the model never receives. The
canonical opponent's match is mirrored to the run's recorded outcome;
`greedy-raider` and `fuel-probe` are recorded as scored evidence; `random` is
kept as an unscored exhibition whose replay is still watchable.

These replays replace proof of implementation for adversarial cases. The matches
are programmatic and reproducible from the recorded ticks, so a run proves itself
by playing.

## Replays and review

Every match is recorded as replay data sufficient to reconstruct the simulation
deterministically. The replay is what is published: it is rendered in the browser
on the [public site](/components/site/overview/) so a reader can watch the match
unfold. The run detail view offers an opponent selector, so a reviewer can watch
the submission against each reference opponent in turn.

A case may declare scoring domains and a reviewer checklist, and a human
[review](/components/core/results/#reviews) may accompany a published run. The
decisive signal for an adversarial case is the match record itself.

## The arena

A controller need not be published to be watched. The arena is a console-only,
adversarial-only tab on a test case that pits any two controllers in a transient
quick match or runs a whole field as a tournament.

Its controller list is the committed opponents (including the hidden
`fuel-probe`), a chosen worker's locally-produced runs, and every pushed
controller. A local run resolves from the host that produced it, so a reviewer
can pit an implementation before pushing it. A pushed run uploads its controller
wasm to the backend at push time, so a pushed implementation is selectable from
any host, including the stateless
[arena service](/components/arena/overview/).
