# Caldera Pipe Hub — `v1.0.0`

This is version `v1.0.0` of the **Caldera Pipe Hub** test case: a **static**
asset-generation case (`asset_kind = "voxel-model"`) that asks a model to sculpt one
pipe junction — a squat bolted drum where up to six pipe runs meet — as a 16×16×16
opaque-voxel model using only the `voxel` tool, one recorded operation at a time.
There is **no rig, no joints, and no animations** — it is a single static model.

`caldera-pipe-hub` is the catalog slug for this case. It is one half of the pipe kit
(alongside [`caldera-pipe-span`](../../caldera-pipe-span/)) whose produced models are
seeded into the [`caldera`](../../caldera/) end-to-end case. There is no target
model — the model builds toward the seeded brief and is reviewed subjectively against
it.

## The contract

The brief fixes only **what the hub is** and **the accent region a game recolors** —
not the exact geometry. It describes the subject (a squat central drum, a raised
flange socket facing outward on each of the six sides, bolt heads ringing each socket,
and a bolted cap plate on top) and leaves the silhouette and technique to the model.
On the Caldera map each hex cell has six neighbors, so the build chooses at run time
which of the six sockets a span plugs into — every one of the six sockets must be
**identical and interchangeable**, so any span bolts into any socket the same way.

## The accent region

For the pipe kit the accent region is **the whole pipe body**, not a sub-region. The
drum and its socket stubs are sculpted entirely in the neutral base color `#808890`;
the Caldera build finds every voxel of it and repaints the body to the network's fluid
color (blue `#3d9bd6` for a water junction, teal `#7fcabc` for a steam junction), so
one hub serves both networks. The iron flanges, socket collars, bolts, and cap plate
are sculpted in `#3a3836` and are **never** repainted — they are what keeps the piece
reading as a physical, bolted junction rather than a plain colored lump. The contract
is documented in the end-to-end case's `specs/assets.md`, and the reviewer checks
whether the body is entirely the base color and the ironwork entirely iron.

The brief also forbids the water color `#3d9bd6` and the steam color `#7fcabc`
anywhere on the model, since the build paints one of those onto the body at run time.

## Contents

| Path             | Seeded to run? | Purpose                                               |
| ---------------- | -------------- | ----------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained brief (plain Markdown).            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.         |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, domain, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).     |
| `description.md` | No             | Site blurb.                                           |
| `changelog.md`   | No             | This version's changelog entry.                       |
| `README.md`      | No             | This overview.                                        |

A run receives the seeded brief, the `voxel` binary, and a pre-seeded
`voxel.config.json` (volume dimensions, background, and the log/preview/geometry
paths). There is **no target model, no rig, and no operations schema** — the binary's
`--help` is the contract.

## Variants

This case ships a single variant, `base` (the case's 16×16×16 volume). It adds no
specs or domains of its own, and declares no `[voxel]` override, so the volume never
varies.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-pipe-hub/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
