# Carom — Reference Visuals

These files are the **canonical visual reference** for the Carom test case. They
are authored as self-contained static HTML on a fixed `1280x720` logical stage
so the testing harness can render and screenshot them deterministically. The
rendered screenshots serve two purposes: they are seeded into a run as visual
targets, and they are the baselines for any [validation check](../validation.md#checks)
that names the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and
is never seeded into a run. What the model receives is the *rendered screenshot*
of each view (see [Generating screenshots](#generating-screenshots)), seeded as
a visual target alongside the seeded specs under [`../specs/`](../specs/).
Handing over the source HTML/CSS would let a model copy the intended UI instead
of building it from the spec; a screenshot shows the target without giving away
the implementation.

## Views

Each file corresponds to a canonical view slug. The `gameplay` and `game-over`
views are **common** — the same mockup is rendered and seeded for every variant.
The `title` view is **variant-specific**: the main menu lists a different set of
modes per variant, so each variant declares its own menu mockup (see the
`[[variant]]` `reference` entries in `../test-case.toml`).

| View slug   | File(s)                                          | Description                                              |
| ----------- | ------------------------------------------------ | ------------------------------------------------------- |
| `title`     | `menu-base.html`, `menu-frenzy.html`, `menu-multi.html` | Title screen and main menu, one mockup per variant. |
| `gameplay`  | `gameplay.html`                                  | Representative in-match frame (common).                 |
| `game-over` | `game-over.html`                                 | Match-over result panel (common).                       |

The three `title` mockups differ only in their menu list: `menu-base.html` shows
`SOLO` / `VERSUS` / `HOW TO PLAY`; `menu-frenzy.html` inserts `FRENZY`; and
`menu-multi.html` inserts `MULTI` — matching each variant's seeded mode spec.

`theme.css` holds the shared palette, type, and field furniture referenced by
every view and by the specification (the seeded specs under `../specs/`).

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
reference/screenshots/base/title.png       # from menu-base.html
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
reference/screenshots/frenzy/title.png     # from menu-frenzy.html
reference/screenshots/multi/title.png      # from menu-multi.html
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
