# Cascade — Reference Visuals

These files are the **canonical visual reference** for the Cascade test case. They
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

Each file corresponds to a canonical view slug. The `gameplay` and `victory`
views are **common** — the same mockup is rendered and seeded for both variants.
The `title` and `gameplay` views are **variant-specific**: the title menu shows
the active deal mode, and the waste is fanned (Draw Three) or a single card (Draw
One), so each variant declares its own mockups (see the `reference` entries in the
variant files under `../variants/`).

| View slug  | File(s)                                              | Description                                       |
| ---------- | ---------------------------------------------------- | ------------------------------------------------- |
| `title`    | `menu-draw-three.html`, `menu-draw-one.html`         | Title menu, one mockup per variant.               |
| `gameplay` | `gameplay-draw-three.html`, `gameplay-draw-one.html` | Mid-game table, one per variant (fan vs. single). |
| `victory`  | `victory.html`                                       | Win screen, cascade under way.                    |

The two `title` mockups differ only in the deal-mode badge/label:
`menu-draw-three.html` reads `DRAW THREE` and `menu-draw-one.html` reads `DRAW
ONE`, matching each variant's seeded mode spec.

`theme.css` holds the shared palette, type, card design, and table furniture
referenced by every view and by the specification (the seeded specs under
`../specs/`).

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build
output and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness renders each file at
a `1280x720` viewport (for example with Playwright) and writes the images under
`reference/screenshots/<variant>/`, one folder per variant, so a view slug shared
across variants (here, `title`) does not clobber another variant's render. Each
variant folder holds that variant's full set — the common views plus its own
`title` menu:

```
reference/screenshots/draw-three/title.png     # from menu-draw-three.html
reference/screenshots/draw-three/gameplay.png
reference/screenshots/draw-three/victory.png
reference/screenshots/draw-one/title.png       # from menu-draw-one.html
reference/screenshots/draw-one/gameplay.png
reference/screenshots/draw-one/victory.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
