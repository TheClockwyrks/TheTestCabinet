# Arc Foundry

**Arc Foundry** is an electro-industrial **GemTD**-style **tower-defense** game for the
browser. The **Load** — charge units seeking ground — spills from a feeder vent and mazes
along an ordered chain of **waypoint platforms** toward a grounding **collector**; you
pick
a **map** and a **difficulty** at the start, then build a maze of electrical parts to make
the route as long as possible and burn the Load down before it grounds out. Every unit
that
reaches the collector costs **Grid Integrity**; every unit you destroy pays a **Charge**
bounty that funds more building.

Its defining idea is the GemTD **scrap-press** loop — you do **not** buy specific towers:

- **Place up to 5 rocks per level.** Pull the press to arm a **blank rock**, then drop
  it on
  a legal spot. The instant it lands it **rolls a random component type and quality** (the
  roll happens on placement, weighted low). Placing is **free** and spends one of the
  level's five stamps; the cap is 5 per level (the only limit on placement). Placement is
  **continuous** — you keep dropping rocks back-to-back until the allowance runs out.
  Cancelling a held rock (Esc / right-click) is free (no roll, no stamp).
- **Harvest exactly one per level — and it sends the wave.** Each placed rock is a
  **candidate**: it walls the Load's route and shows its rolled type + quality. You take
  the level's **one harvest** — and there is **no SEND button**: committing it launches
  the wave immediately. **KEEP** promotes one candidate into a firing **component**;
  **DOWNGRADE** does the same one quality tier lower; or a **COMBINE** that consumes a
  fresh roll folds it into a stronger tower. Every level must harvest one tower to
  advance. Every rock you do **not** harvest hardens into an inert **blocker** (a 2×2 rock
  wall that never fires — the maze material).
- **Combine — immediate, any time.** To keep the value of more than one roll, **combine**.
  A combine resolves the instant you commit it — it is not the level's harvest, may be
  done any number of times, and is allowed **during a live wave** as well as in the build
  phase. Its result lands at whichever piece you trigger it from, so it can replace a
  standing tower; shift-click extra pieces to pick exactly which copies fold, or let the
  game resolve the set.
  - **Quality-combine** two pieces (candidates and/or existing base components) of the
    **same type + same quality** into one a **tier higher** on the ladder Scrap → Tuned →
    Charged → Primed → Tesla-Prime.
  - **Recipe-combine** — fold a specific multiset of base components at specific qualities
    into one of the **combination towers** (upgradeable turrets with exotic abilities —
    chain, splash, slow, burn, crit, multishot, aura). Consumed ingredients harden into
    blockers in place (wall-neutral). A combo **lands weak (level 0)** and is **upgraded**
    with Charge up to level 3.
- **Downgrade** a candidate — a **KEEP one quality tier lower** (build phase, free) that
  harvests it and sends the wave, to stand up a low-tier recipe ingredient when the press
  over-rolled; fold it into the recipe with a standing COMBINE during the wave.
- **Upgrade Quality** — spend Charge to raise your run's **Refinement** level (R0 → R8),
  biasing every future roll toward the higher tiers (GemTD's "upgrade chances" tree: each
  rung shifts ~10% of the odds up a quality, and the full R0→R8 climb costs 1000 Charge).
  At R0 the press rolls only Scrap; at high Refinement it can roll up to Tesla-Prime,
  though the top tiers stay rare — combining is still the reliable climb.

There are **eight base component types** — Capacitor, Coil, Emitter, Arc-Node, Discharge
Rig, the slowing **Choke**, the burning **Rectifier**, and the non-firing support
**Regulator** (whose aura buffs nearby towers).

Every component, candidate, and blocker is a **2×2 wall**; the Load pathfinds the shortest
**open** route around them between the ordered **4-tile waypoint platforms** (walkable but
never buildable, so a waypoint can never be walled off), and a placement that would seal a
segment is refused. Air units (the **Filament** flyer, which ignores the maze) only appear
**every 4th wave**; a **Dynamo** boss anchors the milestone waves. Difficulty changes only
the **wave count and enemy toughness**. Survive every wave with integrity left and you
win; run out of integrity and the grid overloads. There is **no running score**: after the
final wave, an **invincible Overload Dynamo** walks your maze once and the total damage
you deal it is your **Maze Rating** — the run's only end number. Integrity only gates
win/lose.

This directory is the authored **reference implementation** of the case's `base` variant
(the *Salvage* campaign) — the *correct*, ground-truth build the case is judged against.
It
is a self-contained static web app: plain **TypeScript** rendering to an **HTML5 canvas**,
bundled with **Vite**. No backend, accounts, network calls, or API keys; everything needed
to play is in the built bundle.

## The assets are produced, not pre-made

Arc Foundry is a **full-stack** case: every sprite, animation, particle effect, and sound
the game plays was **produced during the build** with the six asset-generation tools on
the
run image's `PATH` (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
`music`)
and committed under [`assets/`](assets/) — see the case's `specs/assets.md`, whose
electrical-VFX section is the headline. At runtime the game only *loads* those committed
files; the tools are not invoked by the build. The particle bursts are played live through
**`@test-cabinet/particle-runtime`** (vendored under [`vendor/`](vendor/) so a plain
`npm ci` resolves it outside the monorepo), and the sounds through the Web Audio API.

