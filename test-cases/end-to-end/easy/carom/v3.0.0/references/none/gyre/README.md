# Carom (Gyre) — `none` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`gyre` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/` remain authoritative for the
design.

The project is the case's seeded workspace (`../../workspaces/none/`) — ten
configuration files and nothing else — with the whole of `src/` written: the
runtime the game stands on, the game, and the tests for both. What is here is
exactly what a run on no engine is asked to produce.

---

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of swaying, spinning mid-field obstacles. A player scores
when the ball passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two obstacles sway in
anti-phase and turn as they go, so the open field is a bank-shot puzzle whose
angles change while you line the shot up.

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

| Action              | Keys               | Does                                                                      |
| ------------------- | ------------------ | ------------------------------------------------------------------------- |
| `p1-up` / `p1-down` | `W` / `S`          | Moves player one's (left) paddle.                                         |
| `p2-up` / `p2-down` | `↑` / `↓`          | Moves player two's (right) paddle — and, in Solo, player one's as well.   |
| `confirm`           | `Enter` or `Space` | Accepts the selected menu item.                                           |
| `back`              | `Esc`              | Goes back a screen: leaves how-to, resumes from pause, leaves match-over. |
| `pause`             | `P` or `Esc`       | Pauses during a match.                                                    |
| `mute`              | `M`                | Toggles mute, on any screen.                                              |

Either side's up/down action moves a menu selection, so the menus answer to
`W`/`S` and `↑`/`↓` alike. `Esc` drives **two** actions — `pause` and `back` — so
one press opens the pause menu during a match and one press closes it again; `P`
does both too, and on a menu `Esc` steps back.

**The menus also take a mouse and a finger.** Every menu item occupies a hit
region: moving the pointer onto one highlights it, and pressing and releasing
inside the same region chooses it. A touch contact highlights an item the moment
it lands, since a finger cannot hover, and chooses it when it lifts inside the
same region — so sliding off before letting go cancels, with either device.
Whichever input chose it, returning to the title selects the entry that led away
from it again.

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to curve
the shot. Up and down swings curve it opposite ways; a stationary paddle imparts
no spin, and imparted spin fades within a couple of seconds. Where on the paddle
you make contact sets the angle: the center sends the ball straight across, the
top or bottom edge sends it off at up to ~55°.

**The look** — neon on charcoal, a system monospace, the scores either side of
the net — is this build's own choice. The specification fixes the geometry, the
physics, the controls, the cue names and the screen copy, and leaves the palette
and layout to the build; `src/theme.ts` holds the former and `src/constants.ts`
the latter, kept apart so the two are never confused.

## The runtime this project carries

Carom runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game — there is no
asset loader, because Carom loads nothing — and it is six files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas, installs the logical transform, and calls `update` then `render`.
  There is no fixed timestep and no accumulator: every rate in
  `src/constants.ts` is per second and is integrated against the delta, so the
  same second of play reaches the same state however it was divided into frames.
  It also owns the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centered
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed. `src/render.ts` draws in logical `1280x720`
  coordinates and never reads the canvas element's size.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/pointer.ts`** — the mouse and the finger, mapped through the same fit
  the game draws under and buffered per frame. Both arrive as pointer events, and
  `pointerType` is what tells a hovering mouse from a contact that only exists
  between its landing and its lift.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

`src/menu.ts` sits above that layer rather than in it: it is the one place a
menu's items and their hit regions are laid out, so what the renderer draws, what
a pointer is tested against, and what `menuItemRect` reports are one fact rather
than three that agree by hand.

