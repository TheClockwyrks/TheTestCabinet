# Valence

**Valence** is a chemistry-themed **tower-defense** game for the browser. Unstable
**matter** streams out of an **inlet** and flows along a fixed **path** toward a
**collector**; you pick a **map** at the start — an easy **single path**, a medium
**branching** fork of lanes, or a hard set of **multiple separate paths** (some maps
curved, some straight with right-angle corners) — and stop the matter by **freely placing**
**towers** beside the paths, Bloons-style, before it escapes. Every unit that reaches the
collector costs **integrity**; every unit you neutralize releases the **energy** that pays
for more towers.

Its defining idea is that matter is **hit points, damage types, and stackable traits** —
not a "one form, one counter" ladder. Every unit carries electron **shells** (its hit
points) — a regular **atom** is a single unit type carrying **1–6 electrons** (its layers)
rendered on two shells, each electron one hit point — and any of three damage types
(**energy**, **kinetic**, **nuclear**) strips them, gated only by a unit's **traits**:

- **Bonded** clusters wrap their atoms in an outer **bond pool** — extra health *any* tower
  chips through (kinetic fastest), shedding a spray of free atoms.
- **Heavy** matter is a **radioactive isotope**, **immune to energy**; only **kinetic or
  nuclear** cracks it — several towers can — and as it is worn down it **decays**, shedding
  alpha (6-electron) and beta (2-electron) atoms and transmuting into lighter isotopes.
- **Inert** matter is **untargetable until detected** (a Catalyst aura, a Reactor's Fallout
  zone, an Ionizer's Array branch, or a Beam natively). Traits **stack** late.

Seven general-purpose towers each deal a damage type and each choose one of two **upgrade
branches** at tier III; two are support auras (a **Catalyst** reveals + excites, a
**Moderator** slows). Spend energy across an escalating **40-round campaign** that ends in
a fragmenting **Macromass** boss; survive every round and you win, run out of integrity and
you lose.

This directory is the authored **reference implementation** of the case's `base`
variant (the *Containment* campaign) — the *correct*, ground-truth build the case is
judged against. It is a self-contained static web app: plain **TypeScript** rendering to
an **HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or API
keys; everything needed to play is in the built bundle.

## The assets are produced, not pre-made

Valence is a **full-stack** case: every sprite, animation, particle effect, and sound the
game plays was **produced during the build** with the six asset-generation tools on the
run image's `PATH` (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
`music`) and committed under [`assets/`](assets/) — see the case's `specs/assets.md`. At
runtime the game only *loads* those committed files; the tools are not invoked by the
build. The particle bursts are played live through **`@test-cabinet/particle-runtime`**
(vendored under [`vendor/`](vendor/) so a plain `npm ci` resolves it outside the
monorepo), and the sounds through the Web Audio API.

## Controls

- **Pick a map** — the campaign start opens a **map select** (single path / branching /
  multiple separate paths, curved or straight); choose one to play the run on it.
- **Build** — click a tower in the shop (or press **1**–**7**), then click any legal spot
  on the board — anywhere off the paths and clear of other towers (free, Bloons-style
  placement). `Esc` / right-click leaves build mode.
- **Select / upgrade / sell** — click a built tower to select it; **U** upgrades (at tier
  III, click one of the two **branch** buttons in the inspector), **S** sells.
- **Start / send round** — **Space** (while the build phase runs) or the panel button.
  Before Round 1 the build phase is untimed; between rounds it also sends the next round
  early for a bonus.
- **Pause in place** — the status-bar **❚❚** control, or **Space** once a round is live,
  freezes ticks **without** a menu while the board stays interactive (keep placing and
  upgrading towers on the still board); press again to resume.
- **Speed** — **F** cycles 1× / 2× / 3×. **Esc** opens the pause **menu** (also freezes the
  board). **M** mutes.
- Every menu is fully operable with the mouse; `↑`/`↓` + `Enter` are keyboard alternatives.

## Develop, build, and run

```bash
npm ci            # install (requires the committed package-lock.json)
npm run dev       # Vite dev server
npm run build     # type-check + produce the static site into dist/
npm run preview   # serve the production build locally
```

`npm run build` emits a fully self-contained static site into `dist/` with an
`index.html` at its root. The bundler base is relative (`base: "./"`), so `dist/` runs
correctly when served from any base path, including a per-run sub-path.

## Layout

- [`src/`](src/) — the game. `constants.ts` (stats/palette + the `deriveStats` tower model),
  `mode.ts` (the campaign start), `board.ts` (the map catalog, path geometry + free placement),
  `waves`/`sim.ts` (the fixed-step simulation: the hit-point / damage-type / stackable-trait
  model, detection, and the branch upgrades), `assets.ts` / `audio.ts` / `particles.ts`
  (loading and playing the produced art, sound, and effects), `render.ts` (all drawing + HUD),
  `input.ts` + `main.ts` (input and the loop).
- [`sim/`](sim/) — a headless, deterministic **balance harness** (dev-only, excluded from
  the build): `npx tsx sim/run.ts` runs a battery of controllers and checks the balance
  goals (energy-only / no-detection / never-upgraded / one-lane boards must lose; competent
  mixed play must win). See [`sim/README.md`](sim/README.md).
- [`assets/`](assets/) — the produced sprites, sprite-sheet frames, particle systems,
  and audio.
- [`vendor/particle-runtime/`](vendor/) — a vendored, prebuilt copy of
  `@test-cabinet/particle-runtime`.
- [`scripts/`](scripts/) — `gen-assets.sh`, which reproduces the committed `assets/` with
  the on-`PATH` asset tools.
