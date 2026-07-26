# Shatter — Reference Visuals

These images are the **canonical visual reference** for the Shatter test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl builds** (the authored, *correct* games under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Shatter's reference screenshots are **derived from the real games**. There is no
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

The `title`, `gameplay`, and `game-over` views are **common** — the standard game
looks the same for both variants, so they are captured once from the `base` build
and shared. The `warhead` variant adds one **variant-only** view, captured from
the `warhead` build (see the `reference` entry in `../variants/warhead.toml`).

| View slug   | Image                              | Captured from     | Scope           |
| ----------- | ---------------------------------- | ----------------- | --------------- |
| `title`     | `screenshots/title.png`            | the base build    | common (shared) |
| `gameplay`  | `screenshots/gameplay.png`         | the base build    | common (shared) |
| `game-over` | `screenshots/game-over.png`        | the base build    | common (shared) |
| `warhead`   | `screenshots/warhead/warhead.png`  | the warhead build | warhead only    |

```
reference/screenshots/title.png              # common (both variants)
reference/screenshots/gameplay.png           # common (both variants)
reference/screenshots/game-over.png          # common (both variants)
reference/screenshots/warhead/warhead.png    # warhead variant only
```

Whichever variant a run selects, each view is seeded into the run under
`reference/` keyed by view slug (the source path here is purely organizational),
so the model always sees a single stable path. The `warhead` variant seeds the
three common views plus its own `warhead` view.

## Regenerating the screenshots

The images are a capture of the reference-impl builds, so regenerate them whenever
a build's look changes:

1. Build each variant's reference-impl (`npm ci && npm run build` in
   `../reference-impl/base` and `../reference-impl/warhead`), which emits a static
   site to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). Each build exposes its live game
   instance as `window.__shatter` for exactly this headless capture; it is inert
   during normal play.
3. Drive each view, then screenshot the page (freezing the sim once posed keeps the
   frame stable):
   - **title** — capture on load (the menu is the default screen).
   - **gameplay** (base build) — pose a live field around the central star: the
     ship under momentum, several rocks on curved orbits, the hunting saucer, and a
     bullet whose trail bends around the star to show the gravity well.
   - **game-over** (base build) — set the game to its game-over state so the result
     panel reads the final score over a dimmed field.
   - **warhead** (warhead build) — pose an armored rock mid-damage (cracked and
     glowing, health above zero), a homing torpedo in flight toward a target, and
     the torpedo-charge bar visible in the HUD.
4. Write the PNGs to the paths above (the three common views from the `base` build,
   `warhead` from the `warhead` build).

Because rocks and the saucer are seeded per play, the `gameplay` and `warhead`
frames differ each capture; any representative frame that clearly shows the star
and the intended elements is fine.
