# Overworld Terrain Tiles (`overworld-terrain`) — v1.0.0

A **sprite** asset-generation test case. A model draws a **top-down RPG overworld
terrain tileset** — one 96×96 image holding a 3×3 grid of nine 32×32 terrain tiles
— using only the `draw` binary, one recorded operation at a time.

It is a generic, reusable tileset case: not tied to any particular game, just the
ground a bright storybook overworld is painted from.

## What it is

- A **single 96×96 sprite** (`asset_kind` sprite): a **3×3 grid of nine 32×32
  tiles** on an exact 32-pixel grid.
- The nine terrains, in a fixed layout — grass, water, sandy beach (top row); dirt
  path, dense forest canopy, rocky mountain (middle row); tilled crop field,
  shallow-water edge, stone bridge (bottom row).
- Each tile is drawn to **tile seamlessly**, with light hand-placed texture in a
  bright **storybook palette** (each terrain color with light/dark variants).

The `draw` binary records every operation to `actions.json` and re-renders the
current image to `canvas.png` after each call. The **recorded action log is the
authoritative output**; core regenerates the sprite from it. There is no target
image — the model builds to match the brief, and a human reviews the result
against it.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | — | Manifest: metadata, `[canvas]`/`[tool]`/`[output]`, two domains + review checklist. |
| `prompt.hbs` | — | The instruction rendered per run (points at the brief, the tool, and the grid). |
| `specs/brief.md` | **yes** | The self-contained brief — grid layout, the nine tile assignments, seamless-tiling rules, palette. |
| `variants/base.toml` | — | The single default variant (`base`). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |
| `changelog.md` | — | Per-version changelog entry. |

Only `specs/brief.md` (plus the pre-seeded blank canvas and empty action log the
binary writes into) reaches a run. Everything else is authoring- or site-side only.

## Variants

- **`base`** — the default and only variant; builds toward the common brief with no
  additive constraints.

## Validate

```sh
tcab prompt --test-case overworld-terrain --version v1.0.0 --variant base
tcab seed   --test-case overworld-terrain --version v1.0.0 --variant base --out-dir /tmp/overworld-terrain-seed
```
