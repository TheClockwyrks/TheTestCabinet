Reviewer-checklist co-location: the Foundry Systems review items are reordered so
the checks a reviewer works while testing one mechanic sit together.

## Review items regrouped for co-location

The `[[review_item]]` blocks are the reporter-side checklist a reviewer works
top-to-bottom while playing the build. Two mechanics had their checks scattered
down the Foundry Systems list, forcing a reviewer to jump around while testing a
single thing:

- **The quality axis.** `quality-ladder` (the five-rung tier power axis) and
  `upgrade-quality` (the press-refinement track that biases the roll up that same
  ladder) sat four items apart, separated by the component, enemy, and economy
  items. They are now adjacent, so the reviewer confirms the ladder and the
  refinement that climbs it in one pass.
- **The towers cluster.** `component-types` (the eight base types), then later
  `combination-towers` (the recipe-combined turrets) and
  `status-effects-abilities` (the slow / burn / crit / multishot / aura
  vocabulary the combos carry) were spread across the list with the enemy,
  economy, difficulty, and pause items wedged between them. The three
  tower-behavior checks are now consecutive, matching how a reviewer inspects
  towers on the board.

The new Foundry Systems order is: board (`maps-and-waypoints`,
`waypoint-mazing`), the build loop (`scrap-press-roll`, `keep-one-per-level`),
the quality axis (`quality-ladder`, `upgrade-quality`), the towers
(`component-types`, `combination-towers`, `status-effects-abilities`), the
enemies (`load-and-flyer`), and the run-level items (`economy-integrity-campaign`,
`difficulty-in-game`, `pause-in-place`). The Presentation & Electrical VFX and
General sections are unchanged.

No requirement was added, removed, merged, or reworded — only the order of the
simulation-domain items changed, and item `id`s, `text`, `weight`, `domain`,
`reference`, and `proof` are all untouched. Scoring is weight-based and
order-independent, so the run's score is unaffected; the change only shortens the
reviewer's path through the checklist.
