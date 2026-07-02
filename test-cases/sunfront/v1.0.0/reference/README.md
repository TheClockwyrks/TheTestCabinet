# Sunfront — Reference Visuals

These files are the **canonical visual reference** for the Sunfront test case.
They are authored as self-contained static HTML on a fixed `1280x720` logical
stage so the testing harness can render and screenshot them deterministically.
The rendered screenshots serve two purposes: they are seeded into a run as visual
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

| View slug   | Mockup source         | Description                                     |
| ----------- | --------------------- | ----------------------------------------------- |
| `title`     | `menu-<variant>.html` | Title screen and menu, per variant.             |
| `gameplay`  | `gameplay.html`       | In-match frame at the front line (common).      |
| `game-over` | `game-over.html`      | Match-over end card (common).                   |

The `gameplay` and `game-over` views are **common** — the same mockup is rendered
and seeded for every variant. The `title` view is **variant-specific**: the main
menu lists a different set of modes per variant, so each variant declares its own
menu mockup (see the `[[variant]]` `reference` entries in `../test-case.toml`).
This version declares the single `base` variant, whose menu (`menu-base.html`)
lists `SKIRMISH` then `HOW TO PLAY`.

The `gameplay.html` frame shows the intended look of a live match: the front-line
battle mid-lane with both legions' units (Ember advancing right, Azure left, a
Sunhawk crossing overhead), the player's damaged Reliquary, the HUD (sol and
income, the wave countdown, both base health bars), the player's staging yard
with placed, levelled spawners, the build palette and a selected-spawner panel,
and — critically — the **fog** blacking out both the enemy staging yard and the
far right of the lane, so the enemy base and Reliquary are not drawn. The units,
placements, and values shown are just one example moment.

`theme.css` holds the shared palette, type, and field/HUD furniture referenced by
every view and by the specification (the seeded specs under
[`../specs/`](../specs/)): the sand lane and its banding, the two team colors
(Ember and Azure) with dark unit outlines, the neutral Reliquary color, the fog
color, and the HUD/menu styling.

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build
output and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness renders each file at
a `1280x720` viewport and writes the images under
`reference/screenshots/<variant>/`, one folder per variant, so a view slug shared
across variants (here, `title`) does not clobber another variant's render:

```
reference/screenshots/base/title.png        # from menu-base.html
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
