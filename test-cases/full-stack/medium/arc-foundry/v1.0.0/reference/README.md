# Arc Foundry — Reference Visuals

These files are the **canonical visual reference** for the Arc Foundry test case. They
are authored as self-contained static HTML on a fixed `1280x720` logical stage so the
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

The mockups depict the yard with simple CSS/SVG stand-ins for the concrete substrate,
the ordered waypoints, the Load's live route, the salvaged components, the inert blockers,
the charge units, and the electrical VFX. In the real build every one of those is a
**produced asset** — sprites, animated sprite sheets, and live particle systems the
model authors with the on-`PATH` tools (see [`../specs/assets.md`](../specs/assets.md)).
The mockups are targets for **layout, palette, type, and the quality-ladder read**, not
for how the art is made.

## Views

Each file corresponds to a canonical view slug. The `gameplay`, `game-over`, and
`map-select` views are **common** — the same mockup is rendered and seeded for every
variant (there is exactly one variant, `base`). The `title` view is **variant-specific**
(each variant declares its own menu mockup), matching the Valence/Meltdown pattern.

| View slug    | Mockup source         | Description                                                     |
| ------------ | --------------------- | --------------------------------------------------------------- |
| `title`      | `menu-<variant>.html` | Title screen and menu, per variant (`SALVAGE` / `HOW TO PLAY`). |
| `map-select` | `map-select.html`     | The three-map picker with mini waypoint previews (common).      |
| `gameplay`   | `gameplay.html`       | Live-board frame, mid-wave (common).                            |
| `game-over`  | `game-over.html`      | Grid-overload (defeat) panel (common).                          |

The `title` view has one mockup per variant: `menu-base.html` (`SALVAGE` /
`HOW TO PLAY`), matching the variant's seeded mode spec (`../specs/modes.md`). Difficulty
and map are chosen on the in-game menus that follow `SALVAGE`, not on the title menu.

> **These mockups depict the redesigned roster.** They were updated for the
> GemTD-fidelity redesign: **eight** base component types (the original five plus
> **Choke**, **Rectifier**, and the non-firing **Regulator**), the twelve single-grade
> **combination towers** a recipe combine assembles, a **six-waypoint** serpentine on
> every map, and **50**-wave Medium campaigns. The old five-type / three-to-four-waypoint
> / 20–30–40-wave depictions are gone.

The `gameplay.html` frame shows the intended look of a live board on Map A "The
Substation": the ordered **six-waypoint** chain `E -> WP1 .. WP6 -> Collector` (a long
perimeter spiral), the Load's live shortest-open route weaving **around** a maze of kept
components and inert blockers (every rock is also a wall), more than one component
**type** (of the eight) and more than one **quality tier** on the board (the
Scrap→Tesla-Prime ladder reading at a glance), a non-firing **Regulator** projecting its
lime support **aura**, a gold **combination tower** selected in the inspector with its
recipe and abilities, a slowed unit and a burning unit, a scrap-press **stamp** landing
with its build spark, and several electrical VFX mid-fire (arc bolt, chain-lightning,
discharge ring, aura pulse, slow/burn snaps, a death discharge, a leak alarm). The exact
waypoints, the maze, the component mix, and the Load shown are just one representative
moment.

`theme.css` holds the shared palette, type, and board furniture referenced by every
view and by the specification (the seeded specs under [`../specs/`](../specs/)),
including the visual language of the eight component **types** (Capacitor / Coil /
Emitter / Arc-Node / Discharge Rig / Choke / Rectifier / Regulator), the single-grade
gold **combination towers**, the five **quality tiers** (Scrap / Tuned / Charged / Primed
/ Tesla-Prime — finish and glow escalate every rung), the inert blocker rock, the Load
roster (Mote / Spark / Slug / Cluster / Filament flyer / Dynamo boss), the slow/burn/aura
status VFX, and the produced electrical VFX.

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
reference/screenshots/base/map-select.png
reference/screenshots/base/gameplay.png
reference/screenshots/base/game-over.png
```

Whichever variant a run selects, its `title.png` is seeded into the run as
`reference/title.png`, so the model always sees a single stable path.

Because the files are plain static HTML with no scripts or network access, they can be
opened directly (`file://`) or served as static files for rendering.
