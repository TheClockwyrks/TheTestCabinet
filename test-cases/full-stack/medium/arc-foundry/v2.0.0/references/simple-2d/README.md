# Arc Foundry

An electro-industrial tower-defense game played in the browser on a derelict substation
yard. A runaway surge of conductive scrap, the Load, spills from a blown feeder vent and
crawls toward a grounding collector, and every unit that reaches the collector costs Grid
Integrity. You defend the yard by stamping salvaged components out of a scrap-press.

A component is never chosen. A stamped rock rolls a random type at a random quality the
instant it lands, and every rock is also a wall, so the yard the Load crawls through is a
maze built out of rolls you did not pick. Each level yields exactly one firing tower and
hardens the rest into inert blockers; power comes from folding matched rolls up a
five-rung quality ladder and into recipe-built combination towers.

This build runs on the **Simple 2D** engine, which owns the frame loop and its delta
time, the fit of the fixed 1280x720 stage onto the canvas, the keyboard and the pointer,
the audio bus, the asset loader, and the diagnostics overlay. Everything under `src/` is
the game itself. Every sprite, effect, and sound it plays is a file produced during the
build and committed under `assets/`.

## Running it

```sh
npm ci        # install the dependencies
npm run dev   # a development server, with hot reload
```

`npm run dev` prints the address to open. The whole game is one canvas; nothing else is
needed to play it.

## The production build

```sh
npm ci
npm run build
```

That type-checks the sources and writes the complete static site into `dist/`, with an
`index.html` at its root. The output is self-contained and every URL it requests is
relative, so it runs served from the root of a static host or mounted under a sub-path of
one. `npm run preview` serves the built output locally.

## The checks

| Command | Checks |
| --- | --- |
| `npm run typecheck` | The code type-checks. |
| `npm run lint` | The code is lint-clean. |
| `npm run format` | The code is formatted. |
| `npm test` | The unit tests pass, with coverage over `src/`. |

## Controls

Every screen and every control is fully operable with the pointer alone. The keys below
are accelerators.

| Key | Does |
| --- | --- |
| `B` | Pulls the press and arms a rock. |
| `K` | Harvests the selected candidate, which starts the wave. |
| `G` | Harvests it one quality tier lower. |
| `C` | Commits a combine from the current selection. |
| `U` | Raises the selected combination tower's level, or refines the press. |
| `T` | Cycles the selected structure's targeting priority. |
| `X` | Dismantles the selected structure. |
| `F` | Cycles the speed multiplier through 1x, 2x, 4x and 8x. |
| `Space` | Pauses in place, and resumes. |
| `V` | Opens and closes the recipe book. |
| `L` | Opens and closes the damage leaderboard. |
| `M` | Toggles audio mute. |
| `Shift` | Held across a press on a structure, adds it to the combine set. |
| `↑` `↓` `Enter` | Move and take a menu choice. |
| `Esc` | Backs out: a held rock, then the selection, then an overlay, then the pause menu. |
| `` ` `` | Shows and hides the engine's diagnostics overlay. |

Drop a rock by pressing on the yard while one is held, select a structure by pressing on
it, and clear the selection by pressing on empty yard.

## Layout

| Path | Holds |
| --- | --- |
| `src/` | The game: its state, its simulation, its drawing, and its debug surface. |
| `assets/` | Every produced sprite, animation frame, particle system, and sound. |
| `public/assets` | A link to `assets/`, so the built site serves every produced file under the asset root the engine resolves against. |
| `.tcab/packages/` | The prebuilt particle runtime the produced effects are played through. |

`src/main.ts` and `src/constants.ts` come with the project and are not edited: the first
builds the engine over the page canvas, and the second holds every figure the
specification fixes. Everything else is this build's.

| Module | Holds |
| --- | --- |
| `types.ts` | The state, field by field, as the simulation works in it. |
| `world.ts` | The one seam between the read-only state the engine hands out and the world a frame advances. |
| `tables.ts` | The live behaviour the figures in `constants.ts` add up to. |
| `theme.ts` | The palette, the type face, and the words drawn on screen. |
| `board.ts` | The tile grid, the pathing, and the never-seal rule. |
| `waves.ts` | What each wave releases, and when. |
| `sim.ts` | The simulation: functions over one world. |
| `layout.ts` | Where every control sits, shared by the drawing, the pointer, and the surface. |
| `render.ts` | The drawing, which only ever reads. |
| `particles.ts` | The produced effects, simulated and composited. |
| `assets.ts` `audio.ts` `input.ts` `diagnostics.ts` | What the game asks of the engine. |
| `debug.ts` | The debugging and automation surface. |
| `game.ts` | The three functions the engine drives. |

The simulation touches no canvas, no clock, and no input, which is what lets the unit
tests drive it in Node and what lets a driven scenario reproduce exactly. The renderer
reads the state and returns nothing, so the compiler is what says drawing changes
nothing.
