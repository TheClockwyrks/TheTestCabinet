# Wireworm — reference implementation (base variant)

The authored, correct reference build of the **base** variant ("Descent") of the
Wireworm test case. Wireworm is a fixed-shooter: a segmented **data-worm** winds
down a circuit board through a field of **capacitor nodes**, and you are a
**defrag cursor** pinned to a shallow band at the bottom, firing straight **up**
to cut the worm apart before it reaches you.

The signature is the **charged field**. Every node the worm bumps gains charge
(inert → low teal → mid cyan → white-hot **critical**). Shoot a critical node and
it detonates, arcing through the whole connected charged cluster in one
**chain-arc discharge** — clearing those nodes and cleanly frying every worm
segment threading through them. But every worm segment you kill with a *bolt*
leaves a fresh node, so the field thickens as you fight and drives the worm down
faster; a **discharge** is the only way to thin it. And a standing critical node
is double-edged: the worm **dives** straight down a critical column at you. Pace
the cycle: let the field build and charge, then release it at the right moment.

This is a self-contained static web app — plain TypeScript rendering to an HTML5
canvas, bundled with Vite. No backend, no network, no accounts, no API keys.

## Controls

- **Move** — Arrow keys or **WASD** (the cursor glides freely within the bottom
  band; it can never leave it). The mouse may also move the cursor.
- **Fire** — **Space** (hold to auto-fire) shoots straight up; a left click fires
  too. At most 3 bolts in flight; a bolt stops at the first node, segment, or foe.
- **Pause** — **P** or **Esc** (Resume / Restart / Quit to menu).
- **Menus** — Arrows / **W**/**S** to move the selection, **Enter** / **Space**
  to confirm.
- **Mute** — **M**.

## The game

- **12 levels.** The worm lengthens and quickens each level, and the node field
  **persists** between levels, so the board only gets denser. Clear every worm
  segment to advance; clear level 12 to win; run out of lives to lose.
- **Shooting a node:** an inert node is destroyed; a charged node is de-energized
  one level (it resists clearing); a **critical** node detonates the chain-arc.
- **Shooting the worm:** a middle-segment hit **splits** it into two independent
  worms; an end hit **shortens** it. Every bolt-killed segment leaves a node.
- **Three foes:** the **glitch** skitters the lower board eating nodes (1 hit); the
  **packet-dropper** falls a column reseeding a sparse field (2 hits — the first
  only speeds it up); the **corruptor** crawls an upper row slamming nodes to
  critical (1 hit, biggest bounty).

## Assets

The node, worm, cursor, and three foe sprites are the provided `assets/` art,
rendered at 32×32 with nearest-neighbor scaling. Vite inlines them into the bundle
as page-relative data URIs, so the build runs unchanged at any base path (e.g. a
per-run sub-path). The bolts, discharge arcs, board, and HUD are drawn in code.

## Develop, build, run

```sh
npm ci          # install exactly from the committed package-lock.json
npm run dev      # Vite dev server (hot reload)
npm run build    # type-check (tsc --noEmit) + produce the static site in dist/
npm run preview  # serve the production build from dist/ on :4173
```

`npm run build` emits a fully static `dist/` with `index.html` at its root; serve
it from any static file server, at any base path.

## Code layout

- `src/main.ts` — bootstrap: canvas fit/letterbox at any size & DPR, the
  fixed-timestep loop.
- `src/constants.ts` — geometry, palette, and the tunable balance numbers.
- `src/types.ts` — shared world types.
- `src/assets.ts` — sprite loading via a Vite glob (page-relative URLs).
- `src/input.ts` — keyboard (required) + optional mouse.
- `src/audio.ts` — Web Audio synthesized cues (optional, muteable).
- `src/field.ts` — the node field: scatter, charge helpers, sparse-field count.
- `src/worm.ts` — the worm's per-step motion: winding, charging, dive.
- `src/foes.ts` — the glitch, dropper, and corruptor.
- `src/game.ts` — the state machine and simulation glue, and the signature
  charge / chain-arc discharge logic.
- `src/render.ts` — all drawing: board, sprites, effects, HUD, menus, overlays.
