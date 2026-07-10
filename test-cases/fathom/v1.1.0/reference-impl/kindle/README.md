# Fathom

**Fathom** is a bioluminescent deep-sea maze chase for the browser. You are a
small glowing forager threading the flooded corridors of a pitch-dark trench,
grazing drifting **plankton** while three very different predators hunt you. The
trench starts unseen: you only know what your own **light** has touched or what a
**sonar** pulse has revealed, so the game is as much about *sensing* where the
danger is as about outrunning it.

Fathom's defining idea is **hunting in the dark**. This **Kindle** dive reads the
trench with a StarCraft-style fog of war — line-of-sight light and a
corridor-flooding sonar reveal it, and what you explore stays remembered — but adds
one thing that defines it: an outer **vision circle** you carry. It is an actual
circle centered on the forager, growing as you **eat** and guttering when you stop,
and it **reveals nothing** — it only limits what of your already-explored map is
drawn. You *see* only the part of the trench inside that window; everything beyond
it is pitch black, though still remembered (eaten plankton stay eaten, and hidden
ground returns when you revisit it). The circle is not vision for predators — those
stay tied to the smaller line-of-sight light circle. Each predator hunts by a
different signal you give off:

- **The Lanternjaw** (amber) tracks your **light** — the brighter you glow from
  eating, the farther it finds you. Go dim, or drop ink, to lose it. Its bulb-light
  is always visible and looks almost identical to the bonus drifter, so every amber
  glimmer in the dark is a gamble.
- **The Gloamfin** (violet) tracks your **sound**. It wanders at ordinary speed, but
  when a ping (yours or its own) catches you it sprints — faster than you — to that
  spot, then casts about and re-pings after a short delay. Break away in that window;
  ink does nothing to it.
- **The Flarefish** (orange) is invisible between **flares** — it only learns where
  you are if its own flare (which ignores walls and lights the maze for you) catches
  you at the bloom, and then it chases just like the Lanternjaw. Leave the flare's
  radius, or ink it.

When the Gloamfin's ping or the Flarefish's flare catches you, a bright **detection
alert** flashes so you always know you have been spotted.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys; everything needed to play is in the built bundle. The creature, effect,
and trench-tile art are the **provided sprite sheets** under `assets/` (imported
through Vite so they resolve under any base path); everything else — the fog, the
light pocket, plankton, ink, the HUD, and all text — is drawn in code.

This is the authored **reference implementation** of the `kindle` variant (the
Kindle dive), the ground-truth build for the Fathom test case.

## Controls

| Action | Keys |
| --- | --- |
| Move | `Arrow keys` or `W` `A` `S` `D` |
| Sonar pulse | `Space` (floods corridors, reveals + marks predators, but is heard) |
| Ink | `Shift` (blinds the Lanternjaw and the Flarefish; useless on the Gloamfin) |
| Pause | `Esc` or `P` |
| Menu navigation | `↑` / `↓` (or `W` / `S`) |
| Confirm | `Enter` or `Space` |
| Back | `Esc` |
| Mute / unmute audio | `M` |

Eat every plankton in a trench to descend to a deeper, faster trench with a
shorter sonar range. Contact with any predator costs one of your three lives.

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

This type-checks the sources (`tsc --noEmit`) and emits a complete, self-contained
static site into **`dist/`**, with `index.html` at its root. The bundle uses a
relative base (`base: "./"`), so it runs correctly whether served from a host root
or from a sub-path.

```sh
npm run preview        # serves dist/ locally for a final check
```

## Project layout

```
index.html            Vite entry; hosts the <canvas>
vite.config.ts        Build config (relative base, emits to dist/)
assets/               Provided sprite sheets (forager, predators, effects, tiles)
src/
  main.ts             Bootstrap: canvas fit/letterbox + fixed-timestep loop
  constants.ts        Palette, grid, the maze, timings, speeds, ranges (logical 1280x720)
  types.ts            Shared enums and small helpers
  maze.ts             Maze parsing, wall autotile, wrap tunnel, corridor flood
  assets.ts           Loads the sprite sheets; tints the sonar ring per emitter
  input.ts            Keyboard: held movement + edge events
  audio.ts            Web Audio cues (optional, muteable)
  effects.ts          Transient sonar rings
  sensing.ts          Fog memory, line-of-sight light, brightness (same as base)
  entities.ts         Movers + the tile-locked movement stepping
  predators.ts        The three predators: den release, sensing, tells, AI
  game.ts             State machine, match flow, per-step simulation
  render.ts           All canvas drawing + the vision-circle mask + the HUD and menus
```
