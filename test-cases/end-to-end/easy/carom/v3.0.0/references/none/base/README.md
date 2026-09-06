# Carom — `none` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`base` variant on **no engine**. It is **never seeded into a run** — handing a
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
walls, and off a pair of fixed mid-field obstacles. A player scores when the ball
passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two fixed obstacles turn the
open field into a bank-shot puzzle.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle.

The look is this build's own. The specs fix what must be visible — a dark field,
paddles and obstacles and ball each bright and distinguishable, the scores near
the top, a trail behind the moving ball — and leave the palette, the type, and
the layout to the build. This build chose neon on charcoal: a teal left paddle,
a pink right paddle, an amber pair of obstacles, and a white ball, all in a
system monospace face. Those choices live in `src/theme.ts`, apart from the
figures the specs fix in `src/constants.ts`.

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

Either side's up/down action moves a menu selection (wrapping at both ends), so
the menus answer to `W`/`S` and `↑`/`↓` alike. `Esc` drives **two** actions —
`pause` and `back` — and the game reads whichever the current screen calls for,
so it pauses in a match and steps back on a menu: it resumes from the pause
menu, and returns to the title from the how-to and match-over screens.

The menus also take a **mouse** and a **finger**. Moving the pointer onto an item
selects it, and pressing and releasing inside one item confirms it; a press that
begins on one item and ends on another confirms nothing, so sliding off a control
cancels it. A touch contact has no hover, so the item it lands on is selected as
it lands and confirmed when the finger lifts there. The pointer is read once per
frame, after that frame's keys, and the regions the items occupy are the ones the
debug surface reports (below), so what a player aims at and what a driven check
aims at are the same rectangles.

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to curve
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
- **`src/pointer.ts`** — the mouse and the finger as one per-frame report: what
  moved, what was pressed, and which press came up where, in logical units
  through the same fit the frame is drawn under. It listens to pointer events
  alone, which is the one stream both devices arrive on, and it holds a press
  across frames because a confirm takes both of its edges.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

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
- `clearWorld()`, `spawnBall()`, `spawnObstacle(index)` — the **world**. A
  scenario empties the field and spawns back exactly the bodies its requirement
  is about; an absent ball takes no part in a frame and an absent obstacle has no
  collision.
- `reset()` — returns every declared field to its title-screen value. A reset
  leaves the mute bit and the clock alone, because neither is a field of the
  state.
- `setScreen`, `setMode`, `setMenuIndex`, `setTitleIndex`, `setResumeScreen`,
  `setScore(p1, p2)`, `setWinner`, `setReceiver` — the screens, the menus and the
  match, one field each.
- `setPaddleCy(side, cy)`, `setPaddleVy(side, vy)`, `setPaddleDriven(side,
  driven)` — the paddles, one side at a time. A driven paddle moves at that
  side's `drivenVy` and neither the keys nor the AI touch it; the other side goes
  on playing normally.
- `setBallPosition`, `setBallVelocity`, `setBallSpin`, `setBallHeld`,
  `setBallHoldTimer`, `setBallServeSign`, `drawBallServeSign` — the ball. This
  variant plays with one, so none of them
  takes an index. Ending the hold does not launch the ball: the game's own rule
  serves it on the next frame.
- `setAiTracking(enabled)` and `setAiMovement(enabled)` — the AI's two faculties,
  gated separately, so a check can watch what it senses while its body is still.
- `setMuted(muted)` — the mute bit, the same bit the `mute` action toggles.
- `snapshot()` and `menuItemRect(index)` — the **readings**. The snapshot is a
  JSON-serializable view of every declared field, and `menuItemRect` reports the
  region an item of the menu on screen occupies, in logical units — this build's
  own layout, reported, and `null` on the two screens that show no menu.

Every operation is **atomic**: it sets one field or one fixed pair, places or
removes one entity, reads the state, or moves the clock. `reset` is the one
exception, and it is a lifecycle verb. Starting a match, staging a serve or
posing a contact are therefore sequences of these, and a sequence belongs to
whoever is driving the game. Every operation but the two clock calls is a read or
a pose of `CaromState`: they arrange the world, and the game's own `update` is
what runs from there on the next frame. The clock calls take nothing from the
player — a scenario that takes the game off real time to watch the **keyboard**
move a paddle is exactly what the control checks are — so there is deliberately
no `keyDown`, `keyUp` or `press` on the surface, no pointer pose, and no overlay
toggle: a real key, a real mouse and a real finger are driven at the page, and
the runtime owns the backtick key and the panel.

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
  pointer.ts          The mouse and the finger, as one per-frame report
  audio-bus.ts        Web Audio cues and the first-gesture unlock
  overlay.ts          The diagnostics panel and the backtick key
  constants.ts        Every figure the specs fix (logical 1280x720)
  theme.ts            This build's own look: palette, type, HUD layout, menus
  menus.ts            Each menu's items and the regions they occupy
  debug.ts            The window.__carom surface over CaromState
  state.ts            The state contract and the transitions that pose it
  game.ts             The state machine, the per-frame update, and the three
                      functions the runtime drives
  random.ts           The serve sign draw a parked ball takes
  entities.ts         Paddle and ball arithmetic and geometry
  trail.ts            The ball's motion trail, a fixed slice of time
  physics.ts          Delta-time integration, collision, the spin mechanic
  ai.ts               The beatable AI opponent
  render.ts           All canvas drawing, in logical space, over the theme
  diagnostics.ts      The values the overlay shows
  audio.ts            The four audio cues
  *.test.ts           The build's own tests, beside the code they cover
```
