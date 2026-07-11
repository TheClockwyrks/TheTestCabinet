# Spectra — Reference Visuals

These images are the **canonical visual reference** for the Spectra test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl builds** (the authored, *correct* games under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Spectra's reference screenshots are **derived from the real games**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl builds *are* the ground truth, and the
screenshots are captured straight from them. The captured images are committed
here and referenced from the manifest as `media` (served as-is), because there is
no longer a mockup for the harness to render at seed time.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant files) and
is **never seeded into a run** — handing over a correct implementation would let a
model copy it instead of building from the spec.

## Views

The `gameplay` and `game-over` views are **common** — the assault and the
game-over panel look the same in either mode, so they are captured once from the
`base` build and shared. The `title` view is **variant-specific**: the main menu
lists a different mode per variant, so each variant declares its own, captured from
that variant's build (see the `reference` entries in the variant files under
[`../variants/`](../variants/)).

| View slug   | Image                            | Captured from        | Scope           |
| ----------- | -------------------------------- | -------------------- | --------------- |
| `title`     | `screenshots/<variant>/title.png`| that variant's build | per variant     |
| `gameplay`  | `screenshots/gameplay.png`       | the base build       | common (shared) |
| `game-over` | `screenshots/game-over.png`      | the base build       | common (shared) |

```
reference/screenshots/gameplay.png           # common (both variants)
reference/screenshots/game-over.png          # common (both variants)
reference/screenshots/base/title.png         # base — LAUNCH / HOW TO PLAY
reference/screenshots/overload/title.png     # overload — OVERLOAD / HOW TO PLAY
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png` (seeding is keyed by view slug, so the source path here is
purely organizational), so the model always sees a single stable path.

## Regenerating the screenshots

The images are a capture of the reference-impl builds, so regenerate them whenever
a build's look changes:

1. Build each variant's reference-impl (`npm ci && npm run build` in
   `../reference-impl/base` and `../reference-impl/overload`), which emits a static
   site to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). Each build exposes its live game
   instance as `window.__spectra` for exactly this headless capture; it is inert
   during normal play.
3. Drive each view, then screenshot the page (freezing the sim once posed keeps the
   frame stable):
   - **title** — capture on load (the menu is the default screen). The base menu
     reads `LAUNCH / HOW TO PLAY`; the overload menu reads `OVERLOAD / HOW TO PLAY`.
   - **gameplay** (base build) — pose a live wave: the resonator-fighter at the
     bottom, a swaying formation overhead holding both bands (cyan rings + magenta
     diamonds, with a Prism at its center), a couple of diving drones, enemy and
     player fire in flight, and the HUD (score, stage, lives, resonance meter,
     polarity indicator).
   - **game-over** (base build) — set the game to its game-over state so the result
     panel reads the final score and reached stage.
4. Write the PNGs to the paths above (common `gameplay`/`game-over` from the `base`
   build; each `title` from its own variant's build).

Because entrances and dives are seeded per play, the `gameplay` frame differs each
capture; any representative frame that clearly shows the dual-band formation is
fine.
