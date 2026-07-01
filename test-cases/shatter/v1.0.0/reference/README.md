# Shatter — Reference Visuals

These files are the **canonical visual reference** for the Shatter test case. They
are authored as self-contained static HTML on a fixed `1280x720` logical stage so
the testing harness can render and screenshot them deterministically. The rendered
screenshots serve two purposes: they are seeded into a run as visual targets, and
they are the baselines for any validation check (declared in `../test-case.toml`)
that names the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and is
never seeded into a run. What the model receives is the *rendered screenshot* of
each view (see [Generating screenshots](#generating-screenshots)), seeded as a
visual target alongside the seeded specs under [`../specs/`](../specs/). Handing
over the source HTML/CSS would let a model copy the intended UI instead of building
it from the spec; a screenshot shows the target without giving away the
implementation.

## Views

Shatter ships a single mode (one variant), so all three views are **common** — the
same mockups are rendered and seeded for every run.

| View slug   | File             | Description                                              |
| ----------- | ---------------- | -------------------------------------------------------- |
| `title`     | `title.html`     | Title screen and main menu (`PLAY` / `HOW TO PLAY`).     |
| `gameplay`  | `gameplay.html`  | Representative in-game frame with the gravity-bent shot. |
| `game-over` | `game-over.html` | Game-over result panel.                                  |

`theme.css` holds the shared palette, type, and field furniture (the star, the
ship glyph, rock outlines, HUD, and menus) referenced by every view and by the
specification (the seeded specs under `../specs/`).

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build output
and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness renders each file
at a `1280x720` viewport (for example with Playwright) and writes the images
under `reference/screenshots/<variant>/`, one folder per variant, so the seeded
path is stable:

```
reference/screenshots/base/title.png
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
```

Whichever variant a run selects (here only `base`), its screenshots are seeded
into the run under `reference/`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
