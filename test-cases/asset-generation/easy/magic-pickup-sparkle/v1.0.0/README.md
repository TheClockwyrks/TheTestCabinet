# Magic Pickup Sparkle — `v1.0.0`

This is version `v1.0.0` of the **Magic Pickup Sparkle** test case: an
asset-generation case (`asset_kind = "particle-2d"`) that asks a model to author a
gentle, looping **collectible-pickup marker** — the shimmer that hovers over a magic
item to draw the eye — as a 64×64 planar particle effect using only the
`particle-2d` tool, one recorded operation at a time.

`magic-pickup-sparkle` is the catalog slug for this case. It is a generic, reusable
VFX asset — not tied to any specific game — meant to drop over any collectible in a
2D scene. There is no target clip: the model authors a system toward the seeded
brief and is reviewed subjectively against it.

## What the effect is

The sparkle is an **enchanting, gentle marker** built from three overlaid elements,
all centered on the same point and repeating over a seamless one-second loop:

- a **central glow** — a soft cyan bloom that pulses gently, always present, always
  breathing;
- **four-point star sparkles** — small white twinkles that pop in and fade at
  varying positions around the glow, tipped with a warm gold accent;
- **rising motes** — a few tiny violet specks that drift slowly upward and fade,
  like flecks of enchantment lifting off.

## The paradigm — a system, simulated live

This case does **not** ask the model to place individual particles. It authors a
**system** — emitters, forces, and per-particle F-curves — that the review UI and a
game **simulate live**, the way a real particle editor (Niagara, VFX Graph) plays a
system. The authored `system.json` **is** the asset; every consumer plays it by
running the simulation, so the effect **varies slightly from one play to the next**.
There is no target frame sequence and no bake: the case rewards a well-shaped effect
whose *character* — pulsing glow, twinkling stars, rising motes, in the cool magical
palette — reads the same across replays and loops seamlessly, not the reproduction
of a supplied clip.

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

Magic Pickup Sparkle ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's two
scoring domains (**Effect read** and **Motion & loop**); it adds no specs, review
items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/easy/magic-pickup-sparkle/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
