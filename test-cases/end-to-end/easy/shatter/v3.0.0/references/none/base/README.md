# Shatter — `none` reference implementation

The authored, **correct** reference build of the Shatter end-to-end test case's
`base` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/` remain authoritative for the
design.

The project is the case's seeded workspace (`../../workspaces/none/`) —
configuration files and nothing else — with the whole of `src/` written: the
runtime the game stands on, the game, and the tests for both. What is here is
exactly what a run on no engine is asked to produce.

---

**Shatter** is a top-down space-rock shooter for the browser, played on one
wrapping field of deep space. You fly a small ship under pure momentum, turning
and thrusting while jagged rocks drift and tumble around you. Firing splits a
Large rock into two Medium, each Medium into two Small, and a Small into nothing
at all. Clear the field and a denser, faster wave arrives, and an enemy saucer
wanders in to hunt you on a cadence of its own.

Shatter's defining idea is the **gravity well**. A star fixed at the centre of
the field pulls on everything that flies ballistically — every bullet, every
saucer bullet, and every rock — but never on the ship or the saucer, which are
powered craft with their own drive. So the star never wrests the ship out of the
player's hands; it shapes the board. Shots bend as they cross the centre, so a
bullet can be curved around the star onto a rock on its far side, and rocks
travel on curved, wrapping paths that keep the whole field churning.

The star's core is solid. The ship slides along it rather than through it, a shot
that reaches it is absorbed, and a rock the star swallows re-appears from the
edge of the field — so the well stirs the board without ever emptying it.

This is a self-contained static web app: plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle, and every body on the field is drawn in
code from no art files at all.

The look is this build's own. The specs fix what a player must be able to _read_
— a dark field, a star that reads as a well, the ship and the rocks and the
saucer and the bullets each apart from one another, a fading tail behind every
moving bullet, a flame while thrust is applied, a ship that shows its respawn
grace, and legible readouts — and leave the palette, the type and the layout to
the build. This build chose cold instruments on deep space: a cyan ship, warm
grey rocks, a gold star and a hot pink saucer. Those choices live in
`src/theme.ts`, apart from the figures the specs fix in `src/constants.ts`.

## Playing

- Shoot every rock down, **through its fragments**, to clear a wave. A wave
  clears on the moment the last rock is destroyed, and the next one is denser and
  faster.
- The star pulls your shots and the rocks but never your ship. Lead a shot into
  the well and it curves; a rock the star swallows comes straight back in from an
  edge.
- The saucer arrives about eighteen seconds in and then every twenty-five to
  thirty-five seconds after each visit ends. It aims at you, it can be shot down
  for the game's biggest score, and it never touches the star.
- You start with three ships and are granted another every ten thousand points.

## Controls

Every control is a **named action** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout:

| Action               | Keys       | While playing            | On a menu               |
| -------------------- | ---------- | ------------------------ | ----------------------- |
| `thrust` / `menu-up` | `↑` or `W` | Thrust along the facing  | Move the selection up   |
| `menu-down`          | `↓` or `S` | —                        | Move the selection down |
| `left`               | `←` or `A` | Rotate counter-clockwise | —                       |
| `right`              | `→` or `D` | Rotate clockwise         | —                       |
| `fire` / `confirm`   | `Space`    | Fire the gun             | Confirm the selection   |
| `confirm`            | `Enter`    | —                        | Confirm the selection   |
| `pause`              | `P`        | Pause                    | —                       |
| `pause` / `back`     | `Esc`      | Pause                    | Leave the screen        |
| `mute`               | `M`        | Toggle sound             | Toggle sound            |

Rotation and thrust are **holds**; firing answers to a press _and_ to a hold,
repeating at the gun's own gate. Confirming, leaving a screen, pausing and muting
are **press edges**, once per press. Three keys carry two meanings each — `Space`
fires and confirms, `Esc` pauses and leaves, `↑` thrusts and moves a selection —
and the **screen** decides which applies, by reading only the actions it answers
to.

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

## The runtime this project carries

Shatter runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game — there is no
asset loader, because Shatter loads nothing — and it is five files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas including the letterbox bars, installs the logical transform, and
  calls `update` then `render`. The **fixed timestep lives in the game**, not
  here: `specs/simulation.md` fixes it at 120 Hz, so the loop hands the game a
  delta and the game turns it into whole ticks and carries the remainder. It also
  owns the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centred
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed. `src/render.ts` draws in logical `1280x720`
  coordinates and never reads the canvas element's size.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a frame, and a muted bus
  builds no node at all.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

`src/main.ts` is the whole of the wiring between that layer and the game.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__shatter`**, so a scenario can be posed in Shatter's own world from
code:

