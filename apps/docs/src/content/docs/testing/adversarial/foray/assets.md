---
title: "Visual assets"
---

Foray cannot use Pac-Man art, so it ships its **own generated pixel-art** set:
a single **sprite-sheet PNG** plus an **atlas JSON**, consumed by the browser
[replay renderer](/testing/adversarial/foray/architecture/#browser-playback).
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
[`foray-core`](/testing/adversarial/foray/architecture/#crate-layout));
it only maps the reconstructed tick's entities onto sprite cells.

## Files & layout

The assets live with the case, beside the renderer:

```
test-cases/foray/v1.0.0/replay/
  index.html          # the [replay] renderer entry
  renderer.mjs        # canvas drawing: tick interpolation, walk cycles, wall autotiling
  assets/
    gen-sheet.mjs     # the packer: composes source art (+ placeholders) -> sheet.png/json
    sheet.png         # the packed sprite sheet (RGBA PNG)
    sheet.json        # the atlas: frames + anims + wall_tiles + border_tiles
    palette.json      # named color slots + per-team ramps (see below)
    source/           # committed finished per-asset art the packer composes in
```

- **`sheet.png`** — one PNG, cells on a 16×16 grid, frames packed top-left. Plain
  **RGBA** (color type 6): the renderer's per-team recolour matches the neutral
  ramp by **colour value** (see [Palette & recolour](#palette--recolour)), so the
  sheet does *not* need to be indexed-color.
- **`sheet.json`** — the atlas. Named frames map to pixel rectangles, plus the
  **animations** (walk cycles the renderer plays as an agent crosses a tile) and
  the **autotile maps** the renderer selects board tiles from:

  ```jsonc
  {
    "cell": 16,
    "frames": {
      "soldier_s_0": { "x": 0,  "y": 0,  "w": 16, "h": 16 },  // facing-major walk frames
      "raider_e_2":  { "x": 96, "y": 16, "w": 16, "h": 16 },
      "raider_laden_e_2": { "x": 96, "y": 32, "w": 16, "h": 16 },
      "seed":        { "x": 16, "y": 48, "w": 16, "h": 16 },
      "wall_5":      { "x": 0,  "y": 80, "w": 16, "h": 16 },   // bitmask-keyed wall tile
      "floor":      { "x": 48, "y": 80, "w": 16, "h": 16 }
      // ...
    },
    "anims": {
      // one ordered walk cycle per role+facing; the renderer ties the phase to
      // motion (a frame per quarter-cell) and falls back to fps when free-running.
      "soldier_walk_s": { "frames": ["soldier_s_0","soldier_s_1","soldier_s_2","soldier_s_3"], "fps": 8 },
      "raider_walk_s":  { "frames": ["raider_s_0", "..."], "fps": 8 },
      "raider_laden_walk_s": { "frames": ["raider_laden_s_0", "..."], "fps": 6 }
      // ... + _n / _w / _e for each
    },
    "wall_tiles":   { "0": "wall_0", "5": "wall_5", "...": "...", "15": "wall_15" }, // N=1,E=2,S=4,W=8
    "border_tiles": { "cap_top": "border_cap_top", "mid": "border_mid", "cap_bottom": "border_cap_bottom" }
  }
  ```

## Required frames

The set the renderer needs to draw a match. Team colour comes from the palette
swap, so each agent/nest frame is authored **once** (in a neutral base ramp) and
tinted Red or Blue at draw time — never duplicated per team. The moving casts
(soldier, raider) are **walk cycles**: four frames per facing, named
`<role>_<facing>_<step>` and grouped into the atlas's `anims`, which the renderer
cycles as the agent crosses a tile so motion reads smoothly between ticks.

| Group | Frames | Notes |
| --- | --- | --- |
| **Soldier** (defender) | `soldier_{s,n,w,e}_{0..3}` (16) | Mandibled, angular silhouette; a 4-step walk cycle per facing → `anims.soldier_walk_{s,n,w,e}`. |
| **Raider** (forager, empty) | `raider_{s,n,w,e}_{0..3}` (16) | Lighter, leaner silhouette; 4-step walk cycle per facing → `anims.raider_walk_*`. |
| **Raider, laden** | `raider_laden_{s,n,w,e}_{0..3}` (16) | The same cycles carrying a seed — slower, heavier: the [carry-weight](/testing/adversarial/foray/overview/#carry-weight--the-signature-mechanic) tell → `anims.raider_laden_walk_*`. |
| **Immune raider** | _(no frame)_ | Not a sheet frame: the renderer draws a breathing additive cyan aura procedurally over any agent with `immune_ticks > 0` (jelly active), pulsed by the tick clock so it haloes the sprite. |
| **Seed cache** | `seed` | The scorable resource. |
| **Royal jelly** | `jelly_active`, `jelly_spent` | Active = glowing node; spent = dimmed husk after it is eaten. |
| **Maze walls** | `wall_{0..15}` | A 4-neighbor **autotile** set; the frame index is the N=1/E=2/S=4/W=8 connection bitmask, mapped in `wall_tiles`. The renderer picks each board cell's tile from its wall neighbors, so walls render as a connected pac-man-style maze. |
| **Boundary seam** | `border_{cap_top,mid,cap_bottom}` | The no-man's-land divider down the middle, in `border_tiles`; capped top/bottom, tileable middle. |
| **Floor** | `floor` | Dug-tunnel ground the maze sits on. |
| **Nest** | `nest` | One frame, tinted per team, marking each spawn. |

The agent walk cycles and the wall/boundary/floor tiles are produced by their own
asset-generation cases (next section); facing is still decorative (the rules are
direction-agnostic), and the renderer falls back to a single static frame name if
a walk anim is ever absent, so the contract tolerates a partial set.

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

At draw time the renderer (`renderer.mjs`, `loadSheet`) bakes one tinted copy of
the sheet per team by **matching the four neutral grey ramp values by colour** and
rewriting them to that team's ramp — so the swap needs no indexed palette, just an
RGBA sheet. **Seeds, jelly, and the soil tiles use the shared ramp** and are not
tinted: they deliberately avoid the four neutral greys, so the value-match leaves
them untouched. The board reads as **earthy soil + dug tunnels**, with the two
colonies
the only saturated colour — so attacker/defender allegiance is legible at a
glance, and a laden raider's carried seed (`carried_seed` / shared `seed` gold)
pops against either colony.

## Generation & review

The finished art is **itself produced by The Test Cabinet**: each piece of the
sheet is the output of an [asset-generation](/testing/asset-generation/overview/)
case drawn against its own brief —

| Asset | Case |
| --- | --- |
| Nest | `foray-nest` (single sprite) |
| Seed cache | `foray-seed` (single sprite) |
| Royal jelly (active + spent) | `foray-jelly` (2-frame sheet) |
| Soldier walk cycles | `foray-soldier` (16-frame sheet) |
| Raider walk cycles, empty + laden | `foray-raider` (32-frame sheet) |
| Maze wall autotile + boundary + floor | `foray-walls` (20-frame sheet) |

A run's **regenerated** frames are committed under `replay/assets/source/` (named
for the atlas frame they fill — see `source/README.md`), and a reviewer can
eyeball them or the packed `sheet.png` directly; a regeneration is an ordinary
diff.

## The generation pipeline

A committed Node packer, `replay/assets/gen-sheet.mjs`, **composes** the sheet —
run `node gen-sheet.mjs` from `replay/assets/`. For every frame in the
[frame list](#required-frames) it blits the finished art from `source/<name>.png`
when present and otherwise draws a structured **placeholder** glyph, then writes
the RGBA `sheet.png` and the `sheet.json` atlas (frames + `anims` + `wall_tiles` +
`border_tiles`), kept in sync with `palette.json`. So finished and
not-yet-generated frames coexist in one committed sheet the renderer consumes
unchanged; re-run the packer whenever `source/`, the spec, or the palette changes.

:::note[Some frames are still placeholders]
The committed `sheet.png` mixes finished art (the nest, seed, and jelly today)
with **placeholder** glyphs for the frames whose case has not been generated yet
(the soldier/raider walk cycles and the wall tileset). Each placeholder still
conforms to the frame list, grid, and palette — so the renderer draws a correct,
legible, fully-animated match against it today — and is replaced drop-in by
dropping the generated frames into `source/` and re-running the packer, with no
renderer change.
:::
