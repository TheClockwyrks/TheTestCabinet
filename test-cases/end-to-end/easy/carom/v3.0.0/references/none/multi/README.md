# Carom (Multi-ball) — `none` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`multi` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/`, rendered for the `multi` variant,
remain authoritative for the design.

The project is the case's seeded workspace (`../../workspaces/none/`) — ten
configuration files and nothing else, shared by every variant — with the whole of
`src/` written: the runtime the game stands on, the game, and the tests for both.
What is here is exactly what a `multi` run on no engine is asked to produce.

## What multi changes

**Three balls** are in play at once, and they share nothing. Each carries its own
velocity, its own spin, its own hold timer, and its own trail, and each launches
from its own home point on the centerline at a fresh **uniformly random angle**
over the whole circle — so there is no serve-direction rule to speak of. When one
ball crosses a goal edge it scores, returns to its own home, and relaunches on its
own hold while the other two carry on; the field is never frozen for a respawn.

The balls also collide **with each other**, as elastic circles of equal mass
(`resolveBallPairs` in `src/physics.ts`), and a ball waiting out its hold is an
immovable solid body rather than a ghost. The three advance in lock step through
the collision sub-steps, so a closing pair is resolved at the sub-step it meets.
In Solo the AI defends one ball at a time: of those flying at its goal, the one
arriving soonest (`threatBall` in `src/game.ts`).

---

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; three balls ricochet between them, off the top and
bottom walls, off a pair of fixed mid-field obstacles, and off each other. A
player scores when a ball passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes a ball curves that ball's flight afterward, so skilled play is about
shaping a ball's path, not just blocking it. The two fixed obstacles turn the open
field into a bank-shot puzzle, and three balls at once turn it into a triage
problem.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

## Controls

Every control is a **named action** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout:

| Action              | Keys               | Does                                                                    |
| ------------------- | ------------------ | ----------------------------------------------------------------------- |
| `p1-up` / `p1-down` | `W` / `S`          | Moves player one's (left) paddle.                                       |
| `p2-up` / `p2-down` | `↑` / `↓`          | Moves player two's (right) paddle — and, in Solo, player one's as well. |
| `confirm`           | `Enter` or `Space` | Accepts the selected menu item.                                         |
| `back`              | `Esc`              | Goes back a screen.                                                     |
| `pause`             | `P` or `Esc`       | Pauses during a match.                                                  |
| `mute`              | `M`                | Toggles mute, on any screen.                                            |

Either side's up/down action moves a menu selection, wrapping at both ends, so
the menus answer to `W`/`S` and `↑`/`↓` alike. `Esc` drives **two** actions —
`pause` and `back` — and the game reads whichever the current screen calls for:
`Esc` and `P` both open the pause menu during a match and both resume from it,
and `Esc` returns to the title from the how-to and match-over screens.

### The mouse and the touchscreen

The menus also take a **mouse** and a **finger**. Moving the pointer onto a menu
item highlights it; pressing and releasing inside one item chooses it. A press
that begins on one item and ends on another chooses nothing, so sliding off a
control cancels it. A touch contact has no hover, so its landing both highlights
and — when it lifts on the same item — chooses. Every position is taken through
the same letterboxed fit the game draws under, so what a click lands on is what
is drawn there. The title menu remembers the entry you left it by, and every
route back to the title highlights that entry again.

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

**Spin:** swing your paddle (hold a movement key) as it strikes a ball to curve
the shot. Up and down swings curve it opposite ways; a stationary paddle imparts
no spin, and imparted spin fades within a couple of seconds. Where on the paddle
you make contact sets the angle: the center sends the ball straight across, the
top or bottom edge sends it off at up to ~55°.

## The runtime this project carries

Carom runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game — there is no
asset loader, because Carom loads nothing — and it is six files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas to the field background (so the letterbox bars match the field),
  installs the logical transform, and calls `update` then `render`. There is no
  fixed timestep and no accumulator: every rate in `src/constants.ts` is per
  second and is integrated against the delta, so the same second of play reaches
  the same state however it was divided into frames. It also owns the **manual
  clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centered
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed. `src/render.ts` draws in logical `1280x720`
  coordinates and never reads the canvas element's size.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/pointing.ts`** — the mouse and the touch contacts. It hears pointer
  events for a mouse and touch events for a finger (so a browser's compatibility
  mouse events cannot make one tap look like two), maps every position into
  logical field units through the same fit, and queues the samples for the frame
  that reads them, pairing each release with the point its press landed on.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

