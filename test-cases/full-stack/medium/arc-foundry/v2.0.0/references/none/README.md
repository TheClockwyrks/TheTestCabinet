# Arc Foundry

An electro-industrial tower-defense game played in the browser on a derelict substation
yard. A runaway surge of conductive scrap, the Load, spills from a blown feeder vent and
crawls toward a grounding collector, and every unit that reaches the collector costs Grid
Integrity. You defend the yard by stamping salvaged components out of a scrap-press.

A component is never chosen. A stamped rock rolls a random type at a random quality the
instant it lands, and every rock is also a wall, so the yard the Load crawls through is a
maze built out of rolls you did not pick. Each level yields exactly one firing tower and
hardens the rest into inert blockers; power comes from folding matched rolls up a five-rung
quality ladder and into recipe-built combination towers.

The game runs entirely in the browser, on no engine and with no backend. Everything it
draws and plays is a file produced during the build and committed under `assets/`.

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

| Command             | Checks                                          |
| ------------------- | ----------------------------------------------- |
| `npm run typecheck` | The code type-checks.                           |
| `npm run lint`      | The code is lint-clean.                         |
| `npm run format`    | The code is formatted.                          |
| `npm test`          | The unit tests pass, with coverage over `src/`. |

## Controls

Every screen and every control is fully operable with the pointer alone, and every menu with
a touch contact alone. The keys below are accelerators.

| Key             | Does                                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| `B`             | Pulls the press and arms a rock.                                                  |
| `K`             | Harvests the selected candidate, which starts the wave.                           |
| `G`             | Harvests it one quality tier lower.                                               |
| `C`             | Commits a combine from the current selection.                                     |
| `U`             | Raises the selected combination tower's level, or refines the press.              |
| `T`             | Cycles the selected structure's targeting priority.                               |
| `X`             | Dismantles the selected structure.                                                |
| `F`             | Cycles the speed multiplier through 1x, 2x, 4x and 8x.                            |
| `Space`         | Pauses in place, and resumes.                                                     |
| `P`             | Opens the pause menu, and closes it and resumes.                                  |
| `V`             | Opens and closes the recipe book.                                                 |
| `L`             | Opens and closes the damage leaderboard.                                          |
| `M`             | Toggles audio mute.                                                               |
| `Shift`         | Held across a press on a structure, adds it to the combine set.                   |
| `↑` `↓` `Enter` | Move and take a menu choice.                                                      |
| `Esc`           | Backs out: a held rock, then the selection, then an overlay, then the pause menu. |
| `` ` ``         | Shows and hides the diagnostics overlay.                                          |

Drop a rock by pressing on the yard while one is held, select a structure by pressing on
it, and clear the selection by pressing on empty yard.

## Layout

| Path        | Holds                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| `src/`      | The runtime layer, the simulation, the renderer, and the debug surface. |
| `assets/`   | Every produced sprite, animation frame, particle system, and sound.     |
| `scripts/`  | The asset-generation scripts, and the showcase capture driver.          |
| `showcase/` | The store-page description and its captured media.                      |
| `vendor/`   | The prebuilt particle runtime the produced effects are played through.  |

`src/main.ts` is the entry point: it owns the frame loop, the canvas fit, input, audio,
asset loading, the diagnostics overlay, and the clock. `src/sim.ts` holds the whole game
state and advances it; it touches no DOM, which is what lets the unit tests drive it in
Node. `src/render.ts` reads that state and draws it, and never writes to it.

The scripts under `scripts/` are how the committed assets were produced. They are not part
of the build: `npm ci` and `npm run build` produce the site from the committed files alone,
with the asset tools absent and with no network access.
