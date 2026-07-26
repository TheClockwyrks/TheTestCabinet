# Holdfast

**Holdfast** is a top-down **colony survival-management** sim for the browser. You
look down on a single bounded frontier map — soil, grass, rock, tree stands, and ore
veins — and direct a small band of autonomous **settlers** (you never control one
directly) by **designating** work (chop / mine), **placing build orders** (walls,
doors, floors, beds, a stove, farm plots, turrets), and **setting a work-priority
grid**. Settlers pull jobs from a priority queue, pathfind to them, and carry them out
while their own **needs** (hunger, rest) and **mood** drift. A **day/night cycle**
turns; an escalating **threat director** sends **ranged raids** that favor the dark.

There is **no win screen** — Holdfast is pure survival. The only end state is **loss**:
when the **last settler dies** (killed in a raid, bled out while downed, or starved) the
colony is lost, and the colony-lost screen shows **days survived** (the primary score)
plus a tally (raids repelled, raiders killed, structures built, peak population). The
colony must build defenses and a food chain faster than the raids grow and the larder
empties.

This directory is the authored **reference implementation** of the case's `base`
variant (the standard *New Colony* frontier start) — the *correct*, ground-truth build
the case is judged against. It is a self-contained static web app: plain **TypeScript**
rendering to an **HTML5 canvas**, bundled with **Vite** (`base: "./"`). No backend,
accounts, network calls, or API keys; everything needed to play is in the built bundle.

## The assets are produced, not pre-made

Holdfast is a **full-stack** case: every sprite, animation, particle effect, and sound
the game plays was **produced during the build** with the six asset-generation tools on
the run image's `PATH` (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
`music`) and committed under [`assets/`](assets/) — see the case's `specs/assets.md`.
At runtime the game only *loads* those committed files; the tools are not invoked by the
build. The particle bursts (muzzle flash, blood, impact, dust, fire, explosion) play
live through **`@test-cabinet/particle-runtime`** (vendored under [`vendor/`](vendor/)
so a plain `npm ci` resolves it outside the monorepo), and the sounds through the Web
Audio API.

## Controls

- **Start** — the main menu's **NEW COLONY** drops you straight into the standard
  frontier start (there is no map select); **HOW TO PLAY** opens the how-to screen.
- **Designate work** — pick the **designate** tool from the bottom bar, then **drag a
  rectangle** over tree stands / ore veins (a lone click marks one tile); the single
  designate tool reads the node under it — it **chops a tree** or **mines an ore**
  automatically.
- **Cancel** — the **cancel** tool clears designations and build ghosts (click the tile
  to undo). Cancelling a ghost **refunds the full cost** (material is deducted at
  placement).
- **Build** — click a structure in the bottom palette (or its slot) — **wall · door ·
  floor · bed · stove · farm · turret** — then click a legal tile; material is deducted
  and a ghost is raised for a settler to construct. Unaffordable/illegal placements are
  refused with a red ghost. **Right-click** (or `Esc`) drops the active tool/build.
- **Select** — with no tool active, click a settler on the board to select it and read
  its standout skills; `Esc` deselects.
- **Work-priority grid** — the **WORK GRID** button opens the grid panel; rows are
  settlers, columns are `Gather · Haul · Build · Cook · Farm · Fight`; click a cell to
  cycle its priority `0 (off) .. 4`. Settlers pull the highest-priority job they are
  allowed, able, and can reach.
- **Speed** — **1 / 2 / 3** set the speed (also the `×` button); the mouse **wheel**
  zooms the camera (0.85× / 1× / 1.3×).
- **Pause in place** — **Space** (or the **❚❚** control) freezes ticks **without** a
  menu while the board stays interactive (keep panning, placing designations/ghosts, and
  setting the grid); press again to resume.
- **Pause menu** — **Esc** peels back the current context (active tool → work grid →
  selection) and then opens the pause **menu** (Resume / Restart / Quit to menu). **M**
  mutes.
- **Camera** — pan with **WASD** / the **arrow keys** or by pushing the pointer to a
  screen edge; panning never pauses the sim. Every menu is fully operable with the mouse;
  arrows / WASD + **Enter** (or **Space**) are keyboard alternatives and `Esc` backs out.

## Develop, build, and run

```bash
npm ci            # install (requires the committed package-lock.json)
npm run dev       # Vite dev server
npm run build     # type-check + produce the static site into dist/
npm run preview   # serve the production build locally
```

`npm run build` (`tsc --noEmit && vite build`) emits a fully self-contained static site
into `dist/` with an `index.html` at its root. The bundler base is relative
(`base: "./"`), so `dist/` runs correctly when served from any base path, including a
per-run sub-path — every asset loads through `import.meta.glob(..., { query: "?url" })`,
never a root-absolute URL.

## Layout

- [`src/`](src/) — the game. `constants.ts` (the tuning table + palette + enums),
  `types.ts` (the core data model), `rng.ts` (seeded RNG), `world.ts` (tile-world gen,
  camera, line-of-sight / cover), `pathfind.ts` (grid A\*), `jobs.ts` (the job system),
  `combat.ts` (threat director + shooting), `sim.ts` (the `Game` orchestrator and fixed
  step), `mode.ts` (the base start config), `assets.ts` / `audio.ts` / `particles.ts`
  (loading and playing the produced art, sound, and effects), `render.ts` / `hud.ts` /
  `screens.ts` / `menus.ts` (all drawing + HUD + state screens), and `input.ts` +
  `main.ts` (input and the loop). See [`DESIGN.md`](DESIGN.md) for the full module
  breakdown.
- [`assets/`](assets/) — the produced sprites (`terrain/`, `nodes/`, `structures/`,
  `items/`, `icons/`), the `settler/` and `raider/` sprite-sheet frames, the `fx/`
  particle systems, and the `audio/` `.wav`s (see [`ASSETS.md`](ASSETS.md)).
- [`vendor/particle-runtime/`](vendor/) — a vendored, prebuilt copy of
  `@test-cabinet/particle-runtime` so a plain `npm ci` resolves it outside the monorepo.
- [`scripts/`](scripts/) — the re-runnable asset producers, one per family
  (`gen-sprites.sh`, `gen-animations.sh`, `gen-particles.sh`, `gen-audio.sh`), each
  invoking the on-`PATH` tools.
