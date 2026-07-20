## Warhead star recycling preserves a rock's damage

A rock pulled into the star now re-enters from the edge carrying the same
remaining health, still rendering its damaged state, rather than returning to
full health — the star relocates a rock rather than replacing it. Its move speed
is still reset to a fresh base drift, so rocks slung through the star repeatedly
do not keep accelerating. This closes a loophole where feeding a nearly-dead rock
to the star handed it back at full armor.

## Bullets must leave a motion trail

Every moving bullet now has to draw a continuous, tapering comet along its recent
path, so the way the star curves a shot reads at a glance. It is one smooth
streak in the bullet color rather than a row of discrete dots, spanning a fixed
slice of recent travel time so its length tracks the bullet's speed, and it
follows the bullet across a screen wrap. The gameplay reference already showed
this streak; it is now a hard requirement with its own review item.

## Audio is required

Sound was previously recommended but optional; it is now required — Web Audio API
synthesis, no audio files, for firing, a rock shattering, the ship's thrust, the
saucer's presence, and the ship being destroyed. The safety rails are unchanged:
fully playable muted, never fails to run or load if audio cannot start, a mute
toggle, and no audio until the player interacts.

## Reference screens are examples, captured from the playable builds

The hand-authored HTML mockups and their stylesheet are gone. The reference views
now point at committed screenshots captured from the case's playable reference
builds, so there is no separate mockup to keep in sync with the specs. They are
also reframed as illustrative examples rather than layouts to reproduce: the
model designs its own menus and layout from the specification, and the only firm
requirement is that every mandated menu and navigation path is present in the
specified palette and type. The `title` reference-similarity check was dropped
accordingly, leaving those screens to human review.

## One mode spec per variant, one scoring domain

Every variant now seeds exactly one mode spec to the stable dest `specs/mode.md`,
which the common specs defer to by name. Previously `base` seeded none and read
the common specs' defaults; it now seeds an explicit standard ruleset where rocks
take a single hit and the ship carries only its primary gun. Both variants are
the same single game mode, so the case rates them on its sole `arcade` domain and
the separate `warhead` domain was removed.

## Other changes

- Every review item gained independently graded sub-items.
- The screen-wrap item now names the saucer alongside the ship, bullets, and
  rocks.
- The prompt's "What to read first" points at the `specs/` directory rather than
  enumerating every spec file and prescribing a reading order.
- The `hud-rendering` item requires every menu to be present and navigable,
  dropping the "per the references" phrasing.
