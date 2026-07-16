Reordered the common reviewer checklist so each item sits next to the others a
reviewer checks in the same play moment. No requirement was added, removed, or
reworded, and scoring is unaffected: the checklist is weight-based and
order-independent, so regrouping changes only the order a reviewer works through
it, not the score. Only the common `[[review_item]]` order in `test-case.toml`
changed; the `base` and `warhead` variant files are untouched (the warhead
items were already grouped — the two armored-rock items, then the two torpedo
items).

## Reviewer checklist regrouped by entity and play moment

Several checks were interleaved so that testing one thing meant hunting up and
down the list. The HUD-rendering item sat five items away from scoring though
both read the HUD; the wave-progression item (a rock check) was stranded between
the two bullet items and the saucer, splitting it from rock splitting; the audio
item interrupted the run from scoring into the game-state screens; and the
controls item was buried in the tail, far from the inertial-flight item it is
naturally exercised alongside.

The items now flow in the order a reviewer encounters them while playing: ship
handling (inertial flight, controls, screen wrap), then the star and gravity
well (gravity well, solid core, rock recycling), the rocks (splitting, waves),
the bullets (motion trail, limits), the saucer, then the progression and HUD
readouts (lives and respawn, scoring, HUD/menu rendering), the screens (all game
states, then the game-over screen), and finally the global environment checks
(synthesized audio, window fit). Every item's `id`, `text`, `weight`,
`reference`, `proof`, and `sub_items` are unchanged, and the total weight across
the common items and both variants is identical to `v1.0.1`.
