# Coil — Reference Visuals

These files are the **canonical visual reference** for the Coil test case. They
are authored as self-contained static HTML on a fixed `1280x720` logical stage
so the testing harness can render and screenshot them deterministically. The
rendered screenshots serve two purposes: they are seeded into a run as visual
targets, and they are the baselines for any validation check (declared in
`../test-case.toml`) that names the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and is
never seeded into a run. What the model receives is the *rendered screenshot* of
each view (see [Generating screenshots](#generating-screenshots)), seeded as a
visual target alongside the seeded specs under [`../specs/`](../specs/). Handing
over the source HTML/CSS would let a model copy the intended UI instead of
building it from the spec; a screenshot shows the target without giving away the
implementation.

## Views

Each file corresponds to a canonical view slug. The `gameplay` and `game-over`
views are **common** — the same mockup is rendered and seeded for every variant.
The `title` view is **variant-specific**: the main menu lists a different set of
modes per variant, so each variant declares its own menu mockup (see the
`[[variant]]` `reference` entries in `../test-case.toml`).

| View slug   | File(s)                                                                 | Description                                         |
| ----------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `title`     | `menu-base.html`, `menu-wrap.html`, `menu-maze.html`, `menu-feast.html` | Title screen and main menu, one mockup per variant. |
| `gameplay`  | `gameplay.html`                                                         | Representative in-game frame (common).              |
| `game-over` | `game-over.html`                                                        | Game-over result panel (common).                    |

The `title` mockups differ only in their menu list: `menu-base.html` shows
`CLASSIC` / `HOW TO PLAY`; `menu-wrap.html` inserts `WRAP`; `menu-maze.html`
inserts `MAZE`; and `menu-feast.html` inserts `FEAST` — matching each variant's
seeded mode spec. (The `wrap` mockup additionally draws the board's perimeter as
an open tunnel boundary; the `maze` mockup adds the dimmed interior obstacle
bars; and the `feast` mockup adds a dimmed bonus orb — each hinting at its
mode.)

`theme.css` holds the shared palette, type, and board furniture referenced by
every view and by the specification (the seeded specs under `../specs/`). The
board geometry it encodes — a `30x18` grid of `32px` cells with a one-cell wall
border, the board's top-left at logical `(160, 120)`, and the HUD band above
it — matches [`../specs/playfield.md`](../specs/playfield.md).

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build
output and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness renders each file at
a `1280x720` viewport (for example with Playwright) and writes the images under
`reference/screenshots/<variant>/`, one folder per variant, so a view slug shared
across variants (here, `title`) does not clobber another variant's render. Each
variant folder holds that variant's full set — the common views plus its own
`title` menu:

```text
reference/screenshots/base/title.png       # from menu-base.html
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
reference/screenshots/wrap/title.png       # from menu-wrap.html
reference/screenshots/maze/title.png       # from menu-maze.html
reference/screenshots/feast/title.png      # from menu-feast.html
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
