---
title: "Visual assets"
---

Foray cannot use Pac-Man art, so it ships its **own generated pixel-art** set:
a single **sprite-sheet PNG** plus an **atlas JSON**, consumed by the browser
[replay renderer](/testing/adversarial/adversarial-pacman/architecture/#browser-playback).
This page is the **art bible** — the dimensions, the required frames, the palette,
and the atlas format — so the assets can be generated, reviewed, and regenerated
against a fixed spec. The art is original throughout: an ant-colony raiding
theme, not a maze-chase homage.

## Why a sprite sheet

The look is a **top-down 16×16 pixel-art** colony. A packed sheet keeps the whole
case to two committed files, draws as a single texture, and recolours per team by
**palette swap** rather than by shipping duplicate art (see
[Palette & recolour](#palette--recolour)). Pixel art at a fixed 16-px grid also
matches the discrete, tile-locked board exactly — one sprite cell per maze tile.

The renderer holds **no game logic** (the rules live in
[`foray-core`](/testing/adversarial/adversarial-pacman/architecture/#crate-layout));
it only maps the reconstructed tick's entities onto sprite cells.

## Files & layout

The assets live with the case, beside the renderer:

```
test-cases/adversarial-pacman/v1.0.0/replay/
  index.html          # the [replay] renderer entry
  assets/
    sheet.png         # the packed sprite sheet (indexed-color PNG)
    sheet.json        # the atlas: named frame -> { x, y, w, h }
    palette.json      # named color slots + per-team ramps (see below)
```

- **`sheet.png`** — one PNG, cells on a 16×16 grid, power-of-two canvas
  (e.g. `256×256`) with frames packed top-left. **Indexed color** so the palette
  swap is a colour-table operation.
- **`sheet.json`** — the atlas. Each named frame maps to a pixel rectangle:

  ```jsonc
  {
    "cell": 16,
    "frames": {
      "soldier_n": { "x": 0,  "y": 0,  "w": 16, "h": 16 },
      "soldier_e": { "x": 16, "y": 0,  "w": 16, "h": 16 },
      "raider_e":  { "x": 0,  "y": 16, "w": 16, "h": 16 },
      "raider_laden_e": { "x": 16, "y": 16, "w": 16, "h": 16 },
      "seed":      { "x": 0,  "y": 96, "w": 16, "h": 16 },
      "jelly_active": { "x": 16, "y": 96, "w": 16, "h": 16 }
      // ...
    }
  }
  ```

## Required frames

The minimum set the renderer needs to draw a match. Team colour comes from the
palette swap, so each frame below is authored **once** (in a neutral base ramp)
and tinted Red or Blue at draw time — they are *not* duplicated per team.

| Group | Frames | Notes |
| --- | --- | --- |
| **Soldier** (defender) | `soldier_n/s/e/w` | Mandibled, angular silhouette. 4 facings. |
| **Raider** (forager, empty) | `raider_n/s/e/w` | Lighter, leaner silhouette. 4 facings. |
| **Raider, laden** | `raider_laden_n/s/e/w` | Visibly carrying a seed; reads as "slow & heavy" — the [carry-weight](/testing/adversarial/adversarial-pacman/overview/#carry-weight--the-signature-mechanic) tell. |
| **Immune raider** | overlay `immune_glint` | A small additive overlay drawn on any agent with `immune_ticks > 0` (jelly active). |
| **Seed cache** | `seed`, optional `seed_small/large` | The scorable resource; size frames let big caches read at a glance. |
| **Royal jelly** | `jelly_active`, `jelly_spent` | Active = glowing node; spent = dimmed husk after it is eaten. |
| **Tiles** | `wall`, `floor`, `border` | Soil wall, dug-tunnel floor, no-man's-land border strip. |
| **Nest** | `nest` | One frame, tinted per team, marking each spawn. |
| **FX (optional)** | `tag_puff`, `bank_spark` | Short, renderer-driven effects on tag and on banking; nice-to-have, not required for a correct replay. |

Facing is decorative — the rules are direction-agnostic — so a first cut may ship
a **single facing** per agent and add the other three later without any contract
change.

## Palette & recolour

`palette.json` defines **named colour slots** and the **per-team ramps** that fill
them, so the two colonies are one art set rendered twice:

```jsonc
{
  "slots": ["body_dark", "body_mid", "body_light", "accent", "carried_seed"],
  "shared": {
    "soil_dark": "#241a12", "soil_mid": "#3a2a1c", "floor": "#1b1410",
    "border": "#4a3f2a", "seed": "#e8c14a", "jelly": "#7be0a0"
  },
  "teams": {
    "red":  { "body_dark": "#5a1410", "body_mid": "#a83228", "body_light": "#e8635a", "accent": "#ffb0a0" },
    "blue": { "body_dark": "#0f2a5a", "body_mid": "#2a5aa8", "body_light": "#5a8fe8", "accent": "#a0c8ff" }
  }
}
```

At draw time the renderer maps the indexed sheet's agent colours through the
chosen team's ramp; **seeds, jelly, and tiles use the shared ramp** and are not
tinted. The board reads as **earthy soil + dug tunnels**, with the two colonies
the only saturated colour — so attacker/defender allegiance is legible at a
glance, and a laden raider's carried seed (`carried_seed` / shared `seed` gold)
pops against either colony.

## Generation & review

The assets are **generated artefacts committed to the case**, produced once
against this spec and then regenerated only when the spec changes. The generator
is an implementation choice (a pixel-art tool, or an image model prompted with
this art bible) — what matters is that the output conforms to the
[frame list](#required-frames), the 16×16 grid, the indexed palette, and the
[atlas format](#files--layout), so the renderer can consume it unchanged. Because
the sheet is small and committed, a reviewer can eyeball `sheet.png` directly, and
a regeneration shows up as an ordinary diff.

## The generation pipeline

The v1 assets are produced by a committed Node generator,
`replay/assets/gen-sheet.mjs`, run once with `node gen-sheet.mjs` from the
`replay/assets/` directory. It writes exactly the files in
[Files & layout](#files--layout) — the indexed-color `sheet.png` on the 16×16
grid, the `sheet.json` atlas, and it is kept in sync with `palette.json` — so the
renderer consumes them unchanged. Re-run it only when the spec or palette changes;
`sheet.png`/`sheet.json` are committed artefacts and a regeneration shows up as an
ordinary diff.

:::note[The shipped sheet is a dummy placeholder]
The committed `sheet.png` is a **valid but placeholder** sheet: each frame is a
simple structured glyph (the agent frames drawn in the recolourable slot indices
`1..4` so the per-team palette swap still lights them Red/Blue, the seeds/jelly/
tiles in the shared ramp). It conforms to the full frame list, the 16×16 grid, the
power-of-two canvas, and the indexed palette, so the renderer draws a correct,
legible match against it today. The **art lead replaces it later** with finished
pixel art — drop-in, since any sheet that satisfies this art bible and keeps the
`sheet.json` atlas in agreement works without a renderer change.
:::
