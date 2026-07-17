This release adds a required **debugging and automation surface** to every
variant, so the game can be driven and inspected from code rather than only by
hand. It is a new, mandatory deliverable — hence the major version bump.

## New: the `window.__carom` debug API and overlay

A new common spec, `specs/instrumentation.md` (seeded for every variant), requires
the build to expose a small debugging and automation API on `window.__carom` and
a read-only debug overlay:

- **Deterministic, steppable core.** `specs/physics.md` already required a fixed
  timestep; it now also requires the core simulation to be **render-free** (state
  advances by stepping it, with no dependence on the canvas or wall-clock time)
  and any randomness to run off a **seedable** generator, so a scenario replays
  identically.
- **`window.__carom`** — core operations `reset(options)`, `step(seconds)`, and a
  JSON-serializable `snapshot()`, plus control operations that set up a scenario
  through the game's real systems: `startMatch`, `serve`, `setScore`,
  `setPaddle`, and `setBall`. Calling a control operation puts the paddles under
  the caller's control so a scenario can be driven deterministically.
- **Debug overlay** — a read-only on-screen display of the live internal state
  (screen, mode, scores, and each ball's and paddle's position, velocity, speed,
  and spin), toggled with the backtick key, off by default, never affecting
  gameplay.

The `specs/overview.md` hard-requirements list and file map, the `prompt.hbs`
build and verification steps, and `specs/proof.md` (which now notes that the
debug API can set up the exact state each capture needs) are all updated to match.
The surface is framed throughout as an ordinary developer affordance of the game.

## Reference implementations

The **base** reference build implements the new `window.__carom` API and the
debug overlay. The `gyre` and `multi` reference builds are being brought up to the
same surface.

## Added a reviewer checklist item for spin at the field bound

A new reviewer checklist item (`spin-at-bound`) pins down a mechanically-checkable
edge case of the spin rule: a paddle held against the top or bottom bound is
stationary — it cannot move out of the field — so it imparts no spin, even while
the movement key is held. No seeded spec text changed; "a still paddle imparts no
new spin" already covers this, and the item just calls the edge case out for
review.

## Otherwise unchanged

Nothing about how Carom plays changed: the field, paddles, spin mechanic,
obstacles, balls, scoring, and match flow are as in the previous version, and the
scoring domains are unchanged.
