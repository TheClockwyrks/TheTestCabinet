Reviewer-checklist reorganization for co-location. No requirement was added,
removed, or reworded, and scoring is unaffected — item weights, sub-items,
domains, references, and proofs are all unchanged, and review-item scoring is
order-independent, so this only changes the order a reviewer works the checklist.

## Economy and phase items regrouped

The defense checklist's economy/phase items were scattered: `sell-refund` sat at
the very top of the Tower Defense run, while its natural siblings `opening-build`
and `surge-and-waves` sat at the very bottom — nine items away, on the far side
of the whole floor-geometry and tower-roster sections. Since a tower's full
refund is only available during the untimed opening build phase, a reviewer
testing the refund/economy/phase system had to jump back and forth across the
list.

The defense items now read as three adjacent clusters, in the order a reviewer
naturally encounters them:

- **Floor and maze geometry** — `mazing`, `cant-seal`, `opposite-exhaust`,
  `casing-wall`, then `flyers-and-flak` (the maze-bypass check).
- **Tower roster** — `tower-roster`, `tower-sizes`, `tower-info`.
- **Economy and build phases** — `opening-build`, `sell-refund`,
  `surge-and-waves`, so the untimed opening phase, the phase-dependent refund
  rule, and the wave/economy loop are checked together.

`sell-refund` moved from the head of the defense section down into the economy
cluster, and `opening-build` now precedes it so the full-refund-only-in-the-
opening-phase pair is adjacent. The heat cluster (all nine Heat & Thermal Play
items) and the general cluster (game states, modes and difficulty, window fit)
were already co-located and are unchanged.
