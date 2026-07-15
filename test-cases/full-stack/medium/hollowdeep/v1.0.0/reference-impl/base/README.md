# Hollowdeep

**Hollowdeep** is a side-view **sealed-colony survival sim** for the browser, in
the spirit of *Oxygen Not Included*. You look at a cross-section of a sealed
underground and keep a small crew of **delvers** alive: **dig** into
dirt/ore/rock to open living space and mine ore, **refine** ore into build
**material**, and place **build orders** — walls, floors, ladders, wires,
machines, a fungus farm — that the delvers construct.

The defining pressure is the **air economy**. The colony opens with a finite
pocket of breathable **oxygen**; every delver breathes it and exhales **CO2**,
both diffuse through the open space (CO2 sinks, oxygen rises), and left alone the
pocket sours and the crew suffocates. Survival is a race to stand up **powered
oxygen generation** (generator + wire + diffuser) and a **food source** before
the starting air runs out, then to hold the colony against its own consumption.

There is **no win screen** — survival is open-ended and the game measures
**cycles survived**. The colony is **lost** when the last delver dies
(suffocation or starvation); the colony-lost screen shows cycles survived and
offers RESTART / MENU. This directory is the authored **reference
implementation** of the case's `base` variant (the *New Colony* start) — the
*correct*, ground-truth build the case is judged against. It is a self-contained
static web app: plain **TypeScript** rendering to a single **HTML5 canvas**,
bundled with **Vite**. No backend, accounts, network calls, or API keys;
everything needed to play is in the built bundle.

> See [`DESIGN.md`](DESIGN.md) for the implementation contract and
> [`ASSETS.md`](ASSETS.md) for the asset manifest.

## The assets are produced, not pre-made

Hollowdeep is a **full-stack** case: every sprite, animation, particle effect,
and sound the game plays is **produced during the build** with the six
asset-generation tools on the run image's `PATH` (`draw`, `draw-sheet`,
`particle-2d`, `sfx-synth`, `sfx-sample`, `music`) and committed under
[`assets/`](assets/) — see the case's `specs/assets.md` and
[`ASSETS.md`](ASSETS.md). At runtime the game only *loads* those committed files;
the tools are not invoked by the build. The gas overlays and one-shot bursts are
played live through **`@test-cabinet/particle-runtime`** (vendored under
[`vendor/`](vendor/) so a plain `npm ci` resolves it outside the monorepo), and
the sounds through the Web Audio API.

**Environment note:** in this environment the baked `sfx-sample` pack and the
`music` instrument bank are empty, so all SFX are authored with **`sfx-synth`**
and the music bed with **`music` using synth-waveform tracks** (not bank
instruments).

## Controls

- **Pick a tool or building** — the bottom **palette** holds the **DIG** tool, a
  button per buildable (**WALL**, **FLOOR**, **LADDER**, **WIRE**, **GEN**erator,
  **O2** diffuser, **PUMP**, **REFINE**ry, **FARM**), the **CANCEL** tool, and the
  **PRIO**rity toggle; click one to make it active.
- **Dig** — with **DIG** selected, **drag a rectangle** over solid tiles (or click
  a single tile) to mark them for mining; delvers dig inward from open space.
- **Build** — with a building selected, click a legal tile (or drag to paint a run)
  to place its blueprint; delvers haul material and construct it. A ghost **waits**
  if unaffordable — no partial refund.
- **Cancel / priority** — **CANCEL** clears a designation or ghost (click or drag);
  the **PRIO** toggle switches the "builds before digs" ordering.
- **Camera** — **drag with the middle or right mouse button** to pan (the left
  button paints), the **mouse wheel** to zoom, and the arrow keys / **WASD** (or
  nudging the pointer to a view edge) also pan.
- **Speed** — the status-bar **speed** control cycles **1× / 2× / 3×**; **1** / **2**
  / **3** also set it directly.
- **Pause in place** — the status-bar **❚❚** control, or **Space**, freezes ticks
  **without** a menu while the board stays interactive (keep placing and cancelling
  orders on the still field); press again to resume.
- `Esc` opens the pause **menu** (also freezes the field). **M** mutes.
- Every menu is fully operable with the mouse; `↑`/`↓` (or `W`/`S`) + `Enter` are
  keyboard alternatives.

The intended survival sequence is `dig ore → refine (a delver operates the
refinery — it is operated, not powered) → build generator + wire + diffuser →
power → oxygen`, plus a farm for food. Build orders wait if unaffordable and
there is no partial refund; dug ore is added to the stock.

## Develop, build, and run

```bash
npm ci            # install (requires the committed package-lock.json)
npm run dev       # Vite dev server
npm run build     # type-check + produce the static site into dist/
npm run preview   # serve the production build locally
```

`npm run build` (`tsc --noEmit && vite build`) emits a fully self-contained
static site into `dist/` with an `index.html` at its root. The bundler base is
relative (`base: "./"`), so `dist/` runs correctly when served from any base
path, including a per-run sub-path.

## Layout

- [`src/`](src/) — the game (see [`DESIGN.md`](DESIGN.md) §4 for the module
  map): `constants.ts` (stats/palette + every tuning number), `types.ts`,
  `world.ts` / `worldgen.ts` (the tile world + its generation), the
  `gas.ts` / `power.ts` / `pathfind.ts` / `jobs.ts` / `economy.ts` systems,
  `sim.ts` (the fixed-step `Game` spine — the world under gas + power, the delvers
  who pull jobs and tend their needs, the refine/build/food economy, the cycle
  clock, and the colony-lost check), `mode.ts` (the colony start), `menus.ts`,
  `rng.ts`, `assets.ts` / `audio.ts` / `particles.ts` (loading and playing the
  produced art, sound, and effects), `render.ts` (all drawing + HUD),
  `input.ts` + `main.ts` (input and the loop).
- [`assets/`](assets/) — the produced sprites, animation frames, particle
  systems, and audio (`delver/`, `tiles/`, `machines/`, `items/`, `icons/`,
  `fx/`, `audio/`).
- [`vendor/particle-runtime/`](vendor/) — a vendored, prebuilt copy of
  `@test-cabinet/particle-runtime`.
- [`scripts/`](scripts/) — `gen-sprites.sh`, `gen-animations.sh`,
  `gen-particles.sh`, and `gen-audio.sh` (produce the committed assets with the
  on-`PATH` asset tools; not run by the build).
