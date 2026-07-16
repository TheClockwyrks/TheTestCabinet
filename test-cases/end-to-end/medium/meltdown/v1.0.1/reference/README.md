# Meltdown — Reference Visuals

These images are the **canonical visual reference** for the Meltdown test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl build** (the authored, *correct* game under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Meltdown's reference screenshots are **derived from the real game**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl build *is* the ground truth, and the
screenshots are captured straight from it. The captured images are committed here
and referenced from the manifest as `media` (served as-is), because there is no
longer a mockup for the harness to render at seed time.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant files) and
is **never seeded into a run** — handing over a correct implementation would let a
model copy it instead of building from the spec.

## Views

The `mode-select`, `gameplay`, and `game-over` views are **common** — they look
the same in every variant, so they are captured once from the `base` build and
shared. The `title` view is **variant-specific**: the main menu may differ per
variant, so each variant declares its own, captured from that variant's build
(see the `reference` entries in the variant files under
[`../variants/`](../variants/)). This version declares the single `base` variant.

| View slug     | Image                             | Captured from        | Scope           |
| ------------- | --------------------------------- | -------------------- | --------------- |
| `title`       | `screenshots/<variant>/title.png` | that variant's build | per variant     |
| `mode-select` | `screenshots/mode-select.png`     | the base build       | common (shared) |
| `gameplay`    | `screenshots/gameplay.png`        | the base build       | common (shared) |
| `game-over`   | `screenshots/game-over.png`       | the base build       | common (shared) |

```
reference/screenshots/mode-select.png        # common (every variant)
reference/screenshots/gameplay.png           # common (every variant)
reference/screenshots/game-over.png          # common (every variant)
reference/screenshots/base/title.png         # base — PLAY / HOW TO PLAY
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png` (seeding is keyed by view slug, so the source path here is
purely organizational), so the model always sees a single stable path.

## Regenerating the screenshots

The images are a capture of the reference-impl build, so regenerate them whenever
the build's look changes:

1. Build the reference-impl (`npm ci && npm run build` in
   [`../reference-impl/base`](../reference-impl/base)), which emits a static site
   to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). The build exposes its live game
   instance as `window.__meltdown` for exactly this headless capture; it is inert
   during normal play.
3. Drive each view, then screenshot the page:
   - **title** (`base`) — capture on load (the menu is the default screen). The
     base menu reads `PLAY / HOW TO PLAY`.
   - **mode-select** — set `state = "modeselect"` (focus the first mode) to show
     the mode list beside the focused mode's description.
   - **gameplay** — `beginMatch()`, build the winning "maze + heat" serpentine
     (`sim/mazes.ts` `serpManagedLayout`, from a funded placement so the whole
     layout lands), set a mid-game `waveNumber` (e.g. 10, which mixes motes,
     sprints, swarms, hulks, and drift flyers), then `launchWave(false)` and let
     the sim run a few seconds at `speed = 2` so the surge threads the maze, the
     flyers cross it, and the interior heats to a visible cold→white-hot gradient.
     Restore a realistic `money` and select the hottest emitter (`selected`) so
     the inspector shows a live heat read, then screenshot.
   - **game-over** — set a plausible `score` / `reachedWave`, then
     `state = "gameover"` to show the `REACTOR BREACHED` end card.
4. Write the PNGs to the paths above (the common `mode-select`/`gameplay`/
   `game-over` from the `base` build; each `title` from its own variant's build).

Because the surge spawns and heat builds over the wave, the `gameplay` frame
differs each capture; any representative frame that clearly shows the player-built
maze, the heat gradient, and flyers crossing it is fine.
