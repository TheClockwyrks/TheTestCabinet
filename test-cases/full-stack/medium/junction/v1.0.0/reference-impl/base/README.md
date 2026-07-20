# Junction

**Junction** is a top-down **transit-and-utility city builder** for the browser.
Looking straight down on a bounded tile map, you **zone** buildable land Residential /
Commercial / Industrial, lay **roads and one rail line with stations**, and run
**power** (plant + wires) and **water** (source + pipes). Zoned tiles **develop
themselves** — but only where they have **road access + power + water + demand** —
growing through **three density tiers**, then **abandoning** when a precondition is
lost. Citizens and goods **path across** the network; overloaded links **congest** and
slow every trip; industry and jams emit **pollution** that lowers **land value** and
suppresses nearby growth. A **budget** settles every in-game **month**: tax income vs.
upkeep.

Junction is **open-ended** — there is no win state. The "score" is your **peak population**
and the **number of months you stay solvent**. The one lose condition is **bankruptcy**:
when a budget period settles with the treasury at or past the debt limit and the period
balance still negative.

This directory is the authored **reference implementation** of the case's `base` variant
(the standard *New City* start) — the *correct*, ground-truth build the case is judged
against. It is a self-contained static web app whose **core simulation is authored in Rust
and compiled to WebAssembly** (the case requirement) and driven by a thin **TypeScript** view
layer rendering to a single **HTML5 canvas**, bundled with **Vite** (`base: "./"`). No
backend, accounts, network calls, or API keys; everything needed to play is in the built
bundle. The implementation contract is [`DESIGN.md`](DESIGN.md); the asset plan is
[`ASSETS.md`](ASSETS.md).

## The simulation is Rust, compiled to WebAssembly

Junction's deterministic city model — the tile world, the network graph and pathfinding,
transit + congestion, the power/water utilities, the RCI-demand-and-budget economy,
development, the build tools, and the game state machine — is authored in **Rust** in
[`sim-core/`](sim-core/) and compiled with `wasm-pack` to the committed
[`src/sim-core-pkg/`](src/sim-core-pkg/). The TypeScript in [`src/`](src/) is only the view
and I/O layer (rendering, HUD, camera, input, audio, particle playback); it reads the tile
arrays **zero-copy** as typed-array views over the wasm module's linear memory and forwards
the player's actions into the core. The compiled `.wasm` is a **build input**, exactly like
the produced assets: `npm run build` is Node-only and never runs `cargo`/`wasm-pack` — the
committed module is bundled as-is. Re-generate it with `npm run build:wasm` after changing
`sim-core/` and commit the result. Because the same crate also compiles natively, the economy
balance is validated with `cargo test` (see [`DESIGN.md`](DESIGN.md) §7).

## The assets are produced, not pre-made

Junction is a **full-stack** case: every sprite, animation, particle effect, and sound the
game plays was **produced during the build** with the asset-generation tools on the run
image's `PATH` (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`) and
committed under [`assets/`](assets/) — see the case's `specs/assets.md`. At runtime the game
only *loads* those committed files; the tools are not invoked by the build. The particle
systems (pollution haze, construction dust, milestone fireworks) are played live through
**`@test-cabinet/particle-runtime`** (vendored under [`vendor/`](vendor/) so a plain
`npm ci` resolves it outside the monorepo), and the sounds through the Web Audio API.

## Controls

- **New city** — the title menu's `NEW CITY` starts a fresh valley; `HOW TO PLAY` shows the
  primer. `TRY AGAIN` from the bankruptcy screen starts over.
- **Zone / build** — pick a tool from the bottom build palette (`RES COM IND ROAD RAIL STATN
  PWR WIRE WTR PIPE RAZE`, left to right), then act on the map: **drag** to paint a zone
  rectangle or lay an L-shaped road / rail / wire / pipe run; **click** to stamp a single
  station, power plant, or water source. Click the active tool again (or `Esc` /
  right-click) to drop it. Illegal tiles show a refusal reason; a drag run stops at the
  tile you can no longer afford.
