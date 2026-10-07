# Volute

A geothermal pump hall, deep and hot. Mineral cores precipitate at the inlet and
ride a fixed winding channel toward the intake as one slow, unbroken train. You
work the injector the channel winds around: fire cores into the train, gather
three or more of a charge together, and pull them out of the channel before the
train reaches the intake and the hall spends one of your cells.

Volute is built on the **Simple 2D** engine and runs entirely in the browser,
with no backend. Its sprites, sprite sheets, particle systems and sounds are all
produced files, committed under `public/assets/` and bundled into the build.

## How it plays

- The **channel** is a twelve-vertex polyline `5000` units long. A core's
  position on it is one number: its arc distance from the inlet.
- The **train** rides the channel in segments. The lead segment moves at the
  level's feed speed; a segment that has fallen behind closes at `180` units a
  second and clamps one spacing behind the one ahead, joining it.
- The **injector** stands at the middle of the hall and never moves. It holds one
  loaded core and one queued core, and it fires along its aim.
- A fired core **seats** into the train where it strikes, ahead of or behind the
  core it hit, and everything behind that point shifts back to make room.
- Three or more of a charge in a row are **extracted**: they leave the channel,
  the train behind them recoils and holds, and the removal pays `10` a core.
  The extraction a merge causes scores at the next **chain step**, so a run that
  sets off a second run pays double, a third triple, and so on.
- **Pressure** builds while the channel is crowded and multiplies the feed speed,
  so a hall you let fill up runs faster and faster.
- Every twelfth core carries a **machinery mark** — `choke`, `backflow`, `bore`,
  `sightline`, cycling — and drawing that core out grants it.
- Five levels, each with its own charges, quota and feed speed. Three cells. A
  core that reaches the intake spends one; the third ends the run.

## Controls

| Action                           | Keyboard           | Mouse             |
| -------------------------------- | ------------------ | ----------------- |
| Aim                              | `←` `→`            | move the pointer  |
| Fire                             | `Space`            | press the pointer |
| Swap the loaded and queued cores | `X`                | —                 |
| Start a run, dismiss an ending   | `Enter` or `Space` | press the pointer |
| Pause and resume                 | `Esc` or `P`       | —                 |
| Mute and unmute                  | `M`                | —                 |
| Show and hide the debug overlay  | `` ` ``            | —                 |

## Running it

The project is a Node project: TypeScript, built with Vite, tested with Vitest,
linted with ESLint, formatted with Prettier.

```sh
npm ci          # install exactly what the lockfile pins
npm run dev     # serve the game with hot reload
```

`npm run dev` prints a local URL; open it and press `Enter`.

## Building the static site

```sh
npm run build     # type-check, then emit the static site into dist/
npm run preview   # serve dist/ for a final check
```

`dist/` is completely self-contained and every URL it requests is page-relative,
so it runs from the root of any static host and from any sub-path of one alike.
Nothing is fetched from outside `dist/`, and no asset tool runs at build time —
the produced files under `public/assets/` are build inputs the build copies
across unchanged.

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run --coverage
```

The tests run in process, in Node, with no browser: each stands the engine up
over an `@napi-rs/canvas` canvas and a `ConstantClock` of one simulation tick,
poses a hall through the debug surface, advances a counted number of frames with
`engine.advance`, and reads the result back off the game's own state and off the
pixels it drew.

## Layout

| Path                                 | What it holds                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/main.ts`                        | The fixed entry point: creates the engine over the page's canvas and runs it.            |
| `src/game.ts`                        | `VoluteState`, `VoluteDebugApi`, `BACKGROUND`, and the three functions the engine calls. |
| `src/draft.ts`                       | The working copy a frame builds the next state in.                                       |
| `src/sim.ts`                         | The controls an update reads, and one tick in the order the rules resolve in.            |
| `src/train.ts`                       | The train: advance, merging, insertion, extraction, recoil.                              |
| `src/level.ts`                       | Building the state, opening a level, the mark cadence, and every charge draw.            |
| `src/channel.ts`                     | The channel's geometry: an arc position to a point on the field.                         |
| `src/render.ts`, `src/hud.ts`        | The hall, the HUD, and the seven screens.                                                |
| `src/fx.ts`                          | The produced sheets and particle systems, played over the finished frame.                |
| `src/assets.ts`, `src/audio.ts`      | Loading the produced files, and the fifteen cues.                                        |
| `src/debug.ts`, `src/diagnostics.ts` | The debug surface, and the values the engine's overlay carries.                          |
| `public/assets/`                     | The produced sprites, sheets, particle systems and sounds.                               |

## Driving it from code

`initialize` returns the debug surface beside the state, so the engine hands it
back from `engine.debug`. It takes the hall off real time, arranges a scenario,
and reads the whole game back. Every operation is a reading or a pose, written in
the shape of `update`: a pose takes the current state and returns the next, so a
caller applies it through `engine.apply`; a reading takes the state and returns
what it read.

```ts
import { createEngine, ConstantClock } from "@clockwyrks/simple-2d";
import { BACKGROUND, game } from "./src/game";
import { CELLS, FIELD_H, FIELD_W, LAYOUT, TICK_DT } from "./src/constants";

const engine = createEngine({
  canvas,
  width: FIELD_W,
  height: FIELD_H,
  game,
  background: BACKGROUND,
  layout: LAYOUT,
  clock: new ConstantClock(TICK_DT * 1000),
});
await engine.initialize();

const debug = engine.debug;
engine.apply((s) => debug.reset(s));
engine.apply((s) => debug.setScore(s, 0));
engine.apply((s) => debug.setCells(s, CELLS));
engine.apply((s) => debug.startLevel(s, 1));
await engine.advance(120);
console.log(debug.snapshot(engine.state).train.length);
```

A pose arranges the hall and decides nothing: every insertion, extraction, score,
chain step, mark, cell, clear and ending comes from the ticks run after it. Where
the game would draw at random, a scenario poses the outcome instead: `poseTrain`
the cores on the channel, `setLoaded` and `setQueued` the injector's charges, and
`setNextEmitted` the charge of the next core the inlet emits.

The backtick key opens the engine's read-only overlay on the same ground truth.
