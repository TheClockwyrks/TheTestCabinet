# Fathom — `none` reference implementation

The authored, **correct** reference build of the Fathom end-to-end test case's
`base` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/` remain authoritative for the
design.

The project is the case's seeded workspace (`../../workspaces/none/`) — ten
configuration files, `index.html`, and the seven sprite sheets under `assets/` —
with the whole of `src/` written: the runtime the game stands on, the game, and
the tests for both. What is here is exactly what a run on no engine is asked to
produce.

---

**Fathom** is a bioluminescent deep-sea maze chase for the browser. You are a
small glowing forager threading the flooded corridors of a pitch-dark trench,
grazing plankton while three kinds of predator hunt you. The maze is unseen
until your own light or a sonar pulse touches it, so a dive is as much about
sensing where the danger is as about outswimming it.

Fathom's defining idea is **hunting in the dark**. Light travels straight — your
glow shows only what is in direct line of sight, never around a corner — while
sound bends: a sonar pulse floods the open corridors and finds what is beyond
the bend, at the cost of being heard. Each predator hunts a different signal you
give off.

- **The Lanternjaw** hunts your **light**, in a straight line, out to a range
  that grows as you brighten. It carries an amber bulb that shows at any
  distance, and while it wanders it wears a jellyfish disguise drawn from the
  very frames the harmless bonus drifter uses — so an amber glimmer in the dark
  is a gamble. Go dim, break its line, or ink it.
- **The Gloamfin** is eyeless and hunts your **sound**. It sweeps the corridors
  with sonar of its own, hears your pulse when its front arrives, and hears you
  outright at close range. It is the only hunter faster than you, and ink is no
  use against it — corner it and it loses its edge.
- **The Flarefish** shows nothing of itself between **flares**. It hunts light
  exactly as the Lanternjaw does, and every so often it charges and blooms: a
  wide disc that lights the trench straight through rock and locks on to anyone
  inside it. The charge-up is your warning.

Graze every plankton in a maze to clear it and descend. Deeper mazes hold more
hunters and shorten your sonar's reach. Contact costs a life.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle.

The look is this build's own. The specs fix what must be visible — flat darkness
over what has never been touched, rock told from water, a cool glow around the
forager, three distinguishable hunters, two amber lights that cannot be told
apart, a travelling wavefront in three tints — and leave the palette, the type,
and the layout to the build. This build chose cold light on near-black: a teal
forager, amber hunters and drifters, violet pings, and a system monospace face.
Those choices live in `src/theme.ts`, apart from the figures the specs fix in
`src/constants.ts`.

## Controls

Every control is a **named action** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout.

| Action                     | Keys                     | Does                                                  |
| -------------------------- | ------------------------ | ----------------------------------------------------- |
| `up` `down` `left` `right` | Arrow keys, or `W A S D` | Sets the forager's direction. Moves a menu selection. |
| `a`                        | `Space`                  | Emits a sonar pulse.                                  |
| `b`                        | `Shift`                  | Releases an ink cloud.                                |
| `confirm`                  | `Enter` or `Space`       | Accepts the highlighted menu item.                    |
| `back`                     | `Esc`                    | Leaves the current screen.                            |
| `pause`                    | `Esc` or `P`             | Pauses live play.                                     |
| `mute`                     | `M`                      | Toggles the game's sound, on any screen.              |

The four movement actions are read as **held** values, so the forager travels
while one is down and comes to rest when none is. Every other action is read
once per press. Each screen reads only the actions that belong to it, so `Space`
does one thing on a menu and another in the water.

The backtick key (`` ` ``) shows and hides the read-only diagnostics overlay.

## The runtime this project carries

Fathom stands on no engine, so the layer every browser game needs is part of the
build. It lives in six modules and is deliberately sized for this game.

