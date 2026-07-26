# Locomotivation — reference implementation (`base`)

**Locomotivation** is a ¾-overhead rail-yard hauling arcade game that runs entirely in
the browser. You are a yard worker: haul **color-matched freight** from its dispenser to
the matching drop zone across a yard **alive with deterministic, telegraphed trains** —
where touching **any** part of a train (its sides included) is instantly lethal — and beat
the shift clock. The freight you carry **slows you down**, and a heavy enough load **locks
out your sprint**, so every pickup is a wager against the crossings you still have to make.
Some freight is a **one-of-a-kind package** that fails the shift if lost, some levels offer
an optional **last train** to board for a bonus as the shift ends, and it all plays out over
a **six-level campaign**.

This is the authored, correct playable build. It is a **full-stack** case: the worker
animation, the trains, the yard tiles, the packages/signals/levers, the particle VFX, and
the audio are all **produced during authoring** with the six on-`PATH` asset tools and
committed under [`assets/`](assets/); the build loads them and never invokes the tools.

## Tech

Plain **TypeScript + Canvas 2D**, bundled with **Vite** (no framework). The core simulation
(`src/sim/`) is rendering-free and stepped on a fixed 60 Hz timestep, so it is fully
**deterministic** and can be driven headlessly by the balance harness in [`sim/`](sim/).

- `src/sim/` — the pure core: movement + carry-weight/sprint model, deterministic scheduled
  trains and lethal collision, cargo pickup/carry/delivery/drop, bridges/refuges, junction
  switches, the clock/lives/win-fail, near-miss and the derived last-train bonus.
- `src/render.ts` — the ¾ renderer (ground → rails → base-y-sorted upright sprites → VFX).
- `src/hud.ts` — the in-code HUD (clock, quota, lives, load bar, sprint bar).
- `src/game.ts` — the screen state machine, menus, event → audio/particle wiring, dev hooks.
- `src/particles.ts` / `src/audio.ts` — produced particle systems (via
  `@test-cabinet/particle-runtime`) and Web Audio playback of the produced `.wav`s.
- `src/levels.ts` — the six-level campaign encoded as **data** (the balance surface).

## Install, run, build

Requires only Node.js and npm — no separate language toolchain, no API keys, no network at
runtime.

```sh
npm ci            # install pinned dependencies (incl. the vendored particle-runtime)
npm run dev       # start the Vite dev server (prints a local URL)
npm run build     # type-check (tsc --noEmit) + produce the static site into dist/
npm run preview   # serve the built dist/ locally
```

`npm run build` emits a fully self-contained static site into `dist/` with `index.html` at
its root. Every asset URL is **page-relative** (Vite `base: './'`), so the build runs
correctly served from any sub-path, not only the server root.

## Controls

| Action | Keys |
| --- | --- |
| Move | `W A S D` or Arrow keys (crisp, no momentum) |
| Sprint | Hold `Shift` (recharging burst; locked out over ~80% load) |
| Pick up / throw lever | `E` or `Space` (when adjacent) |
| Drop | `Q` (sets down your most-recent package) |
| Deliver | *automatic* — walk carried freight into its matching-color zone |
| Board last train | *automatic* — step onto a rideable flat-top car (quota met) |
| Pause | `Esc` |
| Mute | `M` |
| Menus | Arrows / `W S` (and `A D` on the level grid), `Enter`/`Space` confirm, `Esc` back |

The **How to play** screen in-game restates these.

## Balance harness

A headless, deterministic balance harness lives in [`sim/`](sim/); run it with
`npx tsx sim/run.ts`. It drives the exact core simulation from `src/sim`, checks determinism,
and runs a reactive courier autopilot over the campaign to report each level's outcome and
clock margin. It never edits the level data — tuning `src/levels.ts` is the balance pass's
job (`../../specs/levels.md`). See [`sim/README.md`](sim/README.md).

## Produced assets

The full asset list is [`ASSET-MANIFEST.md`](ASSET-MANIFEST.md); every file under `assets/`
is produced with the on-`PATH` tools per [`../../specs/assets.md`](../../specs/assets.md).
The **animated four-facing worker** and the **trains** are the centerpieces; the **cargo
splinter** particle system (fired when a train smashes freight) is the required VFX.
