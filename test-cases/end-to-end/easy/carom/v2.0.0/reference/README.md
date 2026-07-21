# Carom — Reference Visuals

These images are the **canonical visual reference** for the Carom test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl builds** (the authored, *correct* games under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Carom's reference screenshots are **derived from the real games**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl builds *are* the ground truth, and the
screenshots are captured straight from them. The captured images are committed
here and referenced from the manifest as `media` (served as-is), because there is
no longer a mockup for the harness to render at seed time. The palette and type
the builds implement are documented in the seeded spec
[`../specs/overview.md`](../specs/overview.md), which is where a spec should cite
them.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant files) and is
**never seeded into a run** — handing over a correct implementation would let a
model copy it instead of building from the spec.

## Views

Each image corresponds to a canonical view slug. The `gameplay` and `game-over`
views are **common** — an in-match frame and the match-over card look the same in
every variant — so they are captured once from the `base` build and shared. The
`title` view is **variant-specific**: every variant lists the same menu (`SOLO` /
`VERSUS` / `HOW TO PLAY`), but each build poses its own rules in the dimmed field
behind that menu, so each variant declares its own (see the `reference` entries in
the variant files under [`../variants/`](../variants/)).

| View slug   | Image                             | Captured from        | Scope           |
| ----------- | --------------------------------- | -------------------- | --------------- |
| `title`     | `screenshots/<variant>/title.png` | that variant's build | per variant     |
| `gameplay`  | `screenshots/gameplay.png`        | the `base` build     | common (shared) |
| `game-over` | `screenshots/game-over.png`       | the `base` build     | common (shared) |

```
reference/screenshots/gameplay.png         # common (every variant)
reference/screenshots/game-over.png        # common (every variant)
reference/screenshots/base/title.png
reference/screenshots/gyre/title.png
reference/screenshots/multi/title.png
```

The three `title` images differ only in that dimmed backdrop, and the difference
is the builds' own — not something the capture arranges. `base` shows the fixed,
upright obstacles and a single posed ball; `gyre` freezes its obstacles at a
swayed, tilted pose (`TITLE_OBS_TIME` in its `constants.ts`, set by `toTitle()`)
so the backdrop hints at the live rotation; and `multi` draws its three balls
dimmed at their centerline home points. Capturing each variant's title on load
therefore preserves the distinction automatically.

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png` (seeding is keyed by view slug, so the source path here is
purely organizational), so the model always sees a single stable path.

## Regenerating the screenshots

The images are a capture of the reference-impl builds, so regenerate them whenever
a build's look changes:

1. Build each variant's reference-impl (`npm ci && npm run build` in
   `../reference-impl/base`, `../reference-impl/gyre` and `../reference-impl/multi`),
   which emits a static site to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1), then screenshot the `#stage`
   canvas. Each build exposes its live game instance as `window.__carom` for
   exactly this headless capture (see `../specs/instrumentation.md`); it is inert
   during normal play. Note that `reset()` and `step()` take the clock off the
   animation loop (`autoStep = false`) — the loop keeps *rendering* every frame,
   so the posed state is on screen, but nothing advances unless the script asks.
3. Drive each view:
   - **title** — capture on load, once per variant; the menu is the default
     screen and each build poses its own backdrop (above). Nothing needs driving.
   - **gameplay** — from the `base` build: `reset()`, `startMatch("versus")`,
     `setScore(4, 3)` so the HUD reads mid-match, `serve()`, then `step()` in
     small chunks until the ball is launched. Pose the paddles off-centre
     (`setPaddle("left", { cy: 300 })`, `setPaddle("right", { cy: 430 })`), put
     the ball into the open field with spin
     (`setBall(0, { x: 300, y: 250, vx: 560, vy: 180, spin: 2.2 })`), and
     `step(0.55)` so the *real* physics carries it across the field and builds up
     its motion trail before capturing.
   - **game-over** — from the `base` build: `reset()`, `startMatch("versus")`,
     `serve()`, `setScore(10, 9)`, park both paddles clear of the mid-field lane,
     then drive a **real** match point out the right goal
     (`setBall(0, { x: 640, y: 360, vx: 600, vy: 0, spin: 0 })` and step until
     `snapshot().screen !== "playing"`). The win resolves through the real scoring
     code to 11-9 and the match-over card; assert `screen === "matchover"` before
     capturing rather than fabricating the end state.
4. Write the PNGs to the paths above and eyeball each one before committing.

Under the manual clock these captures are **deterministic**: `base` and `gyre`
have no randomness at all, `multi`'s generator is seeded, and once `reset()` or
`step()` has taken the clock the simulation advances by exactly what the script
asks — no stray wall-clock frames. The same script therefore reproduces the same
frames. (The one thing to keep in mind is that `setAutoStep(true)` hands the clock
back to the animation loop and gives up that guarantee, so do not use it for a
still capture.)
