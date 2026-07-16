Reviewer-checklist reorganization for co-location. No requirement was added,
removed, or reworded, and scoring is unaffected.

## Drilling checks co-located

The two review items a reviewer observes in the same play moment — the very act
of drilling down through the tile world — were separated in the list.
`dig-and-move` (drill down/left/right, fall, thrust) sat first, but
`depth-bands-hardness` (the four bands getting harder, unbreakable stone to route
around, the drill-damage crack overlay) sat two items later, after the
`fuel-round-trip` and `ore-economy-upgrades` economy checks. A reviewer testing
whether drilling works — and whether bands harden, boulders block, and cracks
deepen — had to either check band hardness out of order or re-observe it later.

`depth-bands-hardness` now immediately follows `dig-and-move`, so the two
tile-world drilling checks are adjacent at the top of the Mine & Expedition
Systems block, and the descent reads top-to-bottom: drill the world, then the
fuel/weight round-trip, then the ore-to-Credits economy, then the material hunt,
hazards, the core run, the rocket, and finally the modes/save meta. The
presentation and general (states, window fit) items are unchanged.

## No scoring change

Only the order of `[[review_item]]` blocks changed. All 18 items, their `id`s,
`text`, `weight`, `domain`, and `proof` are identical to v1.0.0; the total weight
(18) and the requirement set are unchanged. Scoring is weight-based and
order-independent, so this revision affects only reviewer ease, not any run's
score. The `[[domain]]` definitions and every spec, reference, and proof
declaration are untouched.
