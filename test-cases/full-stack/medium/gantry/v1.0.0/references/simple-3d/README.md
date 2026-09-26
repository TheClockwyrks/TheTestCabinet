# Gantry

**RIG THE CRANE. RUN THE TAPE.**

Gantry is a crane-building puzzle played in a 3D construction yard, in the
browser, with no backend and no install beyond a static file server.

Each of the six sites gives you anchor points on the ground, a build envelope,
a budget, and one or two loads that have to end up on their pads. You build a
crane out of struts, cables and rails on a two-unit lattice, mount a slew ring
for the arm to turn on and a run of rail for the trolley, then write an
**instruction tape** — an ordered program that drives the crane's four axes:
slewing the arm, driving the trolley out along the rail, paying the hoist cable
in and out, and turning the grip that holds the load.

Then you press `G` and watch.

The tape plays out under a real structural simulation. Every member carries a
computed axial force, sixty times a second: the truss is solved by direct
stiffness at the geometry of that tick, cables carry tension only and go slack
in compression, long struts buckle sooner than short ones, and the arm's
reactions cross the slew ring corner by corner onto the tower. A member past
its capacity breaks and is gone for the rest of the run. The load hangs on a
real pendulum, so slewing hard makes it swing, and a swinging load can miss its
pad, hit an obstacle, or snap the cable.

A site is cleared when every load has been set down inside tolerance. Your score
is the crane's **cost** and the run's **time**, so a cheap crane driven briskly
beats an overbuilt one driven timidly — but driving briskly loads the structure
harder and swings the load wider. Speed is bought with steel.

The game runs entirely in the browser. Everything it needs is in the bundle:
nothing is fetched from outside `dist/`, and no API key or credential is needed
to build, run, or play.

## Install

Node 20 or newer.

```sh
npm ci
```

## Run it in development

```sh
npm run dev
```

Vite serves the game with hot reload and prints the URL (`--host` is on, so it
is reachable from another machine on the network too).

## Production build

```sh
npm run build
```

This type-checks and then emits the complete static site into `dist/`, with
`index.html` at its root. Every asset reference is page-relative, so `dist/`
runs as-is at the root of any static host **and** from a sub-path. To check the
built output before shipping it:

```sh
npm run preview      # serves dist/ on http://localhost:4173
```

## Controls

The pointer operates the yard and the tape editor; the keyboard drives
everything else. Bindings are `KeyboardEvent.code` values, so they are physical
keys and do not move with the layout.

### Everywhere