`src/main.ts` is the whole of the wiring between that layer and the game.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__carom`**, so a scenario can be posed in Carom's own world from code.
The surface is **atomic**: every operation is a reading or a pose, and a pose sets
one field, places or removes one entity, or moves the clock. Starting a match,
staging a rally and reaching a screen are *sequences* of these, which belong to
whoever is driving the game.

- **The clock** — `setAutoStep(enabled)` and `advance(seconds, frames)`. Nothing
  outside this build owns it, so the surface carries it: `setAutoStep(false)`
  stops the loop advancing the simulation from the wall clock, and
  `advance(seconds, frames)` runs that many whole frames — the same update the
  loop runs, then a render — covering that much game time. Drawing is unaffected
  either way, so the canvas always shows the state the last frame left. Because
  every rate is integrated against the frame's delta, `advance(1, 1)` and
  `advance(1, 60)` reach the same outcome.
- **The world** — `clearWorld()`, `spawnBall(index)`, `spawnObstacle(index)`,
  `reset()`. Which balls and which obstacles are present is
  state, so a scenario empties the field and spawns back exactly the bodies it is
  about. `reset()` restores every declared field to its title-screen value and
  leaves the mute bit and the auto-step setting alone.
- **Screens and menus** — `setScreen`, `setMode`, `setMenuIndex`,
  `setTitleIndex`, `setResumeScreen`.
- **Match state** — `setScore(p1, p2)` and `setWinner(side)`.
- **Paddles** — `setPaddleCy(side, cy)`, `setPaddleVy(side, vy)` and
  `setPaddleDriven(side, driven)`. Each side is taken from the player and handed
  back on its own. `setPaddleVy` sets that side's `drivenVy`, the velocity a
  driven paddle travels at, which holds across frames whether or not the paddle
  is driven; a paddle's `vy` is the velocity the frame actually integrated,
  whoever moved it, and it is what the spin mechanic reads at contact.
- **Balls** — `setBallPosition`, `setBallVelocity`, `setBallSpin`, `setBallHeld`,
  `setBallHoldTimer`, `setBallLaunchAngle` and `drawBallLaunchAngle`, each taking
  the ball's play-order `index` first. An
  operation naming a ball that is off the field has no effect, and setting a hold
  timer to `0` ends that hold — the launch itself is the game's, on the next
  frame.
- **The AI** — `setAiTracking(enabled)` and `setAiMovement(enabled)`, its two
  faculties gated one at a time: sensing the ball, and travelling toward it.
- **Audio** — `setMuted(muted)`, the mute bit the `mute` action toggles.
- **Readings** — `snapshot()` returns a JSON-serializable view of the whole
  declared state, and `menuItemRect(index)` reports the hit region of one item of
  the menu the current screen shows, in logical units (`null` on the two screens
  that show no menu).

Every operation but the two clock calls is a read or a pose of `CaromState`: they
arrange the world, and the game's own `update` is what runs from there on the
next frame. The clock calls take nothing from the player — a scenario that takes
the game off real time to watch the **keyboard** move a paddle is exactly what
the control checks are — so there is deliberately no `keyDown`, `keyUp` or
`press` on the surface, no pointer pose (a real mouse and a real finger reach the
page's own listeners), and no overlay toggle: the runtime owns the backtick key
and the panel.

The surface is inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

```sh
npm ci
```

This project depends on no runtime package at all: everything it runs on is in
`src/`, so `npm ci` installs the TypeScript toolchain and nothing else.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root. Serve that directory as-is from any static file
server:

```sh
npm run preview        # serves dist/ locally for a final check
```

## Checks

```sh
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --check
npm test               # vitest, with coverage over src/
```

`npm test` runs the build's own suite **in process**, with no browser involved.
The runtime's own modules are checked directly; the game is checked by standing
the real runtime up over an `@napi-rs/canvas` canvas and a `Surface` of the
test's own, stepping it with `advance` — so a duration is an exact number of
frames of an exact length — and reading the result back from the game's state,
the cues its update played, and the pixels its render produced.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: stand the runtime up, initialize, install, run
  runtime.ts          The frame loop, the manual clock, and the wiring
  viewport.ts         The canvas fit: uniform scale, letterbox, pixel ratio
  keyboard.ts         Named actions over key codes, with edge detection
  pointing.ts         The mouse and the touch contacts, in logical units
  audio-bus.ts        Web Audio cues and the first-gesture unlock
  overlay.ts          The diagnostics panel and the backtick key
  constants.ts        Every figure the specification fixes: geometry, physics,
                      AI, match rules, bindings, cues, copy (logical 1280x720)
  theme.ts            This build's own look: the neon palette, the type, the
                      HUD layout, the tagline and the mode labels
  menu.ts             Each menu's items and their hit regions, laid out once
  debug.ts            The window.__carom surface over CaromState
  game.ts             The state contract, the state machine, and the three
                      functions the runtime drives
  random.ts           The launch angle draw a parked ball takes
  entities.ts         Paddle and ball arithmetic, geometry, and the home points
  trail.ts            One ball's motion trail, a fixed slice of time
  physics.ts          Delta-time integration, collision (walls, paddles,
                      obstacles, and ball against ball), the spin mechanic
  ai.ts               The beatable AI opponent, defending one ball at a time
  render.ts           All canvas drawing, in logical space
  diagnostics.ts      The values the overlay shows
  audio.ts            The five audio cues
  *.test.ts           The build's own tests, beside the code they cover
```
