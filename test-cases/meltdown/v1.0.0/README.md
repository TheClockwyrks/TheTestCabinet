# Meltdown — `v1.0.0`

This is version `v1.0.0` of the **Meltdown** test case. The implemented game
is an original open-field tower-defense game titled **Meltdown**: you build a
maze out of your own emitter towers to wind the surge the long way around, where
every emitter fires harder the hotter it runs but trips offline at the redline,
so holding the floor is about pacing heat as much as shaping the maze.

`meltdown` is the catalog slug for this lineage of open-field/"maze"
tower-defense cases, and the game's in-fiction title. The case is
inspired by classic open-field tower-defense games but is not a clone of any of
them — the name, look, the heat-as-power emitters with their per-tower redline
plateau and trip, the surface-cooling "thermal blanket" (towers shed heat only
through radiator faces on open air, so packed cores bake), variable tower sizes,
the thermostatic Forge and coolant Sink, the heat-averse cryo Rime, and the surge
are original to The Test Cabinet. It keeps the genre's defining hook — **towers are
walls and you build the maze the creeps must walk** — and layers its own signature,
heat-as-power, on top of it.

## Why this case

Meltdown raises the bar above the catalog's arcade cases with a different shape
of problem: a slower, building game rather than a twitch one. It asks for
grid-based, multi-size, **rotatable** tower placement with **live maze
re-pathing**, eight tower types each with a distinct **thermal personality**, a
**heat-to-damage** plateau whose only failure is the **trip**, a surface-cooling
model with radiator faces and conduction between neighbors, a thermostatic Forge and
coolant Sink, a heat-averse cryo tower, several surge types including **flyers that
ignore the maze**, an economy with upgrades and interest, a **20-wave** progression
with Core bosses and a win and a loss, and multiple states and a HUD — a genuinely
harder front-end task that should separate stronger builds from weaker ones.

## Contents

| Path                   | Seeded to run? | Purpose                                            |
| ---------------------- | -------------- | -------------------------------------------------- |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.          |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.      |
| `reference/` (source)  | No             | Canonical visual mockups; rendered to screenshots. |
| reference screenshots  | **Yes**        | Rendered from `reference/`; seeded as targets.     |
| `workspaces/base/`     | **Yes**        | Starter project pinning Playwright (dev dep).      |
| `test-case.toml`       | No             | Manifest: specs, variants, checks, review items.   |
| `description.md`       | No             | Site-facing prose.                                 |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `heat.md` (the signature), `towers.md`, `creeps.md`,
`controls.md`, `flow.md`, `standard.md` (the playable mode), and `proof.md`.
This version offers a single `base` variant — the standard **Containment**
defense on the one fixed reactor floor.

Future versions or variants are expected to add the alternate floors sketched
during design — a large central **reactor block** that is unbuildable but
radiates heat, and a floor seeded with several small **reactor cores** as
pre-placed blockers-cum-heat-sources — and rule twists, as additive variants on
top of this base.

This version has **no assets**: Meltdown draws everything in code, and the maze
is the player's to build at runtime, guided by the palette and measurements in
the specs and by the seeded reference screenshots.

The seeded specs, the starter workspace, and the rendered reference screenshots
are copied into a run's repository. The reference *source* mockups are not
seeded, so a model builds the UI from the specs and the screenshots rather than
copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/meltdown/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