| Key             | Does                                                               |
| --------------- | ------------------------------------------------------------------ |
| `↑` `↓` `←` `→` | Move the highlight on a menu; orbit the camera on the yard screens |
| `Enter`         | Take the highlighted menu entry                                    |
| `Esc`           | Back out — see below                                               |
| `M`             | Mute and unmute all sound                                          |
| `` ` ``         | Show and hide the diagnostics overlay                              |

### The yard camera (build, program and run screens)

| Input   | Does                                      |
| ------- | ----------------------------------------- |
| `←` `→` | Turn the camera around the yard           |
| `↑` `↓` | Raise and lower the camera                |
| `=` `-` | Zoom in and out                           |
| Drag    | Orbit, at a quarter of a degree per pixel |

The camera orbits a fixed point above the anchors, and its pose carries across
the build, program and run screens. Opening a site returns it to its start pose.

### Building (build screen)

| Key | Tool                                                                      |
| --- | ------------------------------------------------------------------------- |
| `1` | Strut — stiff, cheap, short: the crane's bones                            |
| `2` | Cable — very cheap and long, but pulls only; in compression it goes slack |
| `3` | Rail — a strut that doubles as the trolley's track                        |
| `4` | Ring — the slew ring the arm turns on. Every crane needs exactly one      |
| `5` | Weight — a counterweight block hung on a node, to balance the arm         |
| `6` | Delete — removes whatever is under the pointer                            |

| Key   | Does                                                                         |
| ----- | ---------------------------------------------------------------------------- |
| `Z`   | Undo the last structure edit, back to when the site was opened               |
| `C`   | Static check: solve the crane where it stands and report every member's load |
| `P`   | Go to the tape editor                                                        |
| `G`   | Run the tape                                                                 |
| `Esc` | Drop a held node, or leave for the site select                               |

With a strut, cable or rail selected, the **first click holds a lattice node**
and the second click on another node places the member between them. Clicking
the held node again drops it, and so does `Esc`. A click the rules refuse leaves
the held node where it is — a slip does not cost you the selection — and says
why along the bottom of the screen. The line under the pointer always names what
a click would do before you make it.

Ring, weight and delete are single clicks and ignore a held node.

The crane's cost is shown against the site's budget at all times, and an edit
that would take you past the budget is refused, as is one that leaves the
envelope, doubles an existing member, reaches inside an obstacle, lays a rail
off the horizontal, or joins the arm to the tower anywhere but through the ring.

### Programming (program screen)

The tape editor is worked entirely with the pointer. Each step is a row:

- **`+ MOVE SLEW / TROLLEY / HOIST / GRIP`** appends a move driving that axis.
- **`+ ATTACH`** and **`+ RELEASE`** append the two actions: taking a load onto
  the hook, and setting it down.
- On a move row, `+S` `+T` `+H` `+G` add a second, third or fourth axis to that
  move, so the step drives them together and ends when all of them have arrived.
- On a command row, `«` `‹` `›` `»` nudge the target coarse and fine both ways,
  `−` `+` change the rate, and `×` removes that command.
- `▲` `▼` reorder a step, `×` removes it, and `CLEAR TAPE` empties the whole
  thing.

`B` returns to the build screen and `G` runs the tape.

### Watching a run (run screen)

| Key   | Does                                          |
| ----- | --------------------------------------------- |
| `S`   | Cycle the watch speed: ×1, ×2, ×4             |
| `Esc` | Abort the run and go back to the build screen |

You steer nothing during a run — the tape does. You turn the camera and watch.
Members are coloured by how hard they are working, on a ramp from slack to their
limit; one at breaking point goes white and pulses, and a broken member goes
charred and translucent. The legend is on screen.

If a run fails, the screen stays where it stood with the cause read out, so you
can see what went wrong before going back to edit.

## The four checks

```sh
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm run format       # prettier --check .
npm test             # vitest run --coverage
```

## The engine, and what this build owns

Gantry stands on the **Simple 3D** engine (`@clockwyrks/simple-3d`), which is
already a dependency and carries its own documentation in the package's `docs/`
directory. The engine owns the
frame loop and the delta time each frame is given, fitting the fixed 1280×720
logical stage into the canvas, the renderer with the retained `THREE.Scene` and
the camera it draws through, the 2D screen layer composited over that picture,
the keyboard actions and the pointer, the audio graph, loading and decoding the
produced files under one asset root, and the diagnostics overlay.

The game is three functions and two types, in `src/game.ts`. `initialize`
registers the actions, the cues, and the diagnostic sources, awaits the produced
assets, and returns the opening state beside the debug surface. `update` takes
the current state as a `DeepReadonly<GantryState>` and **returns the next one**,
so a frame builds a new state rather than writing into the one it was handed.
`render` is given that next state, read-only again, poses the scene and the
camera, and paints the readouts. Nothing but `update` and the debug surface's
poses ever advances the game.

## How the code is laid out

| Path                                 | What lives there                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                        | The entry point `index.html` loads: it stands the engine up over the canvas and runs it                                                                     |
| `src/game.ts`                        | `GantryState`, `GantryDebugApi`, and the three functions the engine calls                                                                                   |
| `src/state.ts`                       | The pure transitions over the state, and the facts read off it                                                                                              |
| `src/sim/`                           | The simulation core: the truss solve, the axis controller, the pendulum, collisions, breakage, and the tick pipeline. It renders nothing and reads no input |
| `src/app-tick.ts`                    | One frame's update: the pointer acts, the actions, the camera, the fixed-tick accumulator, and the cues a tick raises                                       |
| `src/convert.ts`                     | The one place the state's records and the simulation's meet, both ways                                                                                      |
| `src/pick.ts`, `src/project.ts`      | What a click at the pointer would take, through the camera the yard is drawn with                                                                           |
| `src/edits.ts`, `src/editor.ts`      | The structure editor's rules, and the six build tools over a pick                                                                                           |
| `src/screens.ts`, `src/tape.ts`      | The seven screens and their navigation, and the tape editor's widgets                                                                                       |
| `src/menus.ts`                       | Where the menu entries are laid out, and what a pointer or a contact lands on                                                                               |
| `src/render*.ts`                     | The yard in the engine's scene, the readouts on its screen layer, and the look both share                                                                   |
| `src/assets.ts`                      | The produced models and sounds, loaded through the engine's own loader                                                                                      |
| `src/debug.ts`, `src/diagnostics.ts` | The debug surface, and the values the overlay shows                                                                                                         |
| `src/constants.ts`                   | Every figure the game is specified in terms of                                                                                                              |
| `assets/`                            | The produced models (`.glb`) and sounds (`.wav`), committed                                                                                                 |
| `scripts/`                           | What produced them. Nothing here runs at build time                                                                                                         |

The simulation advances on its fixed tick, apart from the canvas and the wall
clock: a run is the ticks the tape drives, at any watch speed and any frame
rate.

## Driving it from code

The game hands the engine a debug surface beside its opening state, so a caller
holds it as `engine.debug` once `engine.initialize()` has resolved. Every
operation takes the current state as its first argument: a **pose** returns the
next state, which is applied with `engine.apply`, and a **reading** returns what
it read.

```ts
const engine = createEngine({ canvas, width: 1280, height: 720, game, ... });
await engine.initialize();
const d = engine.debug;

engine.apply((s) => d.openSite(s, 0));
engine.apply((s) => d.setScreen(s, "build"));
engine.apply((s) => d.setRing(s, 0, 2, 0));
engine.apply((s) => d.addMember(s, 2, 4, 0, 4, 4, 0, "rail"));
engine.apply((s) => d.addMoveStep(s, "trolley", 10, 3.5));
engine.apply((s) => d.startRun(s));

await engine.advance(600);          // 600 frames off the engine's clock
d.snapshot(engine.state).run.phase; // "running" | "cleared" | "failed" | "idle"
```

The clock, the input, and the projection are the engine's, so the surface
carries no operation for any of them: frames come from `engine.advance`, a
control is driven by dispatching a real event at the engine's surface, and a
world point is projected with `engine.view().project`.
