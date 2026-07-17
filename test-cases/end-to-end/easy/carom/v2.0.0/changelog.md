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
  JSON-serializable `snapshot()` (now including a `muted` flag), plus control
  operations that set up a scenario through the game's real systems: `startMatch`,
  `serve`, `setScore`, `setPaddle`, and `setBall`. Calling a control operation puts
  the paddles under the caller's control so a scenario can be driven
  deterministically.
- **Input injection** — `keyDown(code)`, `keyUp(code)`, and `press(code)` drive the
  game through the same handling the real keyboard feeds, so a caller can navigate
  the menus, start a match, pause, toggle mute, and move a paddle exactly as a
  player would. Unlike the control operations, injecting input does not hand paddle
  control to a driver, so it exercises the real key bindings — which is how the
  controls themselves are checked.
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

## Reviewer checklist reorganized into categories

The reviewer checklist is now grouped into **categories** — Gameplay, Paddles,
Ball, Spin, Single Player Controls, Multi Player Controls, UI, and Audio — with
every graded point a **sub-item** worth one whole point (no fractional scoring).
The controls are now checked point by point (Up, Down, W, S, Esc, P, M for each
mode), driven through the new input-injection API; a paddle held against the field
bound is a Spin sub-item; and the game states are split out under UI. The
variant-specific points are grouped too: base's serve direction under a **Serving**
category, gyre's oriented bounces and serve direction under a **Gyre** category, and
multi's three-ball behaviors under a **Multi-ball** category. Everything mechanical
(scoring, match/deuce rules, hit angle, rally acceleration, obstacle bounces and
no-tunnel, the whole spin mechanic, serve direction, and every control) is
auto-validated; the motion trail, beatable AI, and all of UI and Audio remain
judged by eye.

## Otherwise unchanged

Nothing about how Carom plays changed: the field, paddles, spin mechanic,
obstacles, balls, scoring, and match flow are as in the previous version, and the
scoring domains are unchanged.
