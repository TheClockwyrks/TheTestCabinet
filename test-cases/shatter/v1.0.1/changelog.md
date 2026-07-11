Warhead star-recycling now preserves a rock's damage, bullets must draw a
motion trail, and audio is now required. The reference screens are also reworked:
they are captured from the playable reference builds and treated as illustrative
examples rather than layouts to reproduce, and each variant now seeds a single
mode spec to a stable path against one scoring domain.

## Warhead: star recycling preserves a rock's damage

When an armored rock is pulled into the star and recycled, it re-enters from the
edge carrying the **same remaining health** it had, instead of returning to full
health — the star relocates the rock rather than replacing it. A Large already
chipped to 1 HP comes back at 1 HP, not 3. Because it keeps that remaining
health, it also re-enters **still rendering its damaged state** — the same
brighter, jagged, cracked look it had when the star took it, never redrawn as a
pristine full-health rock — so the preserved damage is visible the moment it
re-appears. Its move speed is still reset to a
fresh base drift (as recycling always did), so rocks slung through the star
repeatedly do not keep accelerating. This closes a loophole where feeding a
nearly-dead rock to the star handed it back at full armor. Updated
`specs/mode-warhead.md` and `specs/playfield.md`, and a new `warhead-recycle-damage`
review item; the `warhead-armored-rocks` item no longer claims recycled rocks
re-enter at full health, and the warhead reference implementation matches.

## Bullets must leave a motion trail

Each moving bullet now has to draw a continuous, tapering comet along its recent
path, so the way the star curves a shot reads at a glance. The trail is one smooth
streak in the bullet color `#f2f5f7` (not a row of discrete dots) that spans a
fixed slice of recent travel time (`0.12`–`0.18 s`), so its length tracks the
bullet's speed, and it follows the bullet across a screen wrap rather than smearing
across the field. The reference `gameplay` mockup already depicted this "gravity
signature" streak; the specs (`specs/playfield.md`, `specs/overview.md`,
`specs/physics.md`, `specs/proof.md`) and a new `bullet-trail` review item now make
it a hard requirement, and the base and warhead reference implementations render it.

## Audio is now required

Sound was previously "recommended but optional"; `specs/flow.md` now **requires**
it — Web Audio API synthesis (no audio files) for firing, a rock shattering, the
ship's thrust, the saucer's presence, and the ship being destroyed. The safety
rails are unchanged: the game must stay fully playable muted, must never fail to
run or load if audio cannot start, must expose a mute toggle, and must not start
audio until the player interacts.

## Reference screens are captured from the playable reference builds

The reference screenshots are now derived from the case's authored, correct
reference-impl builds rather than hand-authored HTML/CSS mockups. The former
`*.html` mockups and `theme.css` were removed, and the manifest's `[[reference]]`
entries now point at committed screenshots via `media` (served as-is) instead of a
rendered `path`. The images were flattened from per-variant folders to
`reference/screenshots/title.png`, `gameplay.png`, and `game-over.png` (the three
common views, shared from the `base` build) plus
`reference/screenshots/warhead/warhead.png` (captured from the `warhead` build).
This removes the separate mockup that had to be kept in sync with the specs: the
reference-impl builds are now the single source of truth, and `reference/README.md`
documents how to recapture the frames from them.

## Reference screens are examples, not targets to reproduce

The references are now framed as illustrative examples of the intended look, not
layouts to match — the model designs its own menus and layout from the
specification, and the only firm requirement is that every mandated menu and
navigation path is present in the specified palette and type. Accordingly the
`title` reference-similarity `[[check]]` was dropped: the screens are reviewed by a
human rather than scored against a baseline, though the automated load check still
runs. This is reflected in `specs/overview.md`, `prompt.hbs`, and the manifest.

## One mode spec per variant, one scoring domain

Every variant now seeds exactly one mode spec to the stable dest `specs/mode.md`,
which the common specs reference by that name. Previously `base` seeded no mode
spec and read the common specs' defaults; it now seeds an explicit
`specs/mode-standard.md` (rocks take a single hit, primary gun only), and the
warhead spec moved from the nested `specs/modes/warhead.md` to a flat
`specs/mode-warhead.md`. Because a stable `specs/mode.md` is always present, the
common specs (`specs/overview.md`, `specs/playfield.md`, `specs/physics.md`) defer
their mode-varying rules to it directly instead of "the mode spec under
`specs/modes/` when one is seeded." Both variants are the same single game mode, so
the case now rates them on its sole common `arcade` domain — the `warhead`
variant's separate `warhead` scoring domain was removed and its review items roll
up to `arcade` implicitly.

## Other changes

- Reworked the prompt's "What to read first" to point at the `specs/` directory
  and require an implementation that matches the specification exactly, rather than
  enumerating every spec file and prescribing a reading order.
- Reworded the `hud-rendering` review item to require every menu be present and
  navigable, dropping the "per the references" phrasing.
- Changed "reviewer" to "viewer" in `specs/proof.md`, and a small wording tweak in
  `specs/overview.md` ("does not satisfy this requirement").
