# Volute

A geothermal pump hall, deep and hot. Mineral cores precipitate at the inlet and
ride a fixed winding channel toward the intake as one slow, unbroken train. You
work the injector the channel winds around: fire cores into the train, gather
three or more of a charge together, and pull them out of the channel before the
train reaches the intake and the hall spends one of your cells.

Volute runs entirely in the browser, on no engine and with no backend. Its
sprites, sprite sheets, particle systems and sounds are all produced files,
committed under `assets/` and bundled into the build.

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

| Action                           | Keyboard           | Mouse            |
| -------------------------------- | ------------------ | ---------------- |
| Aim                              | `←` `→`            | move the pointer |
| Fire                             | `Space`            | left button      |
| Swap the loaded and queued cores | `X`                | right button     |
| Start a run, dismiss an ending   | `Enter` or `Space` | left button      |
| Pause and resume                 | `Esc` or `P`       | —                |
| Mute and unmute                  | `M`                | —                |
| Show and hide the debug overlay  | `` ` ``            | —                |

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
the produced files under `assets/` are build inputs.

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run --coverage
```

The tests run in process, in Node, with no browser: the simulation advances from
ticks and input alone, so a test builds a hall, steps it a counted number of
ticks, and reads the result. `@napi-rs/canvas` supplies a real 2D context for the
tests that check what the hall actually draws.

## Layout

| Path                              | What it holds                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                     | The entry point: loads the assets, stands the runtime up, publishes the debug surface, starts the loop. |
| `src/runtime.ts`                  | The frame loop, the fixed-tick accumulator, the canvas fit, and the wiring under the game.              |
| `src/sim.ts`                      | One tick of the simulation, in the order the rules resolve in.                                          |
| `src/train.ts`                    | The train: segments, advance, merging, insertion, extraction, recoil.                                   |
| `src/state.ts`                    | Building the state, opening a level, and every charge draw.                                             |
| `src/channel.ts`                  | The channel's geometry: an arc position to a point on the field.                                        |
| `src/render.ts`, `src/hud.ts`     | The hall, the HUD, and the seven screens.                                                               |
| `src/fx.ts`                       | The produced sheets and particle systems, played over the finished frame.                               |
| `src/audio.ts`                    | The fifteen produced cues and the two looping beds.                                                     |
| `src/input.ts`, `src/viewport.ts` | The keyboard and pointer, and the letterboxed field fit.                                                |
| `src/debug.ts`, `src/overlay.ts`  | The `window.__volute` surface and the read-only overlay.                                                |
| `assets/`                         | The produced sprites, sheets, particle systems and sounds.                                              |

## Driving it from code

The build publishes `window.__volute` as soon as it has initialized: a small
debugging and automation surface that takes the hall off real time
(`setAutoStep(false)`, `step(n)`), arranges a scenario (`startLevel`,
`poseTrain`, `fire`, `setPressure`, `grantMachinery`, …) and reads the whole game
back (`snapshot()`). Every operation is a read or a pose — the outcomes come from
the ticks that follow, exactly as they do in play — so the same seed and the same
calls reach the same state every time.

```js
const v = window.__volute;
v.setAutoStep(false);
v.reset({ seed: 1 });
v.start();
v.step(120);
console.log(v.snapshot().train.length);
```

The backtick key opens a read-only overlay on the same ground truth.
