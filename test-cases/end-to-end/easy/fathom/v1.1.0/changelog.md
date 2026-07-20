## Two dives replace the three mode variants

The Murk, Reserve, and Beam variants are dropped. The case now offers two dives
that share everything but how you read the dark: **base (Trench)**, a remembered
fog of war with line-of-sight light and a corridor-flooding sonar, and the new
**kindle**, which adds an outer vision circle you carry — it reveals nothing, it
only limits how much of the already-revealed trench is shown. `specs/sensing.md`
is therefore no longer a common spec: it is split per variant and each dive seeds
its own at that same path, so the model always sees one self-contained sensing
spec.

## The Lanternjaw is indistinguishable from a harmless drifter

The renamed Lanternjaw (was "the Lure") now copies the bonus drifter exactly
until it fixes on you — the same slow wander speed, the same amber bell, and a
new jellyfish disguise sheet whose frames must be pixel-identical to the new
`assets/drifter/` art. Sonar no longer gives the deception away: a pulse marks
the Gloamfin and the Flarefish but leaves the amber lights untouched, so only
your own light ever reveals what hangs beneath the bulb. Drifters are also
permanent now, and there can be two.

## The Gloamfin is retuned to be escapable

The renamed Gloamfin (was "the Listener") no longer winds up ever faster. It
chases at only about 5% above your speed and drops below it at every corner, so
cutting corners — not sprinting — is the way out. Losing you, it casts about and
fires a guaranteed "lost you" ping in a distinct orange, making the escape window
visible; its pings are floored apart, and it goes silent while it already has you
at close range.

## The sonar pulse is drawn in code as a traveling wavefront

The provided `assets/sonar-pulse/` sheet is removed. The pulse is no longer an
expanding circle but a front that flows through the corridors, bending around
bends and reflecting off walls, revealing near tiles before far ones and catching
a target when the front reaches it. The same procedural effect is tinted for the
Gloamfin's ping.

## Predators path fairly and announce when they find you

A predator that has lost sight of you now paths to your last-known tile by the
shortest corridor route rather than only stepping to shorten the straight-line
distance, which used to wedge it in an L-corner. A detection alert — a flash in
the acquiring predator's color, with the predator shown lit — fires on every
acquisition path, so the two hunters that can blindside you always say so.

## Reference images are examples, not targets to match

The hand-authored HTML mockups are gone; the seeded references are screenshots
captured from the playable reference builds, plus new `sonar` and Kindle
`vision-circle` views. The prompt and specs now frame them as illustrations of
the intended look rather than layouts to reproduce, so the reference-similarity
title check is removed and menus are the model's own design.

## Other changes

- The Flarefish gives no tell but its flare, hunts your light exactly as the
  Lanternjaw does, and its flare is a persistent moving disc that pierces walls
  and catches you at any moment while it burns.
- Audio moves from optional to required, still synthesized and still fully
  playable muted.
- The two scoring domains merge into one `dive` domain that is the run's overall
  rating; several review items gain sub-items.
- `specs/playfield.md` adds soft openness and corridor-length targets so an
  authored board reads as corridors rather than rooms.
- The sonar cooldown is halved to `1.75 s`.
- Brightness holds for a short delay after your last pellet before decaying.
- Losing a life no longer refills the trench — eaten plankton stay eaten.
- Forager motion is stated as continuous rather than tile-by-tile.
