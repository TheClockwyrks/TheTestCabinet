# Fathom — Reference Visuals

These files are the **canonical visual reference** for the Fathom test case. They
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

## Views

Each file corresponds to a canonical view slug. All three views are **common** —
the same mockup is rendered and seeded for every variant. Both variants (Base and
Kindle) show the same single-dive menu, so even `title` is shared.

| View slug   | Mockup source   | Description                          |
| ----------- | --------------- | ------------------------------------ |
| `title`     | `menu.html`     | Title screen and menu (common).      |
| `gameplay`  | `gameplay.html` | In-trench frame, mid-dark (common).  |
| `game-over` | `game-over.html`| Game-over panel (common).            |

The `menu.html` title screen lists the single dive (`DIVE`), then `HOW TO PLAY`.

The `gameplay.html` frame shows the intended look of the dark trench: a lit pocket
of revealed corridors fading into black fog around the forager, plankton in the
corridors, the Lure glimpsed at the edge of the light, and a sonar pulse reaching
past the light to mark the Listener around a bend. (It depicts the Base sensing
model; the Kindle variant's in-trench look — a wide radial glow of sensed rock
with plankton and predators hidden until lit or pinged — should get its own
`gameplay` mockup when the Kindle art is revised.)

`theme.css` holds the shared palette, type, and trench furniture referenced by
every view and by the specification (the seeded specs under [`../specs/`](../specs/)).

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build output
and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness renders each file at
a `1280x720` viewport (for example with Playwright) and writes the images under
`reference/screenshots/<variant>/`, one folder per variant. Because all three
views are common here, each variant folder holds the same set:

```
reference/screenshots/base/title.png        # from menu.html
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
reference/screenshots/kindle/title.png      # from menu.html
reference/screenshots/kindle/gameplay.png
reference/screenshots/kindle/game-over.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

The mockups **embed the real seeded assets** from [`../assets/`](../assets/) (see
[`../specs/assets.md`](../specs/assets.md)) via relative `../assets/<sheet>/<frame>.png`
paths, so each rendered screenshot shows the actual art the build uses: the trench
tileset draws the maze (floor + wall autotile), and the forager, predators, sonar
pulse, and flare bloom are their sprite/effect sheets. The grayscale sonar-pulse
asset is tinted with a CSS hue filter (not a `mask`) so it recolors correctly when
the page is loaded over `file://`, where a cross-origin `mask`/`background` image
fetch is blocked.

Because the files are still plain static HTML with no scripts or network
access — only local image assets — they can be opened directly (`file://`) or
served as static files for rendering.
