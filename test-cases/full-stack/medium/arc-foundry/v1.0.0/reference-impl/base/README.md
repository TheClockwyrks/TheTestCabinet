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
  roll happens on placement, weighted low). Placing costs **10 Charge** and one of the
  level's five stamps; the cap is 5 regardless of how much Charge you hold. Placement is
  **continuous** — you keep dropping rocks back-to-back until the allowance or Charge runs
  out. Cancelling a held rock (Esc / right-click) is free (no roll, no cost).
- **Keep exactly one per level.** Each placed rock is a **candidate**: it walls the Load's
  route and shows its rolled type + quality, and you **KEEP** exactly one of them to
  promote
  it into a firing **component**. Every rock you do **not** keep hardens into an inert
  **blocker** (a 2×2 rock wall that never fires — the maze material). Keeping or
  combining is
  the level's single commit; then you SEND and the mobs enter.
- **Combine** two candidates (or a candidate and an existing component) of the **same
  type +
  same quality** into one a **tier higher** on the ladder Scrap → Tuned → Charged →
  Primed →
  Tesla-Prime — that counts as the level's keep. Combining is the direct climb.
- **Upgrade Quality** — spend Charge to raise your run's **Refinement** level (R0 → R5),
  biasing every future roll toward the higher tiers. Refinement is the odds; combining
  is the
  climb.

Every component, candidate, and blocker is a **2×2 wall**; the Load pathfinds the shortest
**open** route around them between the ordered **4-tile waypoint platforms** (walkable but
never buildable, so a waypoint can never be walled off), and a placement that would seal a
segment is refused. Air units (the **Filament** flyer, which ignores the maze) only appear
**every 4th wave**; a **Dynamo** boss anchors the milestone waves. Difficulty changes only
the **wave count and enemy toughness**. Survive every wave with integrity left and you
win;
run out of integrity and the grid overloads.

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
- **Keep / combine** — **click** a placed candidate to select it, then **K** keeps it
  (this
  level's one firing tower) or **C** combines it with a matching partner (one tier
  higher).
  Only one keep/combine per level; the rest harden into blockers at SEND. Reversible until
  you send.
- **Upgrade Quality** — **U** / the **UPGRADE** button spends Charge to raise your
  Refinement
  level, biasing future rolls upward.
- **Targeting** — select a firing component and press **T** (or the panel button) to cycle
  its target priority (First / Last / Nearest / Strongest / Weakest).
- **Start / send wave** — **Space** (during the build phase) or the panel button. Build
  phases are **untimed** — there is no countdown and no early-send bonus; SEND when ready.
- **Pause in place** — the status-bar **❚❚** control, or **Space** once a wave is live,
  freezes ticks **without** a menu; press again to resume.
- **Speed** — **F** cycles 1× / 2×. **Esc** cancels a held rock / deselects, otherwise
  opens
  the pause **menu** (also freezes the board). **M** mutes.
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
- [`scripts/proof.mjs`](scripts/proof.mjs) — captures the `proof/` artifacts with the
  project-local Playwright.
- [`proof/`](proof/) — the proof-of-implementation captures (`specs/proof.md`).
