# Carom — `simple-2d` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`base` variant **on the [Simple 2D](../../../../../../packages/simple-2d) engine**.
It is the counterpart of `../../reference-impl/base`, which is the same game with
no engine at all, and the two exist side by side because a case that supports more
than one engine needs a reference per engine: the build a reference demonstrates is
genuinely different under each. It is **never seeded into a run** — handing a model
the finished game would defeat the test — and takes no part in the case's seed set.
The case specs under `../../specs/` remain authoritative for the design.

---

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of fixed mid-field obstacles. A player scores when the
ball passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two fixed obstacles turn the
open field into a bank-shot puzzle.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

## Controls

Every control is a **registered engine action** on the `dual-vertical` touch
layout, bound to these keys:

| Action | Keys | Does |
| --- | --- | --- |
| `p1-up` / `p1-down` | `W` / `S` | Moves player one's (left) paddle. |
| `p2-up` / `p2-down` | `↑` / `↓` | Moves player two's (right) paddle — and, in Solo, player one's as well. |
| `confirm` | `Enter` or `Space` | Accepts the selected menu item. |
| `back` | `Esc` | Goes back a screen. |
| `pause` | `P` or `Esc` | Pauses during a match. |
| `mute` | `M` | Toggles mute, on any screen. |

Either side's up/down action moves a menu selection, so the menus answer to `W`/`S`
and `↑`/`↓` alike. `Esc` drives **two** actions — `pause` and `back` — and the game
reads whichever the current screen calls for, so it pauses in a match and steps back
on a menu.

The **backtick** key (`` ` ``) toggles the engine's debug overlay. That key belongs
to the engine, not to this game.

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to
curve the shot. Up and down swings curve it opposite ways; a stationary paddle
imparts no spin, and imparted spin fades within a couple of seconds. Where on the
paddle you make contact sets the angle: the center sends the ball straight
across, the top or bottom edge sends it off at up to ~55°.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here:

- **The frame loop and its delta time.** `update(dt)` receives the real elapsed
  seconds of the frame, already clamped, and every rate in `src/constants.ts` is per
  second and integrated against it. There is no fixed timestep and no accumulator —
  the same second of play reaches the same state however it was divided into frames.
- **The canvas fit.** The uniform scale, the centered letterbox, the device pixel
  ratio, and the resync when any of them changes. `src/render.ts` draws in logical
  `1280x720` coordinates and never reads the canvas element's size.
- **Input.** Named actions over `KeyboardEvent.code` bindings, with edge detection
  done once and correctly.
- **Audio.** The Web Audio graph, cue synthesis, mute, and the first-interaction
  unlock. The game declares four cues and plays them by name.
- **The debug overlay.** The panel, the toggle key, and its read-only-ness.

What is left is the game: the simulation, the drawing, and the scenario-posing
half of the debug API.

## Debugging and automation

The game exposes a small debugging and automation API on **`window.__carom`** so a
scenario can be posed in Carom's own world from code:

- `reset(options?)` and `snapshot()` — return to the title screen (seedable) and
  read a JSON-serializable view of the full state.
- `startMatch(mode)`, `serve()`, `setScore(p1, p2)`, `setPaddle(side, state)`, and
  `setBall(index, state)` — set up a scenario through the game's real systems;
  calling any of them hands paddle control to the caller until `reset()`.
- `setAiControl(enabled)` — in Solo, hand the AI's paddle back to the computer
  opponent for the rest of a driven scenario, so a check can exercise the real AI
  against a posed shot; the left paddle and ball stay under the caller's control.

Everything about *driving a browser game* rather than about Carom is the engine's,
on **`window.__tcabEngine`**: replacing the clock and running exact frames off a
schedule (`setClock`, `setSchedule`, `advance`, `frame`), driving the registered
actions (`actions`, `setAction`, `pressAction`), reading the audio cue log
(`audioLog`, `audioState`), reading the diagnostics, and showing or hiding the
overlay. So there is deliberately no `step`, `setAutoStep`, `keyDown`, `keyUp`, or
`press` on `window.__carom`.

Both surfaces are inert during normal play.

## Requirements

- Node.js 18+ and npm. No other toolchain is needed.

## Install

```sh
npm ci        # or: npm install
```

The engine is vendored, prebuilt, under `vendor/simple-2d/` so this project
installs and builds with a plain `npm ci` outside the monorepo. A real run receives
the identical package as an injected `file:` dependency on the seeded engine
instead, so the import in the sources is the same either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot-reload at the URL it prints (default
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

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vendor/simple-2d      Vendored, prebuilt @test-cabinet/simple-2d
src/
  main.ts             Bootstrap: create the engine, register, run update/render
  constants.ts        Palette, geometry, physics constants (logical 1280x720)
  types.ts            Shared types
  entities.ts         Ball and Paddle
  input.ts            Engine action bindings + Carom's semantic reads of them
  audio.ts            The four engine cues
  trail.ts            Ball-position history for the motion trail
  physics.ts          Delta-time integration, collision, the spin mechanic
  ai.ts               The beatable AI opponent
  game.ts             State machine, match flow, the per-frame update
  render.ts           All canvas drawing (neon-on-charcoal), in logical space
  debug.ts            window.__carom control ops + the overlay's diagnostics
```
