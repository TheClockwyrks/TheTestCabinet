Adds a required bullet motion trail and makes Warhead star-recycling preserve a
rock's damage; otherwise prompt wording only.

- **Warhead: star-recycling now preserves a rock's damage.** When an armored rock
  is pulled into the star and recycled, it re-enters from the edge carrying the
  **same remaining health** it had, instead of returning to full health — the star
  relocates the rock rather than replacing it. Its move speed is still reset to a
  fresh base drift (as recycling always did), so rocks slung through the star
  repeatedly do not keep accelerating. Updated `specs/mode-warhead.md` and
  `specs/playfield.md`, a new `warhead-recycle-damage` review item, and the warhead
  reference implementation.
- **Bullets now must leave a motion trail.** The specs (`specs/playfield.md`,
  `specs/overview.md`, `specs/proof.md`) and a new `bullet-trail` review item
  require each moving bullet to draw a continuous, tapering comet along its recent
  path, so the star's curving of a shot reads at a glance. The reference
  `gameplay` mockup already depicted this "gravity signature" streak; the base and
  warhead reference implementations now render it too.
- Reworked the prompt's "What to read first" section to simply point to the
  `specs/` directory and require an implementation that matches the specification
  exactly, rather than enumerating every spec file and prescribing an order to
  read them in.
