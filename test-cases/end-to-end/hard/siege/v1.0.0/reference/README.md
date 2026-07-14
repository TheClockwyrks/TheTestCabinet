# Siege — Reference Visuals

These files are the **canonical visual reference** for the Siege test case. They
are authored as self-contained static HTML on a fixed `1280x720` logical stage so
the testing harness can render and screenshot them deterministically. The rendered
screenshots serve two purposes: they are seeded into a run as visual targets, and
they are the baselines for any validation check (declared in `../test-case.toml`)
that names the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and is
never seeded into a run. What the model receives is the *rendered screenshot* of
each view, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). Handing over the source HTML/CSS would let a model copy
the intended UI instead of building it from the spec; a screenshot shows the
target without giving away the implementation.

These mockups do **not** fake the 3D first-person view — flat CSS cannot depict it
usefully. The real build renders the world in **WebGL/WebGPU**
(`../specs/overview.md`); the mockups exist to pin the **palette, HUD layout, and
type**. The `gameplay` mockup is therefore **HUD-only**: the HUD over a neutral
dark viewport, with the 3D world left to the build.

## Views

| View slug   | Mockup source           | Description                                                 |
| ----------- | ----------------------- | ----------------------------------------------------------- |
| `title`     | `select-<variant>.html` | Title screen — the `SIEGE` title with PLAY and HOW TO PLAY. |
| `gameplay`  | `gameplay.html`         | In-siege **HUD** over a neutral viewport (common).          |
| `game-over` | `game-over.html`        | Defeat screen (common).                                     |

The `gameplay` and `game-over` views are **common** — the same mockup is rendered
and seeded for every variant. The `title` view is **variant-specific**: each
variant declares its own title mockup (future variants may present their mode
differently), see the variant `reference` entries in `../test-case.toml`. This
version declares the single `base` variant, whose title screen (`select-base.html`)
starts the `LAST STAND` siege.

The `title` view is the **checked** view: it is what the game shows on load and is
static, so the harness compares an implementation's load screen against it.
`gameplay` and `game-over` depend on live play and are seeded as targets but not
auto-checked.

`theme.css` holds the shared palette, type, and furniture referenced by every view
and by the specification (the seeded specs under [`../specs/`](../specs/)): the sky
and terrain colors, the concrete redoubt, the two faction colors (Cobalt Wardens
and Ember Scourge) with the Scourge tier accents, the artillery telegraph, and the
HUD styling.

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build output
and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness renders each file at a
`1280x720` viewport and writes the images under `reference/screenshots/<variant>/`,
one folder per variant:

```
reference/screenshots/base/title.png        # from select-base.html
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they can
be opened directly (`file://`) or served as static files for rendering.
