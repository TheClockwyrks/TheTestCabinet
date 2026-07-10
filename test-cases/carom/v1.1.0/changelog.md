Reworked the case's variants and restructured the specification.

- **Dropped the Frenzy variant.** The uncapped-speed mode is gone, along with its
  spec, menu reference, scoring domain, and review item.
- **Gyre and Multi are no longer separate menu modes.** Each variant now changes
  the rules of the game itself — applied equally to Solo and Versus — instead of
  adding a mode alongside them. The per-variant `gyre` and `multi` scoring domains
  are removed; every variant is rated on the common `single-player` and `versus`
  domains, and every variant's main menu is just `SOLO` / `VERSUS` / `HOW TO PLAY`.
- **Reworked Multi.** The three balls are now independent contests rather than a
  single rally that resets on any goal. Each ball has a fixed home point on the
  centerline (25% / 50% / 75% of field height), its own countdown, and an
  independent respawn: when one ball scores it resets and relaunches on its own
  while the other two keep playing. Every launch — the first serve and each
  relaunch — is at a uniformly random angle over the full 360&deg;, independent of
  which side scored. A ball held at its home point during its countdown is solid,
  and other balls bounce off it.
- **Restructured the specs.** The `specs/modes/` folder is gone. The material that
  varies between variants is now seeded per variant to two stable paths the common
  specs reference — `specs/obstacles.md` and `specs/balls.md` — so each variant's
  seeded set reads as one self-contained game. `serve-direction` moved from the
  common review items to the `base` and `gyre` variants (Multi serves at random and
  does not check it).
