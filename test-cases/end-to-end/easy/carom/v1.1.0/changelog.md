## Dropped the Frenzy variant

The uncapped-speed Frenzy mode is gone, along with its spec, its menu reference,
its scoring domain, and its review item. It was the only variant that overrode
the speed rule, so removing it lets `specs/physics.md` state `speed * 1.04`,
capped at `980 px/s`, once and without exceptions.

## Variants change the rules, not the menu

Gyre and Multi are no longer extra menu modes beside Solo and Versus. Each
variant now changes the rules of the game itself, applied equally to both ways to
play, so every variant's main menu is just `SOLO` / `VERSUS` / `HOW TO PLAY` and
every variant is rated on the common `single-player` and `versus` domains — the
per-variant `gyre` and `multi` domains are removed. The `specs/modes/` folder is
gone with them: the material that varies is now seeded per variant to two stable
paths the common specs reference, `specs/obstacles.md` and `specs/balls.md`, so
each variant's seeded set reads as one self-contained game with no cross-variant
language. A variant's `title` reference still differs, but only to hint at its
rules in the dimmed field behind the menu.

## Multi is three independent contests

The three balls no longer start, reset, or score as a group. Each has a fixed
home point on the centerline (25%, 50%, and 75% of field height), its own
countdown, and its own respawn: a ball that scores resets and relaunches alone
while the other two keep playing. Every launch, first serve and relaunch alike,
is at a uniformly random angle over the full 360 degrees, and a ball waiting out
its countdown is solid, so live balls bounce off it. The single
`multi-three-balls` review item becomes five, one per behavior.

## Audio is now required

Audio was recommended but optional; it is now required, synthesized with the Web
Audio API with distinct blips for a paddle hit, a wall or obstacle bounce, and a
scored point. The game must still play fully muted and must never fail to run or
load if audio cannot start, so the mute toggle and the no-autoplay rule stay. A
matching `audio` review item is added.

## Reference screenshots are illustrative, not targets

The `reference/` screenshots now read as examples of the screens rather than
layouts to reproduce: the model designs its own menus, and the firm requirement
is only that every mandated menu and navigation path is present in the defined
palette and type. The title-screen reference-similarity `[[check]]` is dropped
accordingly, though the automated load check still runs.

## Other changes

- Split four review items into `sub_items` so half-credit is impossible: paddle
  spin, paddle hit angle, obstacle bank shots, and gameplay keybinds.
- Moved `serve-direction` out of the common items into `base` and `gyre`; Multi
  serves at a random angle and does not check it.
- Reworded `menu-rendering` from matching "the provided references" to menus that
  render cleanly and are navigable.
- Reworded the out-of-scope note on destructible obstacles, which are now simply
  "never destroyed, removed, or broken."
