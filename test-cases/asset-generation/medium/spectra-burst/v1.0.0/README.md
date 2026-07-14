# Spectra Burst — `v1.0.0`

This is version `v1.0.0` of the **Spectra Burst** test case: an asset-generation
case (`asset_kind = "particle-2d"`) that asks a model to author a screen-space
enemy-drone **explosion VFX** for *Spectra*, a two-band formation shooter, as a
128×128 planar particle effect using only the `particle-2d` tool, one recorded
operation at a time.

`spectra-burst` is the catalog slug for this case. It is a sibling in the
`spectra-*` universe and shares the game's neon **two-band palette** — cyan
(`#34e2ff`) and magenta (`#ff4ec7`) on dark — with the Spectra ships and drones.
There is no target clip: the model authors a system toward the seeded brief and is
reviewed subjectively against it.

## What the effect is

The burst is a **sharp neon detonation** built from three overlaid elements, all
firing from the center of the field at t = 0 and decaying to an empty field by the
end of the 700 ms one-shot:

- a **flash core** — an overexposed white-to-cyan bloom, the hottest and shortest-
  lived element (the punch of light);
- a **ring shockwave** — a thin cyan ring that expands outward, thinning and fading
  as it grows;
- **radial spark streaks** — cyan and magenta sparks thrown outward in every
  direction, stretched along their velocity, decelerating under drag and fading as
  they die.

## The paradigm — a system, simulated live

This case does **not** ask the model to place individual particles. It authors a
**system** — emitters, forces, and per-particle F-curves — that the review UI and a
game **simulate live**, the way a real particle editor (Niagara, VFX Graph) plays a
system. The authored `system.json` **is** the asset; every consumer plays it by
running the simulation, so the effect **varies slightly from one play to the next**.
There is no target frame sequence and no bake: the case rewards a well-shaped effect
whose *character* — flash, ring, radial burst, in the two-band palette — reads the
same across replays, not the reproduction of a supplied clip.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained particle-effect brief.                  |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: particle field, tool, output, domains, reviews.  |
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

Spectra Burst ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's two
scoring domains (**Effect read** and **Motion & timing**); it adds no specs, review
items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/spectra-burst/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
