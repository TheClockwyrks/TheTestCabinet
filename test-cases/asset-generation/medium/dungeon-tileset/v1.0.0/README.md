# Dungeon Tileset — v1.0.0

## What it is

A medium **asset-generation** case (`asset_kind = "sprite"`). The model draws a
**top-down dungeon-crawler tileset** as one **96×96** image: a **3×3 grid of nine
32×32 tiles** — three stone-floor variants (plain, cracked, mossy), a brick wall
front-face and its wall-top cap, a banded wooden door, stairs descending into the
dark, a bone- and rubble-strewn floor, and a lit floor brazier. The set has to read
as one cohesive dark, dank stone dungeon with a **single warm brazier accent**, and
the floor tiles have to align edge-to-edge on the 32-pixel grid.

The sprite is produced with the `draw` tool, **one operation at a time**. The
recorded `actions.json` — not the pixels on disk — is the authoritative output; it
is regenerated pixel-for-pixel, so the brief pins an explicit palette and full
transparency. A reviewer scores the result against the brief across two domains:
whether each of the nine **tiles** depicts its subject, and whether they hold
together as one **cohesive** set.

## Layout

| File | Purpose |
| --- | --- |
| `test-case.toml` | Manifest: metadata, `[canvas]`/`[tool]`/`[output]` tables, domain. |
| `prompt.hbs` | Instruction handed to the harness. |
| `specs/brief.md` | The self-contained drawing brief (seeded into the run). |
| `variants/base.toml` | The single default variant. |
| `description.md` | Site-facing blurb. |
| `changelog.md` | Per-version changelog. |

## Validate

From the repo root, render the prompt and seed a run into a scratch directory:

```
tcab prompt --test-case dungeon-tileset --version v1.0.0 --variant base
tcab seed   --test-case dungeon-tileset --version v1.0.0 --variant base --out-dir <dir>
```

Both should exit 0. `seed` stages the brief plus a blank `canvas.png` and empty
`actions.json` for the `draw` tool to build on.