| Module             | What it owns                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `src/runtime.ts`   | The fixed-timestep frame loop, the canvas fit, and the wiring of the five modules below.      |
| `src/viewport.ts`  | The letterboxed, device-pixel-ratio-aware fit of the fixed 1280 x 720 stage onto the canvas.  |
| `src/keyboard.ts`  | Named actions over physical keys: held values and one-press edges.                            |
| `src/audio-bus.ts` | Named cues synthesized with the Web Audio API, muting, and the first-gesture unlock.          |
| `src/images.ts`    | Loading the sprite sheets, with page-relative URLs so the build runs under any sub-path.      |
| `src/overlay.ts`   | The diagnostics panel: registered sources, drawn over the finished frame, toggled by `` ` ``. |

The contract between the runtime and the game is three functions —
`initialize`, `tick`, `render` — over one state value. The simulation runs at a
fixed **120 ticks a second**: the loop measures the wall clock, runs the whole
ticks that elapsed time completes, carries the remainder, and hands the renderer
that remainder so a moving body is drawn between the two ticks either side of
the current instant.

## Debugging and automation

The build installs `window.__fathom` as soon as the game has initialized
(`src/debug.ts`). Every operation is a read or a **pose** of the state, and each
pose sets **one thing**: a caller that wants several things arranged makes
several calls and gets nothing it did not ask for. What a pose sets, the game's
own systems carry on from — the real sensing, the real pathfinding, the real
release schedule and the real contact rules produce everything that follows.

```js
const f = window.__fathom;
f.setAutoStep(false); // take the game off the wall clock
f.reset(); // title screen, a fresh maze
f.setScreen("playing"); // straight into live play
f.clearPredators(); // an empty trench to build the scenario in
f.setForagerTile(17, 15); // pose the forager
f.setBrightness(1); // pose the brightness
f.setBrightHold(1); // and hold it steady for a second
f.addPredator("lanternjaw", 17, 11); // one hunter, loose and patrolling
f.setPredatorState(0, "chase"); // pose it onto you
f.advance(120); // run one second of game time
f.snapshot(); // read the whole observable state
```

The clock is the one thing the surface reaches past the state for: nothing
outside this build owns it. There is no key operation — the runtime's registered
actions are driven by dispatching real keyboard events at the page — and no
overlay operation, because the runtime draws the panel and owns the backtick
key.

## Requirements

Node.js 20 or newer, with npm.

## Install

```sh
npm ci
```

`npm ci` installs exactly what `package-lock.json` pins. Use `npm install` only
when you mean to change a dependency.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot module replacement and prints the local URL. The
sprite sheets under `assets/` are served straight from the project.

## Production build

```sh
npm run build
```

Type-checks the project and writes the complete static site to `dist/`, with an
`index.html` at its root. Every URL the built site requests is relative to the
page, so the directory runs as-is from a static file server both at the server
root and under a sub-path of it.

```sh
npm run preview
```

serves that `dist/` directory for a final look.

## Checks

Four commands run over the repository as it stands.

| Command             | Checks                                          |
| ------------------- | ----------------------------------------------- |
| `npm run typecheck` | The code type-checks (`tsc --noEmit`).          |
| `npm run lint`      | The code is lint-clean (`eslint .`).            |
| `npm run format`    | The code is formatted (`prettier --check .`).   |
| `npm test`          | The unit tests pass, with coverage over `src/`. |

The tests run in process, in Node, with no browser: the game is driven tick by
tick through the same three functions the runtime calls, and `@napi-rs/canvas`
gives the renderer a real 2D context to draw through.

## Project layout

```
index.html          the page and the canvas the stage is fitted into
assets/             the seven sprite sheets, one folder of PNGs each
src/
  main.ts           the entry point: load the art, stand the runtime up, start
  runtime.ts        the fixed-timestep loop and the canvas fit
  viewport.ts       fitting the logical stage onto the canvas
  keyboard.ts       named actions over physical keys
  audio-bus.ts      synthesized cues, muting, the autoplay unlock
  images.ts         loading the sprite sheets
  overlay.ts        the diagnostics panel
  assets.ts         the seven sheets and their frame layouts
  audio.ts          the seven cues the game plays
  constants.ts      every figure the specification fixes
  theme.ts          this build's palette, type, and layout choices
  types.ts          the vocabulary the snapshot reports
  rng.ts            the source every random draw is taken through
  maze.ts           the layout, the tile queries, the flood, the routing
  sensing.ts        the fog of war and the forager's light
  sonar.ts          a wavefront travelling out through the corridors
  entities.ts       the bodies and the tile-locked stepping they share
  predators.ts      the den schedule and each hunter's own mind
  ink.ts            the ink clouds and what they blind
  effects.ts        the detection-alert bursts
  game.ts           the state, one tick over it, and the seven screens
  readings.ts       the quantities derived from that state
  render.ts         every canvas draw
  snapshot.ts       the observable state, as the debug surface reports it
  diagnostics.ts    the values the overlay shows
  debug.ts          window.__fathom
  *.test.ts         the tests, beside the module each one covers
```
