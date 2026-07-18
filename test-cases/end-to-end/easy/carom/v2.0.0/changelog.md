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

All three reference builds — **base**, **gyre**, and **multi** — implement the new
`window.__carom` API and the debug overlay, each exposing the variant-specific state
its checks need (gyre a `setObstacleClock` to pose the tilted faces, multi a seedable
launch RNG and three-ball snapshot).

## Reviewer checklist reorganized into categories

The reviewer checklist is now grouped into **categories** — Gameplay, Paddles,
Ball, Spin, Single Player Controls, Multi Player Controls, Color, UI, and Audio —
with every graded point a **sub-item** worth one whole point (no fractional scoring).
Several mechanical points are checked more finely so a build fails exactly the half
it gets wrong: scoring is one point **per goal** (player one past the right goal,
player two past the left), hit angle is split into a **center** (returns straight)
and an **edge** (steep deflection) point, and rally acceleration is split into
**accelerates after each hit** and **caps at the speed ceiling**. The controls are
checked point by point (Up, Down, W, S, Esc, P, M for each mode), driven through the
new input-injection API; in Versus each movement key must move **only** its own
paddle (so a build that lets the arrow keys drag player one's paddle as well as
player two's is caught). A paddle held against the field bound is a Spin sub-item.
Scoring around the countdown is checked too: that the game can be **paused during the
pre-serve countdown** and that the **countdown freezes while paused**. Serve direction
is checked as three separate Gameplay points — the very first serve and the serve
after a point is scored on each player — which base and gyre (both serving toward the
receiver) add to the common **Gameplay** category (a variant may extend a common
category); multi, which launches at random angles, has none of them. The Ball category
also confirms an **obstacle bounce keeps the ball's speed** (only a paddle hit
accelerates it).

The new **Color** category samples the pixels the build actually renders at known
on-field locations and confirms the left paddle, right paddle, and obstacles are each
drawn in a distinct, visible color (reading what is painted, not any value the game
reports). Under **UI**, each game state — title, how-to, pause, and match-over — is now
reached and **captured through the debug API**, so a reviewer sees the actual screen
(paired against the reference build's own) rather than only a submitted proof; the
auto-verdict confirms the state is reachable, while how each screen reads is still
judged by eye. Gyre's **Gyre** category now also confirms the obstacles **sway** and
**spin** (reading their posed pose back), alongside the oriented bounce, and multi's
**Multi-ball** category adds a **collision with a respawning ball** (a live ball
rebounds off a held, respawning one without either passing through). The motion trail,
the beatable AI, the UI window-fit point, and all of Audio remain judged by eye.

## Otherwise unchanged

Nothing about how Carom plays changed: the field, paddles, spin mechanic,
obstacles, balls, scoring, and match flow are as in the previous version, and the
scoring domains are unchanged.
