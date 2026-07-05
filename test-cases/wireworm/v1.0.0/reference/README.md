# Wireworm — Reference Visuals

These files are the **canonical visual reference** for the Wireworm test case.
They are authored as self-contained static HTML on a fixed `1280x720` logical
stage so the testing harness can render and screenshot them deterministically. The
rendered screenshots serve two purposes: they are seeded into a run as visual
targets, and they are the baselines for any validation check (declared in
`../test-case.toml`) that names the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and is
never seeded into a run. What the model receives is the *rendered screenshot* of
each view, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). Handing over the source HTML/CSS would let a model copy
the intended UI instead of building it from the spec; a screenshot shows the
target without giving away the implementation.

## Views

Each file corresponds to a canonical view slug. The `gameplay` and `game-over`
views are **common** — the same mockup is rendered and seeded for every variant.
The `title` view is **variant-specific**: the main menu lists a different set of
modes per variant, so each variant declares its own menu mockup (see the variant
files' `reference` entries and the common `[[reference]]` entries in
`../test-case.toml`).

| View slug   | Mockup source         | Description                              |
| ----------- | --------------------- | ---------------------------------------- |
| `title`     | `menu-<variant>.html` | Title screen and menu, per variant.      |
| `gameplay`  | `gameplay.html`       | In-game frame, mid-level (common).       |
| `game-over` | `game-over.html`      | Game-over / end card (common).           |

The `title` view has one mockup per variant: this version declares the single
`base` variant, whose menu (`menu-base.html`) lists `DESCEND` then `HOW TO PLAY`.

The `gameplay.html` frame shows the intended look of a live game: a board with a
node field at a range of charges (inert, low, mid, and pulsing criticals), a
critical cluster mid-discharge with arcs, the data-worm winding and split into two
worms, a corruptor laying a critical line and a glitch skittering, and the cursor
in its band firing up, plus the HUD bar (score, lives, `LEVEL n / 12`). The field,
charges, worm, and foes shown are just one example moment.

`theme.css` holds the shared palette, type, and board/node/worm/cursor/foe/HUD
furniture referenced by every view and by the specification (the seeded specs
under [`../specs/`](../specs/)), including the charge visual language: a node's
glow tracks its charge from inert dark to white-hot critical, a critical node
pulses with amber sparks, and the discharge arcs are bright cyan-white.

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build output
and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness renders each file at
a `1280x720` viewport (for example with Playwright) and writes the images under
`reference/screenshots/<variant>/`, one folder per variant, so a view slug shared
across variants (here, `title`) does not clobber another variant's render. Each
variant folder holds that variant's full set — the common views plus its own
`title` menu:

```
reference/screenshots/base/title.png        # from menu-base.html
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