- `setAutoStep(enabled)` and `advance(ticks)` — the **clock**. Nothing outside
  this build owns it, so the surface carries it: `setAutoStep(false)` stops the
  loop advancing the simulation from the wall clock, and `advance(ticks)` runs
  that many whole 120 Hz simulation ticks — the same tick the loop runs —
  followed by a render. Drawing is unaffected either way, so the canvas always
  shows the state the last tick left, and `advance(0)` runs nothing at all.
- `reset(options?)` and `snapshot()` — return every declared field of the state
  to its title-screen value (seedable), and read a plain, JSON-serializable view
  of the whole state.
- `setScreen`, `setMenuIndex`, `setScore`, `setLives`, `setWave`,
  `setWaveBanner` — the screen and the run.
- `setWaveSpawning` and `setSaucerSpawning` — the two **world gates**, so a
  scenario that empties the field is not handed a wave and a scenario that runs
  for eighteen seconds is not handed a saucer.
- `setShipPosition`, `setShipVelocity`, `setShipAngle`, `setShipInvuln`,
  `setFireCooldown`, and `setShipCollision` — the ship, and the gate on its
  lethal contact test. The slide along the star's core is a separate, non-lethal
  interaction and runs whether that gate is on or off.
- `addBullet` / `removeBullet` / `clearBullets`, `addEnemyBullet` /
  `removeEnemyBullet` / `clearEnemyBullets`, `addRock` / `setRockVelocity` /
  `removeRock` / `clearRocks` — the rosters, each with its own per-id removal and
  its own clear. `clearRocks` destroys nothing and scores nothing, so a field it
  emptied is a wave being played rather than a wave cleared.
- `addSaucer`, `setSaucerVelocity`, `removeSaucer`, and `setSaucerMind` /
  `setSaucerGun` / `setSaucerTravel` — the saucer's single slot and its three
  separable faculties: it decides, it shoots, and it moves.

Every operation but the two clock calls is a read of the state or a pose of **one
field** of it: they arrange the world, and the game's own stepping, gravity,
collision, scoring and wave rules run from there exactly as they do in play. So
there is no operation that fires, no operation that arranges several things at
once, no `keyDown` / `keyUp` / `press` — the runtime's registered actions are
driven by dispatching real key events at the page — no `setMuted`, because mute
is reached through its own key the way a player reaches it, and no overlay
operation, because the runtime owns the backtick key and the panel.

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
server, at any base path:

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
The runtime's own modules are checked directly; the game is checked by driving
its real tick a counted number of times over stand-ins for the keyboard and the
audio bus (`src/harness.test-support.ts`) and reading the result back from the
state, the cues the tick raised, and — through an `@napi-rs/canvas` context — the
pixels its render produced.

## Project layout

```
index.html                 Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts             Build config (emits to dist/)
vitest.config.ts           The build's own test suite, over src/
src/
  main.ts                  Bootstrap: stand the runtime up, initialize, publish, run
  runtime.ts               The frame loop, the manual clock, and the wiring
  viewport.ts              The canvas fit: uniform scale, letterbox, pixel ratio
  keyboard.ts              Named actions over key codes, with edge detection
  audio-bus.ts             Web Audio cues and the first-gesture unlock
  overlay.ts               The diagnostics panel and the backtick key
  constants.ts             Every figure the specs fix (logical 1280x720)
  theme.ts                 This build's own look: palette, type, HUD layout
  types.ts                 The shape of ShatterState
  game.ts                  The fixed step, the order inside one tick, the screens
  geometry.ts              The torus, the well's law, and the swept overlap test
  motion.ts                The pull, the travel, and the slide off the core
  rng.ts                   The seeded generator, over ShatterState.rng
  entities.ts              Every body's construction, and the ids they take
  ship.ts                  Rotation, thrust, drag, the cap, and the grace clock
  weapons.ts               The gun: its gate, its cap, and where a round leaves
  shots.ts                 The ballistic shots, and a bullet's trail record
  rocks.ts                 A rock's tick, its destruction, and the fragment fan
  saucer.ts                Its mind, its gun, its travel, and its cadence
  collision.ts             Every impact, swept and measured across the seams
  waves.ts                 The wave loop and the WAVE N banner
  world.ts                 A new game, the title values, the score, the lives
  debug.ts                 The window.__shatter surface over ShatterState
  render.ts                All canvas drawing, in logical space, over the theme
  diagnostics.ts           The values the overlay shows
  audio.ts                 The six audio cues
  input.ts                 The named actions, registered from BINDINGS
  harness.test-support.ts  Scaffolding the build's own tests drive the game with
  *.test.ts                The build's own tests, beside the code they cover
```
