# Midway

**Midway** is a top-down **theme-park tycoon sim** for the browser. You look down on a
fenced grass plot and grow it into a park: lay the **paths** guests walk, place and price
the **rides** they queue for and the **stalls** they buy from, hire the **staff**
(janitors, mechanics, entertainers) who keep it clean and running, and keep a
desire-driven crowd happy.

Its defining idea is one feedback loop the player can watch turning: **happy guests lift
the rating → a high rating lifts the arrival rate at the gate → more guests spend more
money → which funds a bigger, better park that keeps guests happy.** Run it in reverse —
overprice, let rides break and litter pile up — and happiness, rating, arrivals, and cash
all slide, and the park spirals into the red.

There is **no victory screen**. The run is open-ended and measured by **days operated**
(plus peak guests, park rating, total profit). The only end is **bankruptcy**: the park is
lost when cash falls below the bankruptcy floor and stays below it past a short grace
period, at which point the **park-closed** screen shows the tally with **TRY AGAIN** /
**MENU**.

This directory is the authored **reference implementation** of the case's `base`
variant (the *New Park* start — a fresh green plot, the gate and a small plaza already
down, a starting loan, no rides or stalls or staff yet). It is the *correct*,
ground-truth build the case is judged against: a self-contained static web app — plain
**TypeScript** rendering to an **HTML5 canvas**, bundled with **Vite**. No backend,
accounts, network calls, or API keys; everything needed to play is in the built bundle.

## The assets are produced, not pre-made

Midway is a **full-stack** case: every sprite, animation, particle effect, and sound the
game plays was **produced during the build** with the six asset-generation tools on the
run image's `PATH` (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
`music`) and committed under [`assets/`](assets/) — see the case's `specs/assets.md` and
this directory's `ASSETS.md`. At runtime the game only *loads* those committed files; the
tools are not invoked by the build. The particle effects (fireworks, steam, sparkle,
cleanup puffs) are played live through **`@test-cabinet/particle-runtime`** (vendored
under [`vendor/`](vendor/) so a plain `npm ci` resolves it outside the monorepo), and the
sounds through the Web Audio API.

## Controls

- **Start the park** — the title screen's **NEW PARK** entry starts the open-ended run
  directly (there is no map/mode select); **HOW TO PLAY** shows the controls card.
- **Tools** — the bottom tool bar selects **Path**, **Build**, **Staff**, **Price**, or
  **Demolish**; Build expands a row of item chips (rides / stalls / scenery) and Staff a
  row of staff chips (janitor / mechanic / entertainer), each with its cost.
- **Path** — with the Path tool, **drag** in the park to lay an orthogonal L-run of path
  tiles (a running preview tracks the pointer); a press-and-release on one tile lays a
  single tile. Paths grow from the starting plaza.
- **Build / hire** — pick a build item or staff chip, then click a legal spot in the park;
  a ride's or stall's entrance snaps to an adjacent path tile.
- **Price** — with the Price tool, click an attraction to select and inspect it; the
  inspector's **±** steppers set its ticket / sale price.
- **Demolish** — with the Demolish tool, click a placed tile to remove it, refunding
  **50%** of its build cost.
- **Cancel** — **right-click** (or `Esc`) drops a held build/staff item and clears a
  selection before `Esc` opens the pause menu.
- **Camera** — arrows / **WASD** pan, edge-scroll (pointer at the park's edge), and the
  **wheel** zooms (**0.75×–1.5×**).
- **Speed** — **1** / **2** / **3** sets sim speed and **F** (or **+**/**-**) cycles it;
  **Space** pauses in place (the board stays interactive); **Esc** opens the pause **menu**
  (also freezes the board); **M** mutes.
- Every menu is fully operable with the mouse; `↑`/`↓` (or `W`/`S`) + `Enter`/`Space`
  are keyboard alternatives.

Design notes: the **restroom** charges a small (`1`) fee by default; demolishing refunds
**50%** of build cost.

## Develop, build, and run

```bash
npm ci            # install (requires the committed package-lock.json)
npm run dev       # Vite dev server
npm run build     # type-check + produce the static site into dist/
npm run preview   # serve the production build locally
```

`npm run build` emits a fully self-contained static site into `dist/` with an
`index.html` at its root. The bundler base is relative (`base: "./"`), so `dist/` runs
correctly when served from any base path, including a per-run sub-path.

## Layout

- [`src/`](src/) — the game (TypeScript). `constants.ts` (pinned numbers, palette, the
  ride/stall/scenery/staff catalogs + the `TUNE` table) and `types.ts` (the core data
  model) come first and are frozen; then `mode.ts`, `park.ts` (grid/camera/pathfinding),
  `guests.ts` / `rides.ts` / `staff.ts` / `economy.ts` / `rating.ts` (the pure sim
  helpers), `sim.ts` (the `Game` orchestrator), `assets.ts` / `audio.ts` /
  `particles.ts` (loading and playing the produced art, sound, and effects), `render.ts`
  (all drawing + HUD), `input.ts`, `menus.ts`, and `main.ts` (the loop). See `DESIGN.md`.
- [`sim/`](sim/) — a headless, deterministic **balance harness** (dev-only, excluded from
  the build): `npx tsx sim/run.ts` drives scripted managers and checks the balance goals
  (a greedy/overpriced or unstaffed park must go bankrupt; competent play must stay
  solvent and grow the rating).
- [`assets/`](assets/) — the produced sprites, sprite-sheet frames, particle systems, and
  audio.
- [`vendor/particle-runtime/`](vendor/) — a vendored, prebuilt copy of
  `@test-cabinet/particle-runtime`.
- [`scripts/`](scripts/) — `gen-sprites.sh`, `gen-animations.sh`, `gen-particles.sh`, and
  `gen-audio.sh` (reproduce the produced assets with the on-`PATH` tools) and `proof.mjs`
  (captures the `proof/` artifacts with the project-local Playwright).
- [`proof/`](proof/) — the proof-of-implementation captures (`specs/proof.md`).
