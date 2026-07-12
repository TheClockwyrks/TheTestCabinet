# Valence

## Overview

**Valence** is a chemistry-themed **tower-defense** game for the browser. Unstable
**matter** streams out of an **inlet** and flows along a fixed **conduit** toward a
**collector**; you stop it by placing **emitter towers** at the fixed nodes beside the
conduit and breaking the matter down before it escapes. Every unit that reaches the
collector costs you **integrity**; every unit you neutralize releases the **energy**
that pays for more towers.

Valence's defining idea is that matter does not decompose along one "pop a layer"
ladder — it comes in genuinely different **forms**, each opened by a different tool:

- A **molecule** is a bonded cluster of atoms. A **Shear** tower snaps its bonds so it
  fragments into its constituent **atoms**, which travel on independently — one molecule
  becoming a spray of faster atoms.
- A free **atom** carries **electron shells**. An **Ionizer** strips one shell per hit;
  a fully stripped atom is **neutralized**. A bonded atom's electrons are engaged in its
  bonds, so an atom cannot be ionized until it is sheared free of its molecule.
- A **heavy nucleus** is bound too tightly to shear or ionize. Only a **Fission** tower
  cracks it, splitting it into two lighter **daughter atoms** that ionizers then finish.

Two support towers change what the damage towers can reach: a **Catalyst** makes
**inert** matter reactive (it is untargetable until then), and a **Moderator** damps
matter to buy time. You spend energy across an escalating **round campaign** that ends
in a fragmenting **boss**; survive every round and you win, run out of integrity and you
lose. It is inspired by lane-defense games but is entirely its own, with an original
name, an atomic-diagram look, the decomposition model, and its own matter and towers.
Do not reproduce the assets, branding, characters, or exact design of any existing game.

**You also produce the game's art, effects, and audio yourself.** Valence ships with
**no** pre-made sprites, effects, or sounds. The run image puts six asset-generation
tools on your `PATH`, and you must author every asset the game plays — the matter and
tower sprites, the orbiting-electron and boss animations, the decomposition particle
bursts, and the sound and music — with those tools during this build. The full contract
for what to produce and how to wire it in is `specs/assets.md`; read it as carefully as
the simulation specs.

## How the specification is organized

This specification is split across several files. Read **all** of them before you start;
they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the stage layout, the palette and type, and the visual design.
- `specs/board.md` — the board: the conduit tracks (the inlet, the fork into two lanes,
  the merge, and the collector), how matter is split across the lanes, the fixed emitter
  nodes, tower range and coverage, and the top status bar and right build panel.
- `specs/matter.md` — the matter: the forms (molecule, atom, inert atom, heavy nucleus),
  the matter types and their stats, the three-axis decomposition model, and how a wave is
  built. **Read this carefully.**
- `specs/towers.md` — the five towers (Ionizer, Shear, Fission, Catalyst, Moderator),
  their stats, targeting, and how you build, upgrade, and sell them.
- `specs/controls.md` — the mouse and keyboard controls: selecting nodes, building,
  upgrading and selling towers, starting rounds, game speed, and pause.
- `specs/flow.md` — the economy, integrity, the round progression and victory, scoring,
  the game states, the required menus, the HUD, and what is out of scope.
- `specs/assets.md` — the **asset-production contract**: every asset you must produce
  with the on-`PATH` tools, where each lands, and how each is wired into the build.
  **Read this carefully.**
- `specs/proof.md` — the proof-of-implementation captures the finished build must write.
- `specs/mode.md` — the campaign start this run plays and its main-menu entry. Implement
  the start it defines; the main menu lists that start, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser. This is
a substantial front-end task: a fixed-step real-time simulation of matter flowing along
branching tracks, fixed-node tower placement with automatic targeting, a three-axis
decomposition model with five interacting towers, an economy of energy, interest, and
integrity, an escalating round campaign with a fragmenting boss, multiple game states and
menus, and a HUD — **and** a full pass of producing the game's art, effects, and audio
with the on-`PATH` tools. Aim for a build a person would actually want to play — tense,
legible, and alive — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or positioned
  DOM elements. A text-only or ASCII rendering does not satisfy this requirement.
