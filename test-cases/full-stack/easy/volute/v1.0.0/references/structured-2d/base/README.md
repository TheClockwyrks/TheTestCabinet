# Volute

A geothermal pump hall, in the browser. Mineral cores precipitate at the inlet
and ride a fixed channel toward the intake as one slow, unbroken train. You work
the injector the channel winds around: fire cores into the train, gather three or
more of a charge together, and pull them out before the train reaches the intake.

Five levels, three cells, four kinds of machinery, and a score that climbs
fastest when one extraction sets off the next.

Volute is built on the **Structured 2D** engine, and every sprite, sheet,
particle system, and sound it plays was produced for it and is committed under
`public/assets/`. It runs entirely in the browser, with no backend and no
credentials.

## Install and run

```sh
npm ci          # install exactly what the lockfile names
npm run dev     # serve the game with hot reload
```

`npm run dev` prints a local URL. Open it and press **Enter**.

## The production build

```sh
npm run build   # type-check, then emit the static site into dist/
npm run preview # serve dist/ for a final look
```

`dist/` is a self-contained static site with `index.html` at its root. Every URL
it requests is page-relative, so it runs from the root of a static host and from
any sub-path of one alike. The build bundles the committed asset files and
invokes no asset tool.

## Controls

| Control              | Does                                           |
| -------------------- | ---------------------------------------------- |
| Mouse                | Aims the injector at the pointer               |
| `←` / `→`            | Swings the aim counter-clockwise and clockwise |
| `Space` / left click | Fires the loaded core                          |
| `X`                  | Exchanges the loaded and queued cores          |
| `Enter`              | Starts a run, and dismisses an ending          |
| `Esc`                | Pauses, and resumes                            |
| `M`                  | Toggles the audio mute                         |
| `` ` ``              | Toggles the engine's debug overlay             |

## How it is put together

The engine owns the frame loop and its delta time, rendering, the canvas fit,
input actions, the audio bus, asset loading, and the debug overlay. Volute is
written inside its framework.

| Module                                      | Holds                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/main.ts`                               | The fixed entry point: it stands the engine up over the page's canvas.       |
| `src/constants.ts`                          | Every figure the specification fixes.                                        |
| `src/game.ts`                               | The game definition, and the instance that outlives a level transition.      |
| `src/levels.ts`                             | The two levels — the title, and the hall a run plays in.                     |
| `src/hall-mode.ts`                          | The rules: the order a tick resolves in, the machinery, the screens.         |
| `src/train.ts`                              | The train on the channel: advance, merge, insertion, extraction, recoil.     |
| `src/level.ts`                              | Opening a level, the inlet's emissions, the marks, and every charge draw.    |
| `src/actors.ts`                             | The hall's bodies: the cores, the cores in flight, the injector, the intake. |
| `src/controller.ts`                         | The one player controller, and the whole of the input.                       |
| `src/scenery.ts`, `src/hud.ts`, `src/fx.ts` | The channel plate, the HUD and the screens, and the effects.                 |
| `src/assets.ts`, `src/audio.ts`             | The produced files, and the cue bus they play through.                       |
| `src/debug.ts`                              | The debug and automation surface `engine.debug` hands back.                  |

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run --coverage
```

The tests run in process, with no browser: each stands a real engine up over an
`@napi-rs/canvas` canvas and a `ConstantClock` of one sixtieth of a second, poses
a hall through the debug surface, steps it an exact number of frames with
`engine.advance`, and reads the result back off the world, the surface, and the
pixels the pipeline drew.
