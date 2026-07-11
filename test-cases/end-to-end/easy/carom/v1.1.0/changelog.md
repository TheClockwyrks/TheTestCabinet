This release reworks Carom's variants so each one changes the rules of the game
itself rather than adding a menu mode, reworks Multi into three independent
contests, and restructures the specification so every variant's seeded spec set
reads as one self-contained game.

## Dropped the Frenzy variant

The uncapped-speed Frenzy mode is gone, along with its spec, its menu reference,
its scoring domain, and its review item. It was the only variant built around an
override of the speed rule (`speed * 1.04`, capped at `980 px/s`); removing it
lets the physics spec state that rule once, without per-mode exceptions.

## Variants change the rules, not the menu

Gyre and Multi are no longer separate menu modes shown alongside Solo and Versus.
Each variant now changes the rules of the game itself — applied equally to Solo
and Versus — instead of adding a mode next to them. The per-variant `gyre` and
`multi` scoring domains are removed; every variant is rated on the common
`single-player` and `versus` domains, and every variant's main menu is just
`SOLO` / `VERSUS` / `HOW TO PLAY`. Each variant's `title` reference still differs,
but only to hint at that variant's rules in the dimmed field behind the menu
(static vs. tilted obstacles, one ball vs. three).

## Reworked Multi into three independent contests

The three balls are now independent contests rather than a single rally that
resets on any goal. Each ball has a fixed home point on the centerline (25% / 50%
/ 75% of field height), its own countdown, and an independent respawn: when one
ball scores it resets and relaunches on its own while the other two keep playing —
the field never freezes and the other balls are never reset. Every launch — the
first serve and each relaunch — is at a uniformly random angle over the full
360&deg;, independent of which side scored. A ball held at its home point during
its countdown is solid, and other balls bounce off it. Multi's single
`multi-three-balls` review item is replaced by five that pin down these behaviors
individually: three balls in play, distinct spawn points, independent respawn,
random launch angle, and ball-to-ball collision.

## Restructured the specs

The `specs/modes/` folder is gone. The material that varies between variants is
now seeded per variant to two stable paths the common specs reference —
`specs/obstacles.md` (how the obstacles behave) and `specs/balls.md` (how the
balls are served) — so each variant's seeded set reads as one self-contained game
with no cross-variant language. The always-present `specs/modes/standard.md`
becomes the common `specs/modes.md`. `serve-direction` moved from the common
review items to the `base` and `gyre` variants (Multi serves at a random angle
and so does not check it).

## Audio is now required

Audio was previously "recommended but optional"; it is now **required** —
synthesized with the Web Audio API (no audio files) with distinct blips for a
paddle hit, a wall/obstacle bounce, and a scored point. The game must still remain
fully playable with sound muted and must never fail to run or load if audio cannot
start, so the mute toggle and the no-autoplay-until-interaction rule are retained.

## Reference screenshots are illustrative, not validated

The `reference/` screenshots are now framed as illustrative examples of the
screens rather than layouts to reproduce: the model designs its own menus and
layout, and the only firm requirement is that every menu and navigation path the
spec mandates is present in the defined palette and type. Accordingly the
title-screen reference-similarity `[[check]]` is dropped — menus and screens are
reviewed by a human rather than scored against a baseline — though the automated
load check still runs.

## Split review items into finer-grained sub-items

Several review items now carry `sub_items` so a reviewer grades two independent
points and the item's weight splits evenly across them: paddle spin (no spin while
stationary vs. imparts spin while moving), paddle hit angle (center vs. edge),
obstacle bank shots (bounces vs. never tunnels), and gameplay keybinds (movement
keys vs. pause). This keeps a build from earning full credit for an item when it
only satisfies half of it.

## Reference builds for every variant

The `gyre` and `multi` variants now ship their own authored reference
implementations (`reference-impl/gyre` and `reference-impl/multi`), joining
`reference-impl/base`; each is a buildable web project shown on the case's
"Reference" tab and is never seeded into a run.

## Other changes

- Reworded the `menu-rendering` review item from matching "the provided
  references" to menus that "render cleanly, are present and navigable" — a
  consequence of references no longer being reproduction targets.
- Reworded the out-of-scope note on destructible obstacles: obstacles are "never
  destroyed, removed, or broken," dropping the reference to the old mode specs.
