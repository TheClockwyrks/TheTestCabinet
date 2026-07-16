Reviewer-checklist co-location: the `[[review_item]]` blocks are reordered so a
reviewer works all the checks for one thing together.

## Review items regrouped for co-location

The checklist now runs as three contiguous blocks that mirror the scoring
domains and the reviewer's play flow:

- **Polarity & Survival** — `match-destroys`, `dual-use-shield`, `flip-lockout`,
  `resonance-discharge` (unchanged; already adjacent).
- **The Swarm** — `entrance-and-formation`, `dive-attacks`, `shard-fixed-band`,
  `flux-oscillates`, `prism-sequence`, `spectral-inversion`, `challenge-stage`,
  and now `uses-provided-burst`. The drone-burst item rolls up to the `swarm`
  domain (the effect plays when a drone pops), but previously sat down in the
  general block, splitting the swarm domain across the list. It moves up to close
  the swarm cluster, so every swarm-rated check is worked in one pass.
- **General** — `uses-provided-art`, `lives-and-scaling`, `audio`,
  `states-complete`, `fits-window`, clustered at the end. `lives-and-scaling`
  moves down below the two "renders from the provided assets" checks
  (`uses-provided-burst` and `uses-provided-art`), which now sit adjacent so the
  reviewer confirms both seeded-asset requirements together.

No review item, sub-item, or requirement was added, removed, merged, or
reworded, and no `weight`, `domain`, `reference`, or `proof` changed. Because
scoring is weight-based and order-independent, the reordering is purely a
reviewer-ergonomics change and does not affect any run's score. The total
available weight (17) and the full requirement set are identical to v1.0.0.
