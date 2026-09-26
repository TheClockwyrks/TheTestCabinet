---
title: "Visual assets"
---

Foray ships its own generated pixel art: a single sprite-sheet PNG plus an atlas
JSON, consumed by the browser
[replay renderer](/testing/adversarial/foray/architecture/#browser-playback). This
page is the art specification: the dimensions, the required frames, the palette,
and the atlas format, so the assets can be generated, reviewed, and regenerated
against a fixed target. The art is original throughout, on an ant-colony raiding
theme.

The look is a top-down 16 px pixel-art colony. A packed sheet keeps the case to
two committed files, draws as a single texture, and recolours per team by
[palette swap](#palette-and-recolour) rather than by shipping duplicate art. A
fixed 16 px grid matches the discrete, tile-locked board exactly, at one sprite
cell per maze tile.

The renderer holds no game logic. It maps a reconstructed tick's entities onto
sprite cells, and the rules stay in
[`foray-core`](/testing/adversarial/foray/architecture/#crate-layout).

## Files and layout

The assets live with the case, beside the renderer:

```
test-cases/adversarial/easy/foray/v1.0.0/replay/
  index.html          # the [replay] renderer entry
  renderer.mjs        # canvas drawing: interpolation, walk cycles, autotiling
  assets/
    gen-sheet.mjs     # the packer: composes source art -> sheet.png/json
    sheet.png         # the packed sprite sheet (RGBA PNG)
    sheet.json        # the atlas: frames + anims + wall_tiles + border_tiles
    palette.json      # named color slots + per-team ramps
    source/           # committed finished per-asset art the packer composes in
```

`sheet.png` is one PNG with cells on a 16 px grid, frames packed from the top
left. It is plain RGBA, because the renderer's per-team recolour matches the
neutral ramp by colour value rather than through an indexed palette.

`sheet.json` is the atlas. Named frames map to pixel rectangles, and it carries
the animations the renderer plays as an agent crosses a tile and the autotile
maps it selects board tiles from:

```jsonc
{
  "cell": 16,
  "frames": {
    "soldier_s_0": { "x": 0, "y": 0, "w": 16, "h": 16 },
    "raider_e_2": { "x": 96, "y": 16, "w": 16, "h": 16 },
    "seed": { "x": 16, "y": 48, "w": 16, "h": 16 },
    "wall_5": { "x": 0, "y": 80, "w": 16, "h": 16 },
    "floor": { "x": 48, "y": 80, "w": 16, "h": 16 },
  },
  "anims": {
    // One ordered walk cycle per role and facing. The renderer ties the phase to
    // motion and falls back to `fps` when free-running.
    "soldier_walk_s": {
      "frames": ["soldier_s_0", "soldier_s_1", "soldier_s_2", "soldier_s_3"],
      "fps": 8,
    },
    "raider_laden_walk_s": { "frames": ["raider_laden_s_0"], "fps": 6 },
  },
  "wall_tiles": { "0": "wall_0", "5": "wall_5", "15": "wall_15" },
  "border_tiles": {
    "cap_top": "border_cap_top",
    "mid": "border_mid",
    "cap_bottom": "border_cap_bottom",
  },
}
```

## Required frames

Team colour comes from the palette swap, so each agent and nest frame is authored
once in a neutral base ramp and tinted Red or Blue at draw time. The moving casts
are walk cycles: four frames per facing, named `<role>_<facing>_<step>` and
grouped into the atlas's `anims`, which the renderer cycles as the agent crosses
a tile.

| Group         | Frames                               | Notes                                                                                                                                                                                                  |
| ------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Soldier       | `soldier_{s,n,w,e}_{0..3}` (16)      | Mandibled, angular silhouette; a 4-step walk cycle per facing, grouped as `anims.soldier_walk_{s,n,w,e}`.                                                                                              |
| Raider, empty | `raider_{s,n,w,e}_{0..3}` (16)       | Lighter, leaner silhouette; 4-step walk cycle per facing, grouped as `anims.raider_walk_*`.                                                                                                            |
| Raider, laden | `raider_laden_{s,n,w,e}_{0..3}` (16) | The same cycles carrying a seed, the carry-weight tell, grouped as `anims.raider_laden_walk_*`.                                                                                                        |
| Seed cache    | `seed`                               | The ordinary scorable resource, worth 1.                                                                                                                                                               |
| Large seed    | `large_seed`                         | Worth and weighing three ordinary seeds. It is the only fixture that moves, so it is drawn per frame from the snapshot's `large_seeds`. Its drift step is a discrete hop, so it is drawn unsmoothed.   |
| Royal jelly   | `jelly_active`, `jelly_spent`        | Active is a glowing node; spent is the dimmed husk after it is eaten. A node regrows at the same tile, and the renderer derives "spent" as any jelly tile absent from the frame's active `jelly` list. |
| Maze walls    | `wall_{0..15}`                       | A 4-neighbour autotile set. The frame index is the N=1, E=2, S=4, W=8 connection bitmask, mapped in `wall_tiles`, so walls render as a connected maze.                                                 |
| Boundary seam | `border_{cap_top,mid,cap_bottom}`    | The no-man's-land divider down the middle, in `border_tiles`, capped top and bottom with a tileable middle.                                                                                            |
| Floor         | `floor`                              | Dug-tunnel ground the maze sits on.                                                                                                                                                                    |
| Nest          | `nest`                               | One frame, tinted per team, marking each spawn.                                                                                                                                                        |

Immunity has no sheet frame. The renderer draws a breathing additive cyan aura
procedurally over any agent with `immune_ticks > 0`, pulsed by the tick clock. An
immune soldier is reachable, because a raider that eats jelly and runs home keeps
its window, so the aura applies to either role.

Facing is decorative, since the rules are direction-agnostic, and the renderer
falls back to a single static frame name when a walk animation is absent, so the
contract tolerates a partial set.

## Palette and recolour

`palette.json` defines named colour slots and the per-team ramps that fill them,
so the two colonies are one art set rendered twice:

```jsonc
{
  "slots": ["body_dark", "body_mid", "body_light", "accent", "carried_seed"],
  "shared": {
    "soil_dark": "#241a12",
    "soil_mid": "#3a2a1c",
    "floor": "#1b1410",
    "border": "#4a3f2a",
    "seed": "#e8c14a",
    "jelly": "#7be0a0",
    "jelly_spent": "#3c5a47",
    "carried_seed": "#ffd964",
  },
  "teams": {
    "red": {
      "body_dark": "#5a1410",
      "body_mid": "#a83228",
      "body_light": "#e8635a",
      "accent": "#ffb0a0",
    },
    "blue": {
      "body_dark": "#0f2a5a",
      "body_mid": "#2a5aa8",
      "body_light": "#5a8fe8",
      "accent": "#a0c8ff",
    },
  },
}
```

At draw time the renderer bakes one tinted copy of the sheet per team by matching
the four neutral grey ramp values by colour and rewriting them to that team's
ramp, so the swap needs an RGBA sheet rather than an indexed palette. Seeds,
jelly, and the soil tiles use the shared ramp and avoid the four neutral greys,
so the value match leaves them untouched. The board therefore reads as earthy
soil and dug tunnels with the two colonies as the only saturated colour, and a
laden raider's carried seed stays legible against either colony.

## Generation

Every frame is the output of an
[asset-generation](/testing/asset-generation/overview/) case drawn against its
own brief:

| Asset                                   | Case                               |
| --------------------------------------- | ---------------------------------- |
| Nest                                    | `foray-nest` (single sprite)       |
| Seed cache                              | `foray-seed` (single sprite)       |
| Large seed                              | `foray-large-seed` (single sprite) |
| Royal jelly, active and spent           | `foray-jelly` (2-frame sheet)      |
| Soldier walk cycles                     | `foray-soldier` (16-frame sheet)   |
| Raider walk cycles, empty and laden     | `foray-raider` (32-frame sheet)    |
| Maze wall autotile, boundary, and floor | `foray-walls` (20-frame sheet)     |

A run's regenerated frames are committed under `replay/assets/source/`, named for
the atlas frame they fill, with the frame-index mapping recorded in
`source/README.md`. A regeneration is an ordinary diff a reviewer can eyeball,
either per frame or on the packed `sheet.png`.

The committed Node packer `replay/assets/gen-sheet.mjs` composes the sheet. Run
`node gen-sheet.mjs` from `replay/assets/`. For every frame in the
[frame list](#required-frames) it blits the finished art from `source/<name>.png`
when present and otherwise draws a structured placeholder glyph, then writes the
RGBA `sheet.png` and the `sheet.json` atlas in sync with `palette.json`. Re-run
the packer whenever `source/`, the frame list, or the palette changes.