- **Select / inspect** — with no tool held, a still left-click on a tile selects it for the
  inspector; click empty ground (or `Esc`) to deselect.
- **Camera** — pan with the arrow keys / `WASD`, a right-button (or empty-handed left)
  mouse-drag, or by edge-scrolling near the view borders (all clamped to the map bounds);
  **zoom** the map in and out with the mouse wheel, keeping the tile under the cursor fixed.
- **Overlays** — `Tab` (or the top-strip overlay button) cycles
  `none → traffic → utility → landvalue`.
- **Tax** — the `TAX` stepper in the bottom strip, also bound to `[` (down) / `]` (up).
- **Speed** — `1`/`2`/`3` sets the tick rate (`+`/`-` step it); `Space` (or the top-strip
  **❚❚** control) pauses in place while the board stays interactive; `Esc` opens the pause
  **menu** (which also freezes the board); `M` mutes.
- Every menu is fully operable with the mouse; `↑`/`↓` + `Enter` are keyboard alternatives.

### Values fixed by this implementation (spec leaves them to us)

`START_TREASURY = $30,000`, `DEBT_LIMIT = −$20,000`, `TAX_DEFAULT = 9%`.
**Zoning cost** `$10/tile` with **no upkeep**. **Walk distance** for road access
`WALK_TILES = 3`. Bulldoze **refunds 40%** of a tile's capital cost. **Re-zoning
a developed tile is refused** until it is bulldozed. See
[`DESIGN.md`](DESIGN.md) §3 for the full tuning table.

## Develop, build, and run

```bash
npm ci            # install (requires the committed package-lock.json)
npm run dev       # Vite dev server
npm run build     # type-check + produce the static site into dist/ (Node-only)
npm run preview   # serve the production build locally

# Dev-only — regenerate the committed Rust→wasm core (needs the Rust toolchain on PATH):
npm run build:wasm            # wasm-pack build → src/sim-core-pkg/ (commit the result)
cargo test --manifest-path sim-core/Cargo.toml   # the native balance harness
```

`npm run build` emits a fully self-contained static site into `dist/` with an `index.html`
at its root, consuming the committed `src/sim-core-pkg/` wasm as-is — it does **not** compile
Rust. The bundler base is relative (`base: "./"`), so `dist/` runs correctly when served from
any base path, including a per-run sub-path.

## Layout

- [`sim-core/`](sim-core/) — the **Rust simulation core** (compiled to wasm): the tile
  world, network graph + pathfinding, transit/congestion, utilities, the economy,
  development, the tools, and the game state machine, plus the `wasm-bindgen` boundary and
  the native balance harness in `tests/balance.rs`. See [`DESIGN.md`](DESIGN.md) §4.1.
- [`src/`](src/) — the **TypeScript view layer**. `sim.ts` binds the wasm core (zero-copy
  tile views + the `Game` the rest of the code reads), `grid.ts` (tile-index helpers),
  `constants.ts` (palette + geometry + the tool palette metadata), `types.ts` (view-side
  enums), `camera.ts` (the pan/zoom + tile↔screen transform — the one bit of spatial state
  the front end owns), `assets.ts` / `audio.ts` / `particles.ts` (loading and playing the
  produced art, sound, and effects), `overlays.ts` / `hud.ts` / `render.ts` (the overlays,
  HUD chrome, and all drawing), and `input.ts` + `main.ts` (input capture and the loop).
- [`src/sim-core-pkg/`](src/sim-core-pkg/) — the committed `wasm-pack` output (the `.wasm`
  build input + its JS glue), regenerated by `npm run build:wasm`.
- [`assets/`](assets/) — the produced sprites, sprite-sheet frames, particle systems, and
  audio.
- [`vendor/particle-runtime/`](vendor/) — a vendored, prebuilt copy of
  `@test-cabinet/particle-runtime`.
- [`scripts/`](scripts/) — the asset generators that produced [`assets/`](assets/)
  (`gen-sprites.sh`, `gen-animations.sh`, `gen-particles.sh`, `gen-audio.sh`, invoking the
  `PATH` tools).
