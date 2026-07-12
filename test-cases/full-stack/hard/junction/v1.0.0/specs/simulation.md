# Junction — The simulation core (Rust → WebAssembly)

Junction's city is a layered, deterministic simulation, and **you must author that
simulation in Rust and run it as WebAssembly** in the browser. The Rust → wasm
toolchain (`cargo`, `wasm-bindgen`, `wasm-pack`, the `wasm32-unknown-unknown` target,
`binaryen`) is on your `PATH` while this build runs, exactly as the asset tools are; use
it to compile your simulation to a `.wasm` module, then drive that module from your
JavaScript/TypeScript front end. This is a hard requirement of the case, on the same
footing as producing the art (`specs/assets.md`) — read it as carefully as the system
specs.

This file says **what** must live in Rust, what stays in the front end, and the few
properties the boundary must have. It does **not** prescribe an API: how you shape the
exported functions, the module's construction, or the memory layout is yours to design.

## What the simulation core is

The **core simulation** is the deterministic, fixed-step model of the city and **every
rule and query that reads or mutates its authoritative state** — everything the system
specs describe as the game's logic, not its presentation. It must be Rust:

- The **tile world** and its generation: the terrain grid, the starting valley
  (`specs/mode.md`), buildability, and the per-tile fields the tick sweeps
  (`specs/map.md`).
- **Zoning, development, and abandonment**: the develop / upgrade / decay sweep through
  the density tiers under its gate conditions (`specs/map.md`, `specs/economy.md`).
- The **transit network**: connected-component labelling and path search across the road
  and rail graph, trip assignment, per-link **load** and **congestion**, and the
  advancing of the vehicle agents (`specs/transit.md`).
- The **utility networks**: power and water supply propagation through their carriers and
  the over-draw resolution (`specs/utilities.md`).
- The **economy**: the pollution field, land value, the RCI demand update, and the
  monthly budget settle with its bankruptcy test (`specs/economy.md`).
- **The clock and tick orchestration**: the fixed-step order the systems run in, the
  month beat, and milestones (`specs/flow.md`, `specs/controls.md`).
- **The tools and every state query**: tool legality, cost, placement, and bulldoze; the
  "what is at this tile / is this legal here / why refused" hit-test behind selection; and
  the **game state machine** (title / how-to / playing / paused / bankrupt) with the menu
  choices each state offers (`specs/controls.md`, `specs/flow.md`).

If a piece of logic decides *what the city is or does*, it belongs in the Rust core. The
front end must **not** re-implement or fork any of these rules; it reads the core's state
to draw it and forwards the player's actions into the core.

## What stays in the front end (JS/TS)

The JavaScript/TypeScript side is a **view and I/O layer** only. It owns:

- **Rendering** — drawing the city, the produced sprites, sheets, and particle overlays,
  and the in-code HUD, menus, overlays, and selection/tool feedback (`specs/assets.md`,
  `specs/flow.md`).
- The **camera transform** — pan / zoom / clamp and the screen↔world math. This is pure
  view math with no simulation state, and the input layer needs it to turn a pointer
  position into the world tile it then asks the core about.
- **Input capture** — reading pointer and keyboard events and turning them into calls
  into the core (place a tool here, set the tax rate, change speed, navigate a menu).
- **Playback** — Web Audio for the produced sounds and music, and
  `@test-cabinet/particle-runtime` for the produced particle systems.
- **Asset loading** and fitting the stage to the window (`specs/overview.md`).

## Properties the boundary must have

- **Deterministic.** Given the same start (seed) and the same sequence of player actions,
  the core must evolve **identically** — the same city month by month. Keep all
  randomness inside the core, seeded; do not drive simulation state from wall-clock time
  or un-seeded randomness.
- **Pure of the DOM.** The Rust core must not touch the DOM, Canvas, Web Audio, or the
  network. When the simulation wants a sound played or a particle burst thrown, it
  **records an event** (a sound cue, a effect at a position) that the front end **drains
  each frame** and acts on — the sim describes *what happened*, the front end decides how
  to present it.
- **Cheap to read each frame.** The front end reads a lot of state every frame (the tile
  fields, the moving vehicles). Expose that state so a frame is **about one step call plus
  direct reads**, not a fresh serialization of the whole city each frame — for example by
  letting the front end read views over the module's linear memory, or another
  low-overhead scheme you design. A per-frame deep copy of the world across the boundary
  is the thing to avoid.

## The `.wasm` is a committed build input

Compile the simulation to WebAssembly **once, during this run**, and **commit** the
resulting `.wasm` (and any generated binding glue) alongside your source. The compiled
module is a **build input**, exactly like the produced assets: your build (`npm run
build`) must be **self-contained and Node-only**, consuming the committed `.wasm`
directly and **never invoking `cargo` or `wasm-pack`** — the Rust toolchain is on your
`PATH` only while this run is live, not when the build is re-run to validate it or rebuilt
from the published source. A build that shells out to `cargo`/`wasm-pack` (recompiling the
wasm it should already have committed) fails wherever the toolchain is absent — a
catastrophic load failure, even though the game is complete. This is the same rule the
asset tools follow (`specs/assets.md`): produce once, commit, consume.

Commit the **Rust source** too (it is part of the published implementation), and keep the
Rust build directory (`target/`) out of the committed tree with your `.gitignore`.

## Loading rule — page-relative

The `.wasm` and its glue are loaded at runtime like any other asset, so they obey the
same base-path rule (`specs/assets.md`): load them **page-relative**, never by a
root-absolute `/…` URL, so the built site runs when it is served from a per-run sub-path.
Let your bundler resolve the module URL (for example a runtime `new URL('./…wasm',
import.meta.url)` your bundler can statically resolve, or the bundler's own wasm import)
and set the bundler's base to be relative (for Vite, `base: './'`).
