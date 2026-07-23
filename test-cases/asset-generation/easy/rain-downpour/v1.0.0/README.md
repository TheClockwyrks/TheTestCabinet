# Rain Downpour — `v1.0.0`

This is version `v1.0.0` of the **Rain Downpour** test case: an asset-generation
case (`asset_kind = "particle-2d"`) that asks a model to author a looping,
screen-space **heavy-rain weather effect** as a 128×128 planar particle effect using
only the `particle-2d` tool, one recorded operation at a time.

`rain-downpour` is the catalog slug for this case. It is a generic, reusable weather
overlay — not tied to any particular game — a steady downpour a scene can play over
for as long as it is on screen. There is no target clip: the model authors a system
toward the seeded brief and is reviewed subjectively against it.

## What the effect is

The overlay is a **steady heavy downpour** built from two elements, filling the whole
frame continuously and looping with no visible seam over the 1500 ms window:

- **rain streaks** — many thin, fast, near-vertical drops falling from top to bottom
  with a slight wind slant, each stretched along its velocity so it reads as a short
  streak rather than a dot;
- **splash flecks** — small near-white flecks that kick up briefly where drops reach
  the bottom edge, scattered occasionally along the bottom and fading almost
  immediately.

## The paradigm — a system, simulated live

This case does **not** ask the model to place individual particles. It authors a
**system** — emitters, forces, and per-particle F-curves — that the review UI and a
game **simulate live**, the way a real particle editor (Niagara, VFX Graph) plays a
system. The authored `system.json` **is** the asset; every consumer plays it by
running the simulation, so the effect **varies slightly from one play to the next**.
There is no target frame sequence and no bake: the case rewards a well-shaped effect
whose *character* — a steady field of slanted streaks with splashes at the bottom, in
the cool desaturated palette — reads the same across replays and loops seamlessly,
not the reproduction of a supplied clip.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained particle-effect brief.                  |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: particle field, tool, output, domain.            |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `particle-2d` binary, and a seeded
`particle-2d.config.json` alongside the workspace carrying the field dimensions,
the duration, the fps, and the log / preview / `system.json` paths — so neither an
operation nor `render` needs those flags. There is no target clip and no operations
schema: the binary's `--help` is the contract. On `render` the binary simulates the
system, writes the preview GIF, and emits the `system.json` (produced automatically
by core, not manifest-declared) the result is built from.

## Variants

Rain Downpour ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/easy/rain-downpour/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