- **Produces its own assets.** Every sprite, animation, particle effect, and sound the
  game plays must be **produced during this build with the six tools on your `PATH`**
  (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`), per
  `specs/assets.md`. Do not ship placeholder rectangles, ad-hoc code-drawn art in place
  of a sprite, downloaded assets, or silence.
- **Runs in the browser with no backend.** No server, accounts, database, or network
  calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a `package.json`
  at its root, buildable with **only Node.js and npm-installed dependencies** (no
  separately installed language toolchain). **Commit a `package-lock.json`**: the build
  is installed with `npm ci`, which requires that lockfile. Running `npm ci` and then
  `npm run build` must produce the complete static site, with no further manual step,
  into one of `dist/`, `build/`, or `out/` at the project root, with an `index.html` at
  the root of that directory as the entry point. That output directory must run correctly
  when served as-is from a static file server **at any base path, not only the server
  root** — when it is played back it is mounted under a per-run sub-path (a path like
  `/runs/<id>/build/`), so every URL the build requests must resolve relative to the page
  rather than the origin root. `specs/assets.md` states the loading rule in full (no
  root-absolute `/…` URLs; a relative bundler base such as Vite's `base: './'`); it
  governs the produced assets and the bundled JS/CSS alike. You choose the language,
  framework, bundler, and rendering approach behind this interface; only the `npm ci` and
  `npm run build` commands and where the build output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining what the
  game is, how to install dependencies, how to run it in development, how to produce the
  static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a framework
is not required. Favor a clean, well-structured codebase over any particular technology.
**You design the exact geometry of the conduit and the placement of the fixed nodes**
(within the fixed topology and counts `specs/board.md` sets), the exact visual design of
the matter and towers, and how the board reads on screen — there is no pixel-exact layout
to reproduce, only the topology, stats, and behavior the specs pin.

## Coordinate system and presentation

All positions, sizes, and ranges in this document are given in **logical pixels** on a
fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the **top-left**; `x` increases
to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9 aspect
  ratio, letterboxed with the background color on the remaining space. The game must
  remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete `1280 x 720`
  area is visible at once — the full board, the top status bar, the right build panel,
  and all four edges — fitted to the window and centered, with nothing clipped or pushed
  past the edges. The build must fit correctly on load, before any input, and at any pixel
  density.

The stage is divided into three regions (`specs/board.md` details each):

- a **top status bar** — `y` in `[0, 56]`, full width — with energy, integrity, the round
  indicator, and the global speed/pause/mute controls;
- the **right build panel** — `x` in `[1000, 1280]`, `y` in `[56, 720]` — with the tower
  shop, the selected-tower inspector, the next-round preview, and the start/send control;
- the **board** — `x` in `[0, 1000]`, `y` in `[56, 720]` — the conduit, its nodes and
  towers, the matter, projectiles, and effects.

The status bar and build panel are fixed and always fully visible; the board fills the
rest. The whole board is on screen at once — there is no scrolling camera.

## Visual design

The look is **a reactor seen as an atomic diagram in the dark**: glowing conduits and
particle matter against a cold, near-black substrate, lit by the tools that break the
matter apart. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Deep field / void (background) | `#090d13` |
| Substrate (board fill) | `#10171f` |
| Conduit / track | `#22303e` |
| Conduit flow glow (direction of travel) | `#3d6b8c` |
| Emitter node (empty) | `#2b3d4e` |
| Energy (currency) | `#ffcf4a` |
| Integrity (containment) | `#46d6e6` |
| Free atom — element I | `#7fe0a0` |
| Free atom — element II | `#6cb6ff` |
| Electron shells | `#eaf3ff` |
| Molecular bond | `#93a6ba` |
| Inert / noble matter | `#c4cbd6` |
| Heavy nucleus (radioactive) | `#c7e14a` |
| Boss macromass | `#a45cff` |
| Ionizer (charge) | `#4aa6ff` |
| Shear (cleave) | `#ff8646` |
| Fission (nuclear) | `#ff5470` |
| Catalyst (reactive) | `#e267c8` |
| Moderator (damping) | `#46d6c2` |
| Alert / danger | `#ff5a52` |
| Panels / overlays | `#121821` |
| Primary text | `#e8eef5` |
| Secondary text | `#93a2b2` |
| Tertiary text / hints | `#5d6b7a` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not depend
  on a web font that must be downloaded; a system monospace stack is required so the game
  renders identically offline.
- Keep the board legible: a player must be able to tell the conduit from the substrate,
  an empty node from a built tower, and the direction matter is flowing, at a glance.
- **The matter's form must be unmistakable, and readable by more than color alone.**
  Which tool a unit needs is the core read of the game (`specs/matter.md`), so the four
  forms must be distinguishable by **shape** as well as color: a **free atom** as a
  nucleus with visible electron shells, a **molecule** as two or more atoms joined by
  bond sticks (ball-and-stick), a **heavy nucleus** as a dense, tightly-bound orb with a
  radioactive shimmer, and **inert** matter as a sealed, full-shelled orb. A player must
  be able to tell a molecule from a lone atom from a heavy from an inert unit at speed,
  and the HUD/next-round preview names the types in words as well
  (`specs/board.md`, `specs/flow.md`).
- **Each tower is color-coded** by its role (the five accent colors above), so a full
  board still reads as which tool sits where. **The damage towers turn to aim** — each
  head rotates to face what it is firing at, and every shot is a **visible projectile that
  carries the hit** to the target on impact (`specs/towers.md`, `specs/assets.md`).
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`, which is the contract for the sprites, animations, particle bursts,
  and audio, and how to load and wire each in. The HUD, build panel, menus, node
  highlights, range previews, and selection feedback all come from your code, in this
  palette.
- The three canonical screens — the title screen, the live board, and the
  containment-failed screen — are described in full under Game states in `specs/flow.md`
  (with the victory screen). Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative live-board frame, mid-round.
- `reference/game-over.png` — the containment-failed screen.

Treat them as **illustrative examples, not targets to reproduce**: they show one way the
screens can look, but design your own menus, board geometry, and layout rather than copy
them. The only firm requirement is that every menu and navigation path this specification
mandates is present, rendered in the palette and type the spec defines. They are images
only — and the exact conduit shape, node placement, tower mix, and matter positions they
show are just **one example moment**. Build the screens from this specification, and
design your own conforming board.
