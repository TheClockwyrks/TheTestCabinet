# Junction — Reference Visuals

These files are the **canonical visual reference** for the Junction test case. They are
authored as self-contained static HTML on a fixed `1280x720` logical stage so the testing
harness can render and screenshot them deterministically. The rendered screenshots serve
two purposes: they are seeded into a run as visual targets, and they are the baselines for
any validation check (declared in `../test-case.toml`) that names the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and is never
seeded into a run. What the model receives is the *rendered screenshot* of each view,
seeded as a visual target alongside the seeded specs under [`../specs/`](../specs/).
Handing over the source HTML/CSS would let a model copy the intended UI instead of
building it from the spec; a screenshot shows the target without giving away the
implementation.

The mockups depict the city with simple CSS stand-ins for the zones, buildings, roads,
rail, utilities, vehicles, and the pollution overlay. In the real build those are
**produced assets** — sprites, animated sprite sheets, and live particle systems the model
authors with the on-`PATH` tools (see [`../specs/assets.md`](../specs/assets.md)). The
mockups are targets for **layout, palette, and type**, not for how the art is made.

## Views

Each file corresponds to a canonical view slug. The `gameplay` and `game-over` views are
**common** — the same mockup is rendered and seeded for every variant. The `title` view is
**variant-specific**: the main menu lists a different set of starts per variant, so each
variant declares its own menu mockup (see the `[[variant]]` `reference` entries in
`../test-case.toml`).

| View slug   | Mockup source         | Description                              |
| ----------- | --------------------- | ---------------------------------------- |
| `title`     | `menu-<variant>.html` | Title screen and menu, per variant.      |
| `gameplay`  | `gameplay.html`       | In-city frame, mid-play (common).        |
| `game-over` | `game-over.html`      | Bankruptcy panel (common).               |

The `title` view has one mockup per variant: `menu-base.html` (`NEW CITY` / `HOW TO PLAY`),
matching the variant's seeded mode spec.

The `gameplay.html` frame shows the intended look of a live city: a developed downtown of
the three zones at more than one density tier, a road grid with a rail line and stations,
power and water tiles, moving vehicles, a congested corridor on the traffic overlay, the
pollution haze over industry, and the HUD dashboard's top-strip vitals and bottom-strip
RCI meters and build palette. The layout and traffic shown are just one example moment.

`theme.css` holds the shared palette, type, and city furniture referenced by every view
and by the specification (the seeded specs under [`../specs/`](../specs/)), including the
system visual language: the three zone hues and forms, road vs. rail links, the utility
carriers, the congestion coloring, and the pollution haze.

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build output and are
**git-ignored** (the repository ignores `test-cases/**/reference/screenshots/`). The
testing harness renders each file at a `1280x720` viewport (for example with Playwright)
and writes the images under `reference/screenshots/<variant>/`, one folder per variant, so
a view slug shared across variants (here, `title`) does not clobber another variant's
render. Each variant folder holds that variant's full set — the common views plus its own
`title` menu:

```
reference/screenshots/base/title.png         # from menu-base.html
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they can be
opened directly (`file://`) or served as static files for rendering.
