# Deepcore — Reference Visuals

These files are the **canonical visual reference** for the Deepcore test case. They are
authored as self-contained static HTML on a fixed `1280x720` logical stage so the
testing harness can render and screenshot them deterministically. The rendered
screenshots serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that names
the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and is never
seeded into a run. What the model receives is the *rendered screenshot* of each view,
seeded as a visual target alongside the seeded specs under [`../specs/`](../specs/).
Handing over the source HTML/CSS would let a model copy the intended UI instead of
building it from the spec; a screenshot shows the target without giving away the
implementation.

The mockups depict the mine and the surface with simple CSS/SVG stand-ins for the
banded rock, the carved tunnels, the ore veins and material nodes, the gas and lava
hazards, the surface buildings and the assembling escape rocket, and — above all — the
**miner**, a suited character with a drill and a jetpack. In the real build every one
of those is a **produced asset**: the band tiles, ore, materials, hazards, buildings,
and rocket are `draw` sprites; the **animated miner** (idle / walk / drill-down /
drill-side / jetpack / fall / hurt / out-of-fuel) is a set of `draw-sheet` cycles; the
effects (drill debris, jetpack exhaust, ore sparkle, gas explosion, lava embers, core
extraction and detonation, launch exhaust, death) are live `particle-2d` systems; and
the audio is `sfx-synth`/`sfx-sample`/`music` (see [`../specs/assets.md`](../specs/assets.md)).
The mockups are targets for **layout, palette, type, and readability**, not for how the
art is made — and never a stiff, single-frame miner, which the spec calls a failed
build.

## Views

Each file corresponds to a canonical view slug. The `mine`, `surface`, and `game-over`
views are **common** — the same mockup is rendered and seeded for every variant (there
is exactly one variant, `base`). The `title` view is **variant-specific** (each variant
declares its own menu mockup), matching the Valence/Meltdown pattern.

| View slug   | Mockup source         | Description                                                                              |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `title`     | `menu-<variant>.html` | Title screen and menu, per variant (`NEW EXPEDITION` / `HOW TO PLAY`).                   |
| `mine`      | `mine.html`           | Live mid-dig frame across a rockbed → deepstone band transition (common).                |
| `surface`   | `surface.html`        | Surface camp with the four buildings, the assembling rocket, and a panel (common).       |
| `game-over` | `game-over.html`      | End screen — Victory (after launch) or Hardcore Game Over — with a run summary (common). |

The `title` view has one mockup per variant: `menu-base.html` (`NEW EXPEDITION` /
`HOW TO PLAY`), matching the variant's seeded expedition spec
([`../specs/mode.md`](../specs/)). Standard vs Hardcore is chosen on the in-game **MODE
SELECT** menu that follows `NEW EXPEDITION` (it changes only what happens on death,
`../specs/modes.md`), so it is not a variant and not a title-menu choice.

The `mine.html` frame shows the intended look of a live dig: the four **depth bands**
reading at a glance by their rock fill (here a **rockbed → deepstone** transition with a
visible seam), the faint 48px tile grid over the produced rock, the unminable bedrock
border, the **carved shaft and side tunnels** the miner dug, several **ore veins** of
different types (value climbing with depth), a **Resonite material node**, a **gas
pocket** and a **lava pool**, the **miner** braced mid-drill at the bottom of the shaft
with a **drill-debris** particle stand-in, and the **scanner indicator** (an arrow +
distance toward the nearest needed material). The exact mine, ore scatter, depth, and
miner pose are just one representative moment — the mine is generated per game within
the fixed rules of [`../specs/world.md`](../specs/world.md).

The `surface.html` frame shows the dusk-sky camp: the four buildings (**Fuel Depot**,
**Ore Market**, **Upgrade Shop**, **Launch Pad**), the **escape rocket partway
assembled** on the pad (2 of 5 components installed, the deep three still ghosted), the
**cave mouth** down into the mine, the miner standing at a building, and one building's
**overlay panel** open — here the **Upgrade Shop** with its five tracks (Fuel Tank,
Drill, Cargo Bay, Hull, Scanner), each showing the current tier, the next-tier effect,
and its Credits price.

`game-over.html` is the shared end screen (Victory after launch, or the Hardcore Game
Over from a death) over a dimmed camp, showing the run **summary** (deepest depth
reached, Credits earned, elapsed time, mode, rocket components installed) with **PLAY
AGAIN** and **MENU**.

`theme.css` holds the shared palette, type, and world/HUD furniture referenced by every
view and by the specification (the seeded specs under [`../specs/`](../specs/)),
including the depth-band rock fills, the carved-tunnel and bedrock stand-ins, the six
ore veins and the two material crystals, the gas/lava hazards, the **miner character**
(with its pose modifiers for idle / drill-down / drill-side / jetpack / fall /
out-of-fuel), the surface buildings and the segment-by-segment escape rocket, the
produced-VFX stand-ins, the status bar gauges and satchel, the scanner and core-timer
indicators, the surface building panels, and the end-screen modal.

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build output and
are **git-ignored** (the repository ignores `test-cases/**/reference/screenshots/`). The
testing harness renders each file at a `1280x720` viewport (for example with Playwright)
and writes the images under `reference/screenshots/<variant>/`, one folder per variant,
so a view slug shared across variants does not clobber another variant's render. Each
variant folder holds that variant's full set — the common views plus its own `title`
menu:

```
reference/screenshots/base/title.png       # from menu-base.html
reference/screenshots/base/mine.png
reference/screenshots/base/surface.png
reference/screenshots/base/game-over.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they can be
opened directly (`file://`) or served as static files for rendering.
