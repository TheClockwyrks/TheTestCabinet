# Top-Down City Street Tileset — `v1.0.0`

This is version `v1.0.0` of the **Top-Down City Street Tileset** test case: an
asset-generation case (`asset_kind = "sprite"`) that asks a model to draw a cohesive
overhead city-street tileset into a **single 96×96 sprite** using only the `draw`
binary, one recorded operation at a time.

`topdown-city-street` is the catalog slug for this case. It is **generic and reusable**
— not tied to any particular game — so it can seed a whole family of top-down city
maps. There is no target image; the model draws toward the seeded brief and is reviewed
subjectively against it.

## What it is

The 96×96 image is a **3×3 grid of nine 32×32 tiles** a top-down game slices apart and
repeats:

| Cell | Tile |
| --- | --- |
| Top-left | Plain asphalt road |
| Top-center | Road with a dashed center line |
| Top-right | Zebra crosswalk |
| Mid-left | Concrete sidewalk |
| Mid-center | Grass verge |
| Mid-right | Flat rooftop with a small AC unit |
| Bottom-left | Parking-lot patch with a painted stall line |
| Bottom-center | Manhole-cover road tile |
| Bottom-right | Curb / sidewalk-to-road transition |

What makes it *medium* is that it is a **tileset**, not nine loose pictures: every tile
must be **strictly top-down** (flat markings on flat ground — no perspective, height, or
side faces) and the tiles must **align edge-to-edge and repeat seamlessly**, with the
dashed lane line and the crosswalk stripes continuing across a shared cell edge. The
brief fixes an exact ten-color **street palette** (asphalt greys, sidewalk grey, curb
grey, lane yellow, lane white, grass green and its dark, rooftop tan, shadow) and the
nine tiles are painted entirely from it.

## The tool

A run gets the `draw` binary on its `PATH` (the single 2D-sprite run-container image).
It is the only channel: the model builds the image one operation at a time, and the
ordered operations recorded to `actions.json` are the **authoritative output** that is
regenerated into the sprite and scored — not any pixels written to disk another way.
There is no operations schema; the binary's `--help` is the contract.

## Contents

| Path | Seeded to run? | Purpose |
| --- | --- | --- |
| `specs/brief.md` | **Yes** | The self-contained drawing brief (grid, tiles, palette). |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `test-case.toml` | No | Manifest: canvas, tool, output, domain. |
| `variants/` | No | One TOML file per variant (listed in `variants`). |
| `description.md` | No | Site blurb. |
| `changelog.md` | No | This version's changelog entry. |
| `README.md` | No | This overview. |

A run receives the seeded brief, the `draw` binary, and a blank 96×96 canvas with an
empty action log. Core regenerates the recorded operations into `canvas.png`, which a
reviewer evaluates — there is no target image and no cheat-divergence check.

## Variants

This case ships a single default variant — `base`, declared in `variants/base.toml`. It
seeds the common brief and is rated on the case's single `overall` scoring domain; it
adds no specs or domains of its own.

## Validate

From the repo root, render the prompt and seed a scratch run directory:

```
tcab prompt --test-case topdown-city-street --version v1.0.0 --variant base
tcab seed   --test-case topdown-city-street --version v1.0.0 --variant base --out-dir <dir>
```

Both should exit 0.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/medium/topdown-city-street/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