`src/main.ts` is the whole of the wiring between that layer and the game.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__carom`**, so a scenario can be posed in Carom's own world from code:

- `setAutoStep(enabled)` and `advance(seconds, frames)` — the **clock**. Nothing
  outside this build owns it, so the surface carries it: `setAutoStep(false)`
  stops the loop advancing the simulation from the wall clock, and
  `advance(seconds, frames)` runs that many whole frames — the same update the
  loop runs, then a render — covering that much game time. Drawing is unaffected
  either way, so the canvas always shows the state the last frame left. Because
  every rate is integrated against the frame's delta, `advance(1, 1)` and
  `advance(1, 60)` reach the same outcome.
- `clearWorld()`, `spawnBall()`, `spawnObstacle(index)` and `reset()` — the
  **world**. A scenario empties the field and spawns back exactly the bodies its
  requirement concerns; an absent body is not advanced, not drawn, and collides
  with nothing. `reset()` restores every declared field at once, and is the only
  operation that does more than one thing.
- `setScreen`, `setMode`, `setMenuIndex`, `setTitleIndex`, `setResumeScreen`,
  `setScore`, `setWinner`, `setReceiver` — the screens, the menus, and the match.
- `setPaddleCy(side, cy)`, `setPaddleVy(side, vy)` and
  `setPaddleDriven(side, driven)` — the paddles, **one side at a time**. Driving
  one side leaves the other with the player and, in Solo, with the AI.
  `setPaddleVy` sets that side's `drivenVy`, which is the velocity a driven
  paddle moves at; a paddle's `vy` is the velocity the last frame actually
  integrated, and the two are separate fields.
- `setBallPosition`, `setBallVelocity`, `setBallSpin`, `setBallHeld` and
  `setBallHoldTimer`, `setBallServeSign`, `drawBallServeSign` — the ball. Setting
  the hold timer to `0` ends the hold, and
  the build's own rule serves the ball on the next frame.
- `setAiTracking(enabled)` and `setAiMovement(enabled)` — the AI's two faculties,
  gated on their own: sensing the ball, and travelling toward what it senses.
- `setMuted(muted)` — the mute bit, the same bit the `mute` action toggles.
- `setObstacleClock(t)` and `setObstacleClockRunning(running)` — the obstacle
  clock. `t = 0` is upright at the base centers; a larger `t` sways and rotates
  them exactly as normal play would at that moment, and stopping the clock holds
  both poses so a shot meets one chosen orientation instead of obstacles sweeping
  through it.
- `snapshot()` and `menuItemRect(index)` — the two **readings**. A snapshot
  reports every field an operation above sets, so each is verified by setting a
  value and reading it back; `menuItemRect` reports the hit region of an item of
  the current menu, in logical units, so the layout the build chose is the layout
  a pointer is tested against.

Every operation but the two clock calls is a read or a pose of `CaromState`: each
sets **one** field, places or removes **one** entity, or reads. They arrange the
world, and the game's own `update` is what runs from there on the next frame. So
starting a match or staging a rally is a *sequence* of these rather than a verb
of its own. The two clock calls take nothing from the player — a scenario that
takes the game off real time to watch the **keyboard** move a paddle is exactly
what the control checks are — so there is deliberately no `keyDown`, `keyUp` or
`press` on the surface either, no pointer pose (a real mouse and a real finger
drive the menus), and no overlay toggle: the runtime owns the backtick key and
the panel.

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
  pointer.ts          The mouse and the finger, in logical units, per frame
  audio-bus.ts        Web Audio cues and the first-gesture unlock
  overlay.ts          The diagnostics panel and the backtick key
  constants.ts        Every figure the specification fixes (logical 1280x720)
  theme.ts            This build's own look: palette, type, HUD layout, tagline
  debug.ts            The window.__carom surface over CaromState
  game.ts             The state contract, the state machine, and the three
                      functions the runtime drives
  random.ts           The serve sign draw a parked ball takes
  entities.ts         Paddle and ball arithmetic and geometry
  trail.ts            The ball's motion trail, a fixed slice of time
  physics.ts          Delta-time integration, collision, the spin mechanic
  ai.ts               The beatable AI opponent
  obstacles.ts        The obstacle poses, as pure functions of the clock
  menu.ts             The menu items and their hit regions, laid out once
  render.ts           All canvas drawing, in logical space
  diagnostics.ts      The values the overlay shows
  audio.ts            The four audio cues
  *.test.ts           The build's own tests, beside the code they cover
```
