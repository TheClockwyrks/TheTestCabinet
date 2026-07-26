# Confetti Pop — `v1.0.0`

This is version `v1.0.0` of the **Confetti Pop** test case: an asset-generation
case (`asset_kind = "particle-2d"`) that asks a model to author a celebratory
**confetti burst** as a 128×128 planar particle effect using only the `particle-2d`
tool, one recorded operation at a time.

`confetti-pop` is the catalog slug for this case. It is a generic, reusable
celebration effect — a party popper going off — not tied to any particular game or
scene. There is no target clip: the model authors a system toward the seeded brief
and is reviewed subjectively against it.

## What the effect is

The burst is a **joyful confetti pop** — a pop at the center of the field that
throws many small, colorful pieces up and outward, which then flutter down to a
nearly empty field by the end of the 1500 ms one-shot:

- **the pop** — at t = 0 the confetti launches up and outward in a wide fan, fast
  and tightly clustered, the loud bright moment;
- **the confetti pieces** — small colorful rectangles or ribbons that tumble and
  spin as they fly and fall, spread across a festive six-color palette;
- **the flutter down** — the pieces arc over under gravity and, slowed by air drag,
  sway side to side as they settle, fading out near the end.

## The paradigm — a system, simulated live

This case does **not** ask the model to place individual particles. It authors a
**system** — emitters, forces, and per-particle F-curves — that the review UI and a
game **simulate live**, the way a real particle editor (Niagara, VFX Graph) plays a
system. The authored `system.json` **is** the asset; every consumer plays it by
running the simulation, so the effect **varies slightly from one play to the next**.
There is no target frame sequence and no bake: the case rewards a well-shaped effect
whose *character* — the pop, the colorful spread, and the fluttering fall — reads
the same across replays, not the reproduction of a supplied clip.

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

Confetti Pop ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/easy/confetti-pop/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
