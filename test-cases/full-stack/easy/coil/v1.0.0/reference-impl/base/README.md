# Coil — Grid Serpent (reference implementation, Classic mode)

Coil is a neon, grid-locked serpent game for the browser. A snake threads a single
continuous path across a bordered grid, eating pellets that make it grow one cell longer
each time. Its signature is the **combo**: pellets eaten in quick succession build a scoring
multiplier that decays the moment you dawdle, so the real game is planning an efficient route
from one pellet to the next, not just staying alive.

This is the **reference implementation** for the [Coil test case](../../). It is a complete,
polished, playable build that matches the specs under [`../../specs/`](../../specs/) exactly,
and it renders the snake entirely from a **produced** pixel-art sprite set (an animated biting
head, a straight body, a corner sprite at every bend, and a tapering tail) over **produced**
sound and music — see [`ASSETS.md`](ASSETS.md).

This is the `base` build, so it plays **Classic** mode (the open board). The identical
codebase also implements **Maze** mode (four fixed, fatal obstacle bars); the only difference
between the two builds is the one line in [`src/mode.ts`](src/mode.ts).

## Controls

| Action | Keys |
| --- | --- |
| Steer the snake | Arrow keys **or** `W` `A` `S` `D` |
| Menus / pause / game-over: move selection | `↑` `↓` (or `W` `S`) |
| Confirm | `Enter` or `Space` |
| Back | `Esc` |
| Pause (in play) | `Esc` or `P` |
| Toggle sound | `M` |

A turn takes effect on the next simulation tick and only if it is perpendicular to the
direction you are actually moving — you can never reverse straight back onto your own neck.

## Install, run, build

```sh
npm ci          # install pinned dependencies (requires the committed package-lock.json)
npm run dev     # Vite dev server with hot reload
npm run build   # type-check + emit the static site to dist/
npm run preview # serve the built dist/ locally
npm run verify  # build-verification harness (see below)
```

`npm run build` produces a fully self-contained static site in `dist/` with
`index.html` at its root. It bundles the committed produced assets and **does
not** invoke the asset tools, so it builds anywhere. Vite's `base: "./"` makes
every emitted URL page-relative, so `dist/` runs correctly whether served at a
host root or mounted under a per-run sub-path like `/runs/<id>/build/`.

## Verification

`node scripts/verify.mjs` (also `npm run verify`) serves the built `dist/` under a **non-root**
sub-path with the project-local Playwright + Chromium and asserts, through the `window.__coil`
dev surface, that the page loads with zero console/request errors, the title state is reached,
a round starts, the snake advances exactly one cell per tick, a turn applies on the next tick
while a reversal is ignored, eating a pellet grows the snake by one and raises the score and
combo, and running into a wall reaches game-over.

## Headless dev surface

The build exposes `window.__coil` for the screenshot / verification harness (inert during
normal play):

```ts
window.__coil = {
  sim,                 // live Sim: .snake, .pellet, .combo, .score, .obstacles, .requestTurn(dir)
  state(): string,     // 'title' | 'howto' | 'playing' | 'paused' | 'gameover' | 'cleared'
  mode(): 'classic' | 'maze',
  start(): void,       // begin a round in this build's mode
  step(n = 1): void,   // advance exactly n fixed ticks synchronously (takes over the clock)
};
```

## Layout

- `src/sim.ts` — the round simulation (snake, pellet, combo, score) and the exact per-tick
  order of operations. Pure and headless.
- `src/game.ts` — the six-state machine, persistent BEST, and menu index around a `Sim`.
- `src/render.ts` — all drawing: code-drawn board/HUD/menus + the snake from produced sprites.
- `src/audio.ts` — Web Audio playback of the produced cues and music bed, with a mute toggle.
- `src/assets.ts` — loads the produced sprites and audio page-relative via Vite globs.
- `src/main.ts` — bootstrap, the fixed-timestep loop, input routing, and `window.__coil`.
- `src/mode.ts` — the single mode switch (`classic` here; `maze` in the sibling build).
- `assets/` — the committed produced snake sprites and audio.
- `scripts/gen-sprites.sh`, `scripts/gen-audio.sh` — how the assets were produced (see
  `ASSETS.md`). Not run at build time.
