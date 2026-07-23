# Ambient Snowfall — `v1.0.0`

This is version `v1.0.0` of the **Ambient Snowfall** test case: an asset-generation
case (`asset_kind = "particle-2d"`) that asks a model to author a gentle, looping
winter **weather layer** — a calm, continuous field of soft snowflakes — as a
128×128 planar particle effect using only the `particle-2d` tool, one recorded
operation at a time.

`snowfall` is the catalog slug for this case. It is a generic, reusable ambient
effect — not tied to any particular game — that any wintry scene could sit behind or
in front of. There is no target clip: the model authors a system toward the seeded
brief and is reviewed subjectively against it.

## What the effect is

Ambient snowfall is a **calm, continuous weather layer** built from many soft flakes
that fill the frame evenly and loop seamlessly over the 3 s window:

- **soft flakes of varied sizes** — rounded, soft-edged specks of light from tiny
  distant flakes to a few larger, nearer ones;
- **slow drift and sway** — a lazy downward descent with a gentle side-to-side sway,
  as if on a light breeze rather than falling straight;
- **parallax** — smaller flakes fall slower than larger ones, giving the layer depth
  rather than moving as one flat sheet;
- **a gentle sparkle** — a few flakes slowly twinkle or rotate as they fall, in a
  cool white and pale-blue palette.

## The paradigm — a system, simulated live

This case does **not** ask the model to place individual flakes. It authors a
**system** — emitters, forces, and per-particle F-curves — that the review UI and a
game **simulate live**, the way a real particle editor (Niagara, VFX Graph) plays a
system. The authored `system.json` **is** the asset; every consumer plays it by
running the simulation, so the effect **varies slightly from one play to the next**.
There is no target frame sequence and no bake: the case rewards a well-shaped effect
whose *character* — soft varied flakes drifting and swaying downward with parallax,
looping seamlessly — reads the same across replays, not the reproduction of a
supplied clip.

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

Ambient Snowfall ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's two
scoring domains (**Effect read** and **Motion & timing**); it adds no specs, review
items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/easy/snowfall/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
