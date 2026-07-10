# Cascade — Reference Visuals

These images are the **canonical visual reference** for the Cascade test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl builds** (the authored, *correct* games under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Cascade's reference screenshots are **derived from the real games**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl builds *are* the ground truth, and the
screenshots are captured straight from them. The captured images are committed
here and referenced from the manifest as `media` (served as-is), because there is
no longer a mockup for the harness to render at seed time.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant files) and is
**never seeded into a run** — handing over a correct implementation would let a
model copy it instead of building from the spec.

## Views

Each image corresponds to a canonical view slug. The `victory` view is **common**
— the cascade looks the same in either deal — so it is captured once and shared.
The `title` and `gameplay` views are **variant-specific**: the title menu shows the
active deal mode, and the waste is a single card (Draw One) or a fanned three (Draw
Three), so each variant declares its own (see the `reference` entries in the
variant files under [`../variants/`](../variants/)).

| View slug  | Image                                | Captured from        | Scope           |
| ---------- | ------------------------------------ | -------------------- | --------------- |
| `title`    | `screenshots/<variant>/title.png`    | that variant's build | per variant     |
| `gameplay` | `screenshots/<variant>/gameplay.png` | that variant's build | per variant     |
| `victory`  | `screenshots/victory.png`            | the Draw Three build | common (shared) |

```
reference/screenshots/victory.png              # common (both deals)
reference/screenshots/draw-one/title.png
reference/screenshots/draw-one/gameplay.png
reference/screenshots/draw-three/title.png
reference/screenshots/draw-three/gameplay.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png` (seeding is keyed by view slug, so the source path here is
purely organizational), so the model always sees a single stable path.

## Regenerating the screenshots

The images are a capture of the reference-impl builds, so regenerate them whenever
a build's look changes:

1. Build each variant's reference-impl (`npm ci && npm run build` in
   `../reference-impl/draw-one` and `../reference-impl/draw-three`), which emits a
   static site to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). Each build exposes its live game
   instance as `window.__cascade` for exactly this headless capture; it is inert
   during normal play.
3. Drive each view, then screenshot the `#stage` canvas:
   - **title** — capture on load (the menu is the default screen).
   - **gameplay** — `g.newGame()`, then turn the stock a few times (so the waste
     shows the deal's single vs. fanned top card) and send any available aces home
     via `g.autoMoveToFoundation(...)` for a mid-game look.
   - **victory** — set `g.foundations` to four complete Ace→King suits and call
     `g.startCascade()`, then let the frame loop advance the cascade for ~1.5 s so
     the bouncing-card trails fill the table before capturing.
4. Write the PNGs to the paths above (common `victory` from the Draw Three build).

Because the deal uses a CSPRNG shuffle, the `gameplay` frame differs each capture;
any representative mid-game frame that clearly shows the deal's waste is fine.
