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

| Key | Does |
| --- | --- |
| `↑` `↓` `←` `→` | Move the highlight on a menu; orbit the camera on the yard screens |
| `Enter` | Take the highlighted menu entry |
| `Esc` | Back out — see below |
| `M` | Mute and unmute all sound |
| `` ` `` | Show and hide the engine's diagnostics overlay |

### The yard camera (build, program and run screens)

| Input | Does |
| --- | --- |
| `←` `→` | Turn the camera around the yard |
| `↑` `↓` | Raise and lower the camera |
| `=` `-` | Zoom in and out |
| Drag | Orbit, at a quarter of a degree per pixel |

The camera orbits a fixed point above the anchors, and its pose carries across
the build, program and run screens. Opening a site returns it to its start pose.

### Building (build screen)

| Key | Tool |
| --- | --- |
| `1` | Strut — stiff, cheap, short: the crane's bones |
| `2` | Cable — very cheap and long, but pulls only; in compression it goes slack |
| `3` | Rail — a strut that doubles as the trolley's track |
| `4` | Ring — the slew ring the arm turns on. Every crane needs exactly one |
| `5` | Weight — a counterweight block hung on a node, to balance the arm |
| `6` | Delete — removes whatever is under the pointer |

| Key | Does |
| --- | --- |
| `Z` | Undo the last structure edit, back to when the site was opened |
| `C` | Static check: solve the crane where it stands and report every member's load |
| `P` | Go to the tape editor |
| `G` | Run the tape |
| `Esc` | Drop a held node, or leave for the site select |

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

| Key | Does |
| --- | --- |
| `S` | Cycle the watch speed: ×1, ×2, ×4 |
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

## How the code is laid out

The game is written inside the **Structured 3D** engine's framework, which is
documented in `engine/` at the root of this repository. The engine owns the
frame loop, rendering and the camera, the canvas fit, collision detection, the
input actions and the pointer, audio, asset loading, and the debug overlay;
Gantry owns the game instance, the one level it runs in, that level's game mode
and game state, and the actors, components and controllers that draw the state
and drive it.

| Path | What lives there |
| --- | --- |
| `src/main.ts` | The entry point `index.html` loads: stands the engine up over the canvas and binds `game` to it |
| `src/game.ts` | `GantryState` and `GantryDebugApi` as the specification declares them, and the definition the engine is bound to: the game instance, the level, the game mode, and the player controller |
| `src/state.ts` | Every operation over the live state, written in place |
| `src/sim/` | The simulation core: the truss solve, the axis controller, the pendulum, collisions, breakage, and the tick pipeline. It renders nothing and reads no input |
| `src/adapt.ts` | The seam between the `{x, y, z}` shapes the state declares and the `[x, y, z]` triples the simulation works in |
| `src/app-tick.ts` | What a frame does: the controller's half (input) and the mode's half (the fixed tick and the cues it raises) |
| `src/editor.ts` | Pointer picking on the lattice and the six build tools |
| `src/screens.ts`, `src/tape.ts` | The seven screens, the navigation, and the tape editor's widgets |
| `src/menus.ts` | Where the menu entries are laid out, and what a pointer or a contact lands on |
| `src/scene.ts` | Which actors the world holds, and the one call a frame that hands each of them the state |
| `src/yard/` | The world pass: the ground, sky and light, the site's fixtures and the build aids, the crane's own geometry, and the produced models |
| `src/hud/` | The screen pass: every screen's readouts, as text, shapes and direct drawing on the screen layer |
| `src/posture.ts`, `src/view.ts`, `src/format.ts`, `src/palette.ts` | Where everything stands, where the camera is, what the readouts say, and what it all looks like |
| `src/io.ts` | The narrow seam the game's systems reach the engine's cue bus and mute bit through |
| `src/assets.ts` | The eight produced models, loaded once through the engine's loader |
| `src/debug.ts` | The automation surface the engine hands back as `engine.debug` |
| `src/constants.ts` | Every figure the game is specified in terms of |
| `assets/` | The produced models (`.glb`) and sounds (`.wav`), committed |
| `scripts/` | What produced them. Nothing here runs at build time |

The simulation is deterministic and has no randomness anywhere: the same crane
and the same tape produce the same run, tick for tick, at any watch speed and
any frame rate.

## Driving it from code

The game instance's `initialize` returns the automation surface, and the engine
hands it back as `engine.debug`. It can pose a site and read it back without a
real pointer: `openSite`, `addMember`, `setRing`, `addMoveStep` and friends
build a crane and a tape under the same rules a player builds under, `startRun`
starts the run the `G` key starts, and `snapshot()` reads the whole game back.
The clock, the keyboard, the pointer, the camera's projection and the overlay
are the engine's, so the surface carries no operation for any of them —
`engine.advance` is what steps a check's frames.
