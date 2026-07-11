# Floe

**Floe** is a single-screen arctic **crossing** game for the browser. A small
tundra critter hops one tile at a time across a frozen strait — over eight lanes
of sliding **ice hazards** (snow plows, dogsleds, and cars) and then across eight
lanes of deadly water on drifting **floes** that carry it sideways — to fill a row
of five safe **bays** on the far shore.

Floe's defining idea is the **hunter**: a **polar bear** chases the critter across
the *whole* strait. It emerges at the near shore and glides **continuously** after
the critter, pacman-style — turning only at tile centers as it routes **around**
the sliding vehicles (and is knocked out and reset if one slides into it, so you
can lure it into traffic) — and **swims** out onto the water after you, staying
visible as a submerged silhouette and wake. Its only limit is speed: steady forward
hopping keeps you ahead, but hesitate, backtrack, or fumble a floe and it closes
and catches you.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys; the provided sprite art is bundled into the build, which runs unchanged
at any base path.

## How to play

Cross the strait and land in an open bay to fill it. Fill all **5 bays** to clear a
level; clear all **8 levels** to win. You have **3 lives**, lost to the bear, a
hazard, drowning / drifting off the edge, or the crossing **timer** running out.
Each level the lanes and the bear speed up, and from **level 5** a second bear
hunts you.

- **Ice band** — solid lanes you may pause on. You can't step into a vehicle (the
  hop is refused), but a vehicle that slides into your tile is death. Time the gaps.
- **Water band** — every open-water tile is death. Hop onto a floe and ride it;
  hop floe to floe, and hop off before a floe carries you off the side edge.
- **The bear** — never stop moving. The only safety is a filled bay.

## Controls

| Action | Keys |
| --- | --- |
| Hop one tile | `↑` `↓` `←` `→` or `W` `A` `S` `D` |
| Menu navigation | `↑` / `↓` (or `W` / `S`) |
| Confirm | `Enter` or `Space` |
| Back | `Esc` |
| Pause (in game) | `P` or `Esc` |
| Mute / unmute audio | `M` |

There is no charged or multi-tile jump and no diagonal hop; a hop that would leave
the strait or hit the far-shore wall / a filled bay is simply refused.

## Requirements

- Node.js 18+ and npm. No other toolchain is needed.

## Install

```sh
npm ci        # or: npm install
```

## Run in development

```sh
npm run dev
```

Vite serves the game with hot-reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root. The output is fully self-contained (the sprite art
is inlined) and runs correctly served from any path:

```sh
npm run preview        # serves dist/ locally for a final check
```

## Project layout

```
index.html            Vite entry; hosts the <canvas>
vite.config.ts        Build config (base: "./", emits to dist/)
assets/               The provided sprite art (bundled through Vite)
src/
  main.ts             Bootstrap: sprite load, canvas fit/letterbox, fixed-step loop
  constants.ts        Geometry, palette, and tuning (logical 1280x720)
  types.ts            Shared types
  grid.ts             Tile grid & band geometry helpers
  assets.ts           Sprite loading via a page-relative Vite glob
  input.ts            Keyboard: held state + edge events
  audio.ts            Web Audio cues (optional, mutable)
  lanes.ts            The ice-band vehicles and water-band floes, per level
  entities.ts         The Critter (hops) and the Bear (continuous, pacman-style)
  hunter.ts           The bear's pathfinding (BFS pursuit around the hazards)
  game.ts             State machine, crossing flow, fixed-step simulation
  render.ts           All canvas drawing (the strait, sprites, HUD, menus, VFX)
```
