# Valence

**Valence** is a chemistry-themed **tower-defense** game for the browser. Unstable
**matter** streams out of an **inlet** and flows along a fixed branching **conduit**
toward a **collector**; you stop it by placing **emitter towers** at the fixed nodes
beside the conduit and breaking the matter down before it escapes. Every unit that
reaches the collector costs **integrity**; every unit you neutralize releases the
**energy** that pays for more towers.

Its defining idea is that matter does not decompose along one ladder — it comes in
genuinely different **forms**, each opened by a different tool:

- A **molecule** is a bonded cluster of atoms. A **Shear** snaps its bonds so it
  fragments into its constituent **atoms**.
- A free **atom** carries **electron shells**. An **Ionizer** strips one shell per hit;
  a fully stripped atom is **neutralized**.
- A **heavy nucleus** is bound too tightly to shear or ionize. Only a **Fission** tower
  cracks it, splitting it into two lighter **daughter atoms**.
- **Inert (noble)** matter is untargetable until a **Catalyst** makes it reactive, and a
  **Moderator** damps matter to buy time.

Spend energy across an escalating **20-round campaign** that ends in a fragmenting
**Macromass** boss; survive every round and you win, run out of integrity and you lose.

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

- **Build** — click a tower in the shop (or press **1**–**5**), then click an empty node.
  `Esc` / right-click leaves build mode.
- **Select / upgrade / sell** — click a built tower to select it; **U** upgrades, **S**
  sells (or use the inspector buttons).
- **Start / send round** — **Space** or the panel button. Before Round 1 the build phase
  is untimed; between rounds it also sends the next round early for a bonus.
- **Speed** — **F** cycles 1× / 2× / 3×. **Esc** pauses. **M** mutes.
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

- [`src/`](src/) — the game. `constants.ts` (stats/palette), `mode.ts` (the campaign
  start), `board.ts` (conduit geometry + nodes), `matter`/`waves`/`sim.ts` (the
  fixed-step simulation and decomposition model), `assets.ts` / `audio.ts` /
  `particles.ts` (loading and playing the produced art, sound, and effects),
  `render.ts` (all drawing + HUD), `input.ts` + `main.ts` (input and the loop).
- [`assets/`](assets/) — the produced sprites, sprite-sheet frames, particle systems,
  and audio.
- [`vendor/particle-runtime/`](vendor/) — a vendored, prebuilt copy of
  `@test-cabinet/particle-runtime`.
- [`scripts/proof.mjs`](scripts/proof.mjs) — captures the `proof/` artifacts with the
  project-local Playwright.
- [`proof/`](proof/) — the proof-of-implementation captures (`specs/proof.md`).
