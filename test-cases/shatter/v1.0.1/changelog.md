Adds a required bullet motion trail; otherwise prompt wording only.

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