## Controls

- **Pick a map, then a difficulty** — the campaign start opens a **map select** (three
  topologies) and then a **difficulty select** (Easy / Medium / Hard — wave count + enemy
  toughness only); choose to play the run.
- **Stamp** — **B** / the **STAMP** button arms a **blank rock** on the cursor;
  **click** a
  legal spot on the yard to drop it (it rolls its component on landing), and the press
  re-arms so you can keep placing. `Esc` / right-click cancels a held rock for free.
- **Keep (harvest — sends the wave)** — **click** a placed candidate to select it, then
  **K** promotes it to this level's one firing tower and **launches the wave** at once
  (the rest harden into blockers). There is no reversible/deferred keep — compare all
  rolls first, then commit.
- **Combine (immediate, any time)** — **C** combines the current selection: a matching
  quality pair one tier up, or a recipe into a **combination tower** (or click a named
  **COMBINE SPECIAL** combo button to pick a specific recipe). **Shift-click** extra
  pieces to choose exactly which copies fold. Combines resolve at once, land at the piece
  you trigger from (so they can replace a standing tower), and are allowed **during a live
  wave**. A fold that spends a fresh roll is the harvest and launches the wave.
- **Downgrade (harvest — sends the wave)** — **G** (or the **DOWNGRADE ‹tier›** button)
  keeps the selected **candidate** one quality tier lower and launches the wave, for
  recipe flexibility when the press over-rolled; fold the lowered tower into a recipe with
  a standing COMBINE during the wave. Applies only to this level's fresh rolls, not
  standing towers.
- **Upgrade (any phase)** — **U** is contextual: with a **combination tower** selected it
  upgrades that combo one level (combos land weak at level 0 and climb to level 3 with
  Charge); otherwise it buys the next **Refinement** level, biasing future rolls upward.
  Both are allowed during a live wave.
- **Targeting** — select a firing component and press **T** (or the panel button) to cycle
  its target priority (First / Last / Nearest / Strongest / Weakest).
- **Sending a wave** — there is **no SEND button**: committing your harvest (KEEP /
  DOWNGRADE / fresh-consuming COMBINE) launches the wave. Build phases are **untimed** —
  no countdown, no early-send bonus; every level must harvest one tower to proceed.
- **Pause in place** — the status-bar **❚❚** control, or **Space** once a wave is live,
  freezes ticks **without** a menu; press again to resume. In the build phase Space does
  nothing.
- **Speed** — **F** cycles 1× / 2× / 4× / 8×. **Esc** cancels a held rock / deselects,
  otherwise opens
  the pause **menu** (also freezes the board). **M** mutes.
- **HUD readouts** — the status bar shows the **maze length** (how long the ground route
  the Load walks is, in tiles); **hover** it to draw the full path on the yard (air units
  ignore the maze). The scrap-press shows the **current quality-roll odds** for the next
  rock at your Refinement level. When a candidate can (or does) combine, the pieces that
  will fold **pulse** on the board.
- **Overlays** — **V** / the **COMBOS** button toggles the combination-tower **recipe
  book**; **L** / the **DMG BOARD** button toggles the **live tower damage leaderboard**
  (updates in real time). Both are read-only.
- Every menu is fully operable with the mouse; `↑`/`↓` + `Enter` are keyboard
  alternatives.

There is **no selling and no slag** — rocks and components are permanent.

## Develop, build, and run

```bash
npm ci            # install (requires the committed package-lock.json)
npm run dev       # Vite dev server
npm run build     # type-check + produce the static site into dist/
npm run preview   # serve the production build locally
```

`npm run build` emits a fully self-contained static site into `dist/` with an `index.html`
at its root. The bundler base is relative (`base: "./"`), so `dist/` runs correctly when
served from any base path, including a per-run sub-path.

## Layout

- [`src/`](src/) — the game. `constants.ts` (stats/palette + the `deriveStats` component
  model, the scrap-press roll odds + Refinement track), `mode.ts` (the campaign start),
  `board.ts` (the map catalog, ordered-waypoint pathing + 4-tile platforms + placement
  legality), `waves.ts` / `sim.ts` (the fixed-step simulation: the place-a-rock /
  keep-one / combine / upgrade-quality GemTD loop, the Load mazing, and the components
  firing), `assets.ts` / `audio.ts` / `particles.ts` (loading and playing the produced
  art,
  sound, and effects), `render.ts` (all drawing + the HUD / build panel), `input.ts` +
  `main.ts` (input and the loop).
- [`sim/`](sim/) — a headless, deterministic **balance harness** (dev-only, excluded from
  the build): `npx tsx sim/run.ts` runs a battery of strategies and checks the balance
  goals
  (competent play wins Easy/Medium; degenerate strategies lose). See
  [`sim/README.md`](sim/README.md).
- [`assets/`](assets/) — the produced sprites, sprite-sheet frames, particle systems, and
  audio.
- [`vendor/particle-runtime/`](vendor/) — a vendored, prebuilt copy of
  `@test-cabinet/particle-runtime`.
- [`scripts/`](scripts/) — the asset-generation scripts (`gen-*.sh`) that produce the
  sprites, sprite-sheets, particle systems, and audio under `assets/`.
