# Wireworm — `none` reference implementation

The authored, **correct** reference build of the Wireworm end-to-end test case
on **no engine**. It is **never seeded into a run** — handing a model the
finished game would defeat the test — and takes no part in the case's seed set.
The case specs under `../../specs/` remain authoritative for the design.

The project is the case's seeded engineless workspace (`../../workspaces/none/`)
— the configuration and the sprite art, and nothing else — with the whole of
`src/` written: the runtime the game stands on, the game, and the tests for
both. What is here is exactly what a run on no engine is asked to produce.

---

**Wireworm** is a fixed-shooter arcade game for the browser, played on a circuit
board. A segmented **data-worm** winds down a `40 x 20` field of capacitor
**nodes**; the player is a **defrag cursor** pinned to a shallow band along the
floor, firing upward to cut the worm apart before it reaches the band.

Wireworm's defining idea is the **charged field**. Every node the worm is turned
by gains charge, so the collision that steers the worm also arms the terrain it
steers on. A fully charged node **detonates** when it is shot, arcing through
the charged cluster around it, clearing those nodes and frying every worm
segment caught in the blast. Every segment cut by a bolt leaves a fresh node
behind, so the field thickens as the fight goes on, and a **critical** node the
worm reaches sends it **diving** straight down.

Three support foes work the board alongside the worm: the **glitch** skitters
about eating nodes, the **dropper** falls down a column reseeding it and takes
two bolts, and the **corruptor** crawls the upper rows slamming everything it
crosses straight to critical. A run is twelve levels on one board, with three
lives and a bonus life at every 12,000 points.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle. The nodes, the worm, the cursor, and the
three foes are drawn from the seeded sprite art under `assets/`; the board, the
band, the bolts, the arcs, the HUD, and every screen are drawn in code, and the
ten audio cues are synthesized on the spot.

The **look is this build's own**. The specs fix no palette and no typeface: they
fix what a player must be able to read at a glance — the four charge states as a
ramp, the worm against the field, the cursor against its band, the three foes
apart from one another — and leave the rest to the build. This one chose a dark
circuit board under a cold instrument light, with teal traces, a violet
data-worm, and a charge ramp that climbs from slate through teal to a white-hot
critical. Those choices live in `src/theme.ts`, apart from the figures the specs
fix in `src/constants.ts`.

One thing about that theme is worth naming, because it is a design decision
rather than decoration. The seeded art draws a node at charge 0 and a node at
charge 1 with the **same center pixels**, and it draws three of the glitch's four
frames with a center pixel all but identical to the board's own color. So each
node is drawn on a **charge-colored pad** with an **additive core** over the
seeded frame, and each foe carries a **signal glow** in its own hue. The frames
themselves are always the seeded ones — nothing is recolored or pre-composited —
and the two extra layers are what make the ramp and the foes read apart both
across a whole tile and at its center.

## Controls

The keyboard drives everything, as **named actions** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout:

| Action                           | Keys               | Does                                        |
| -------------------------------- | ------------------ | ------------------------------------------- |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | Moves the cursor in the band; moves a menu. |
| `a` / `b`                        | `Space`            | Fires a bolt.                               |
| `confirm`                        | `Enter` or `Space` | Accepts the highlighted menu item.          |
| `back`                           | `Esc`              | Leaves the current screen.                  |
| `pause`                          | `P` or `Esc`       | Pauses live play.                           |
| `mute`                           | `M`                | Toggles sound, on any screen.               |

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

## The runtime this project carries

Wireworm runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game, and it is six
files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas, installs the logical transform, and calls `update` then `render`.
  There is no fixed timestep and no accumulator over one, so the same second of
  play reaches the same state however it was divided into frames. It also owns
  the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centered
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed. `src/render.ts` draws in logical `1280x720`
  coordinates and never reads the canvas element's size.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. A muted bus starts no source at all, and nothing about
  audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.
- **`src/images.ts`** — the one part of the runtime that touches the network:
  the seeded frames, requested **page-relative** so the produced site runs at the
  root of a static host and under a sub-path of it alike.

`src/main.ts` is the whole of the wiring between that layer and the game.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__wireworm`**, so a scenario can be posed in Wireworm's own world from
code. Every operation is a **read**, a **pose of one field**, or a **move of the
clock**, and every pose is verifiable by setting a value and reading it back off
`snapshot`:

- `setAutoStep(enabled)` and `advance(seconds, frames)` — the **clock**. Nothing
  outside this build owns it, so the surface carries it. Drawing is unaffected
  either way, so the canvas always shows the state the last frame left.
- `reset(options?)` and `snapshot()` — return every declared field to its
  title-screen value (seedable; `muted` deliberately kept) and read a
  JSON-serializable view of the whole state.
- `setScreen`, `setPhase`, `setPhaseTimer`, `setMenuIndex`, `setScore`,
  `setLives`, `setLevel`, `setReachedLevel` — the screen and the run.
- `setFoeSpawning`, `setWormEntry`, `setCursorContact` — the three **world
  gates**. Each gates one faculty of the level itself and nothing else, each is
  on by default, and `reset` turns all three back on. They are what let a
  scenario hold: without them the level's own spawners put a glitch on the board
  within twelve seconds, a banner brings in a worm of its own, and the cursor
  parked at the band's center costs a life the moment anything reaches it.
- `setCursor`, `setCursorInvulnerable`, `setFireCooldown`, `addBolt`,
  `removeBolt`, `clearBolts` — the cursor and its bolts.
- `setNode`, `clearNode`, `clearNodes` — the node field.
- `addWorm`, `appendSegment`, `setWormHeading`, `setWormDescent`,
  `setWormDiving`, `setWormStepping`, `setWormBody`, `removeWorm`, `clearWorms`
  — the worms, built one segment at a time, with a gate for the **step** and a
  gate for the **body's follow**.
- `addFoe`, `setFoeVelocity`, `setFoeHit`, `setFoeMind`, `setFoeTravel`,
  `removeFoe`, `clearFoes` — the foes, with a gate for the **mind** and a gate
  for the **travel**, so a check on what a foe does cannot be disturbed by where
  it went.

Every worm, foe, and bolt carries an `id`, distinct among the entities live at
any moment; an entity added through the surface is appended to its roster, and
when a worm's segments are removed the run carrying the old head keeps its id.

There is deliberately no operation for the registered actions (the runtime's
keyboard is driven by dispatching real key events at the page), none for the
overlay (the runtime owns the backtick key), and none for muting (`M` is how a
player reaches it, and the snapshot reports the result).

The surface is inert during normal play. All randomness runs off the seeded
generator state the game carries in one field, so a given seed replays the same
scatter, the same arrivals, and the same lightning exactly.

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
with `index.html` at its root and the sprite art under `dist/assets/`. Serve
that directory as-is from any static file server, at any base path:

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
The runtime's modules are checked directly; the rules are checked against the
game's own `advance` over a board posed without a canvas at all, which is what
the render-free core makes possible; and the whole build is checked by standing
the real runtime up over an `@napi-rs/canvas` canvas and a `Surface` of the
test's own, publishing the surface exactly as `src/main.ts` does, and driving it
as a validator would — pressing real key events at it, stepping with `advance` so
a duration is an exact number of frames of an exact length, and reading the
result back from the snapshot, from the pixels on the canvas, from the image
sources handed to each `drawImage`, and from the sounds the audio bus started.
