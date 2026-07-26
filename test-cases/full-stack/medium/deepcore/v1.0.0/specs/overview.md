# Deepcore

## Overview

Deepcore is a subterranean dig-and-build game for the browser. You are a lone
prospector stranded on Vhera Deep, a dead mining world. Your dropship is wrecked
on the surface and the only way off the rock is to build an escape rocket at the
derelict launch pad. You fabricate the rocket's standard parts at the surface for
Credits, which you earn by digging ore out of the ground and selling it. Three of
its components need exotic materials that exist only far below, and the last needs
an unstable core sample cut from the planet's molten heart and hauled back up
before it detonates. Dig down, get rich, gear up, go deeper, and fly home.

The loop that drives the whole game is a fuel-budgeted descent: dig down, fill
your cargo with ore, jetpack back to the surface, sell, upgrade, and dig deeper.

Digging down is cheap. You drill through a tile and fall through the tunnel you
carve. Climbing back up burns jetpack fuel, and fuel is bought at the surface: an
empty climb is fast and cheap, while a heavy haul climbs slowly and burns far
more. Every trip is a gamble on depth. Go deep enough to reach the richer ore, the
rarer gemstones, and the exotic materials, but keep enough fuel and hull to make
it home. Run dry or get destroyed down a hole and the trip is lost
(`specs/character.md`, `specs/modes.md`).

The prospector is a character, not a vehicle: a suited miner with a handheld drill
and a jetpack. How believably that character moves and animates is half of what
this build is about. The mine is built from large tiles; the miner fits comfortably
within a single tile and drills the tile ahead of them (`specs/character.md`,
`specs/world.md`).

The win condition is the rocket. Five components must be fabricated and installed
at the launch pad. Two are bought with Credits alone, two need an exotic material
mined from a specific depth band, and the last needs the Core Sample from the very
bottom (`specs/rocket.md`). Because the deep parts cannot be bought, you cannot win
by strip-mining the shallows; you must delve. Installing all five and launching
wins the game.

You also produce the game's art, effects, and audio yourself. Deepcore ships with
no pre-made sprites, effects, or sounds. The run image puts six asset-generation
tools on your `PATH`, and you author every asset the game plays with those tools
during this build, above all the animated miner character across its full set of
motion states (idle, walk, drill, jetpack-ascend, fall, hurt, out-of-fuel). The
full contract for what to produce and how to wire it in is `specs/assets.md`; the
produced character animation is half of what this build is about.

## How the specification is organized

This specification is split across several files. Read all of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` is this file: the pitch, the fiction, goals, hard
  requirements, free choices, the coordinate system, the stage layout, the palette
  and type, and the visual design.
- `specs/world.md` is the mine: the tile grid and coordinate system, the both-axis
  camera over a mine wider than the viewport, the chosen world size (Quick /
  Standard / Marathon, which scales only how deep the dig is), the four depth bands
  and the Core chamber, every tile kind (earth, rock, deepstone, coreshell, bedrock
  border, unbreakable stone, ore vein, material node, gas pocket, lava, empty
  tunnel), how ore, materials, hazards, and stone are placed (guaranteed in their
  band, random position), and the surface with its six buildings.
- `specs/character.md` is the prospector: fall, jetpack, and lateral movement, the
  fixed rule that you drill down, left, and right but never up, dig speed vs tile
  hardness, single-tile collision, the fuel consumption model, hull and damage, the
  weight-and-lift model (heavier hauls climb slower and, overloaded, cannot lift,
  with dropping ore from the inventory as the escape valve), the radiator's damage
  reduction, and the full set of animation states.
- `specs/mining.md` is the ore economy: the ore types, their values and weights per
  band, the slot-limited cargo bay (with weight the jetpack must lift), the
  inventory for dropping ore, the three exotic materials (mid, deep, core) and the
  scanner that locates them, and selling.
- `specs/hazards.md` is the underground hazards: gas pockets (rare but a deadly
  explosion, countered by hull), lava (contact damage, and drillable at a heavy hull
  cost the radiator softens), fall impact, and the unstable Core Sample and its
  destabilization timer and detonation.
- `specs/upgrades.md` is the upgrade shop: the seven upgrade tracks (fuel tank,
  drill, cargo bay, hull, jetpack, radiator, scanner), their tiers, and their
  prices.
- `specs/rocket.md` is the escape rocket you build to win: its five components,
  what each costs and which exotic material it needs, the launch pad, fabrication,
  and victory.
- `specs/gameplay.md` is the single expedition this build plays (its `NEW EXPEDITION`
  main-menu entry, the mode-select-to-world-size flow, and the start conditions), the
  economy (Credits, selling, buying, fabricating), the surface loop and refuel/repair,
  saving and continuing (the Save Pad and single slot), and scoring.
- `specs/ui.md` is the game state machine, the required menus and building panels, the
  HUD, and what is out of scope.
- `specs/modes.md` is the two modes, Standard and Hardcore, chosen at an in-game
  menu: they change only what happens when you die (Standard lets you restore from
  your last save; Hardcore deletes it and ends the run), nothing else.
- `specs/controls.md` is the fixed-timestep simulation and the keyboard and mouse
  controls: moving and drilling, jetpack thrust, opening the surface buildings, the
  field-supply hotkeys and the Core Sample jettison, pause, and mute.
- `specs/items.md` is the six single-use field supplies (explosives, teleporters,
  nanobots, emergency fuel) bought at the Supply Depot and used in the mine, and the
  Core Sample jettison with its ground item (a one-way discard, not re-collectable)
  and location-aware detonation.
- `specs/assets.md` is the asset-production contract: every sprite, animated sheet,
  particle system, sound, and music track you produce with the on-`PATH` tools,
  where each lands, and how each is wired in. The animated miner section is the
  centerpiece.
- `specs/instrumentation.md` is the debugging and automation surface: the
  deterministic steppable core, the `window.__deepcore` API to drive and inspect the
  game from code, and the read-only debug overlay.
- `specs/proof.md` is the proof-of-implementation captures the finished build writes.

## Goal of this build

Produce a complete, polished, playable game that runs entirely in a browser. This
is a substantial front-end task: a fixed-step real-time simulation of a character
digging and falling and thrusting through a tiled mine over a vertical camera, a
fuel and hull economy, an ore-and-Credits economy with an upgrade shop, a
guaranteed-but-hidden exotic-material hunt with a scanner, underground hazards, a
five-component rocket build that is the win condition, two death modes, three
selectable world sizes (which scale the mine's depth), multiple game states and
menus, and a HUD, and a full pass of producing the game's art, effects, and audio
with the on-`PATH` tools, the animated miner above all. Aim for a build a person
would actually want to play: tense, legible, and alive, not a tech demo.

### Hard requirements

- Renders real graphics. Draw the game with Canvas 2D, WebGL/WebGPU, or positioned
  DOM elements. A text-only or ASCII rendering does not satisfy this requirement.
- Produces its own assets. Every sprite, animation, particle effect, and sound the
  game plays must be produced during this build with the six tools on your `PATH`
  (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`), per
  `specs/assets.md`. Do not ship placeholder rectangles, ad-hoc code-drawn art in
  place of a sprite, flat flashes in place of the produced particle VFX, downloaded
  assets, or silence.
- Exposes the `window.__deepcore` debugging and automation API and the read-only
  debug overlay described in `specs/instrumentation.md`, backed by the
  deterministic, steppable core it and `specs/controls.md` require. This is a
  required part of the build.
- Runs in the browser with no backend. No server, accounts, database, or network
  calls at runtime. Everything needed to play must be self-contained.
- No API keys or credentials of any kind to build, run, or play.
- npm-driven static build. The project must be a Node project with a `package.json`
  at its root, buildable with only Node.js and npm-installed dependencies (no
  separately installed language toolchain). Commit a `package-lock.json`: the build
  is installed with `npm ci`, which requires that lockfile. Running `npm ci` and
  then `npm run build` must produce the complete static site, with no further manual
  step, into one of `dist/`, `build/`, or `out/` at the project root, with an
  `index.html` at the root of that directory as the entry point. That output
  directory must run correctly when served as-is from a static file server at any
  base path, not only the server root. When it is played back it is mounted under a
  per-run sub-path (a path like `/runs/<id>/build/`), so every URL the build
  requests must resolve relative to the page rather than the origin root.
  `specs/assets.md` states the loading rule in full (no root-absolute `/…` URLs; a
  relative bundler base such as Vite's `base: './'`); it governs the produced assets
  and the bundled JS/CSS alike. You choose the language, framework, bundler, and
  rendering approach behind this interface; only the `npm ci` and `npm run build`
  commands and where the build output lands are fixed.
- Documentation. Include a `README.md` in the produced repository explaining what
  the game is, how to install dependencies, how to run it in development, how to
  produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase over any
particular technology. You design the exact visual identity of the miner and its
animations, the tiles of each depth band, the ore and materials, the surface
buildings and the assembling rocket, the hazards, and the effects. There is no
pixel-exact layout to reproduce, only the grid, tile hardness, band depths, ore
values, prices, fuel and hull numbers, and behavior the specs pin. How the mine is
seeded within the rules `specs/world.md` sets (the exact tunnels, ore scatter, and
where each hazard and material lands) is yours to generate.

## Coordinate system and presentation

All positions, sizes, and ranges in this document are given in logical pixels on a
fixed 1280 x 720 stage (16:9). The origin `(0, 0)` is the top-left; `x` increases
to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- The whole stage must be on screen. At every window size the complete 1280 x 720
  area is visible at once: the full mine viewport and the top status bar, fitted to
  the window and centered, with nothing clipped or pushed past the edges. The build
  must fit correctly on load, before any input, and at any pixel density.

The stage is divided into two regions (`specs/world.md` details each):

- a top status bar, `y` in `[0, 56]`, full width, with Fuel, Hull, Cargo, Credits,
  the Depth readout, and the inventory (bag)/pause/mute controls;
- the mine viewport, `x` in `[0, 1280]`, `y` in `[56, 720]` (1280 x 664), a
  camera-followed view of the tiled world: the mine tiles, the carved tunnels, the
  ore and materials, the hazards, the surface buildings, the miner, and the effects.

The status bar is fixed and always fully visible. The viewport shows the world
through a camera that follows the miner in both axes. The mine is wider than the
viewport (about 16 of its 32 columns on screen at once), so the world scrolls
horizontally as well as vertically as the camera tracks the miner across and down
(`specs/world.md`). Surface buildings and menus open as overlays over the viewport,
not as a persistent side panel.

## Visual design

The look is subterranean industrial: a dim dusk sky over a scrapped surface camp,
and beneath it earth giving way to grey rock, black deepstone, and finally the
red-hot glow of the coreshell, lit by the warm spill of the miner's suit lamp and
jetpack, the amber glint of ore veins, and the angry orange of lava. The canonical
palette and type are below; match them.

| Element | Color |
| --- | --- |
| Deep field / void (letterbox) | `#05070a` |
| Dusk sky (surface backdrop) | `#1b2536` |
| Surface ground / camp | `#2c2620` |
| Topsoil earth (band 1 fill) | `#3a2c1f` |
| Rockbed (band 2 fill) | `#3a3d44` |
| Deepstone (band 3 fill) | `#20242c` |
| Coreshell (band 4 fill) | `#3a1512` |
| Core glow (band 4 accent) | `#ff6a2a` |
| Bedrock border (unminable) | `#0c0f14` |
| Unbreakable stone (obstacle) | `#4c5360` |
| Carved tunnel (empty) | `#0a0d12` |
| Tunnel edge / dirt lip | `#171b22` |
| Faint tile grid | `#ffffff14` |
| Ferron ore (common) | `#b8794a` |
| Cuprite ore | `#4fb0a0` |
| Argenite ore | `#cdd6e0` |
| Voltite ore | `#5a8cff` |
| Pyronium ore (deep) | `#ff8a3a` |
| Adamite ore (rare) | `#8affda` |
| Resonite (mid material) | `#4ad0ff` |
| Cryenite (deep material) | `#b98cff` |
| Core Sample (unstable) | `#ff4a2a` |
| Gas pocket | `#9ad24a` |
| Lava | `#ff5220` |
| Fuel (gauge) | `#ffcf4a` |
| Hull (gauge) | `#46d6e6` |
| Cargo (gauge) | `#c48a52` |
| Credits (currency) | `#ffd23a` |
| Miner suit / lamp | `#ffcf9a` |
| Jetpack flame | `#ffa63a` |
| Alert / danger | `#ff5a52` |
| Panels / overlays | `#141a20` |
| Primary text | `#e8eef5` |
| Secondary text | `#93a2b2` |
| Tertiary text / hints | `#5d6b7a` |

- Use a monospace type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is required
  so the game renders identically offline.
- Keep the mine legible: a player must be able to tell an unmined tile from a carved
  tunnel, one depth band's rock from another's, an ore vein from plain rock, a
  material node from ore, an unbreakable stone boulder from diggable rock, and lava
  from safe ground, at a glance. Gas is the deliberate exception: it is hidden in
  the dirt and betrayed only by a faint seep, a trap the player learns to read
  rather than one they simply see (`specs/world.md`, `specs/hazards.md`).
- The depth bands must read at a glance. As the camera descends, the surrounding
  rock must visibly change (warm topsoil, grey rockbed, black deepstone, red-glowing
  coreshell) so the player always knows how deep they are without reading the meter,
  and the danger escalates with the darkening, hotter rock (`specs/world.md`).
- The animated miner is the headline of this build. The prospector reads as a
  believable character, a suited figure with a drill and a jetpack, and animates
  distinctly for each thing it is doing: standing, walking, drilling down, drilling
  sideways, thrusting up on the jetpack, falling, taking a hit, and slumping out of
  fuel. These are produced sprite-sheet cycles you author with the on-`PATH` tools,
  played by the game as the miner acts (`specs/assets.md`, `specs/character.md`). A
  stiff, single-frame miner is a failed build.
- You produce the art, effects, and audio with the on-`PATH` tools. See
  `specs/assets.md`, which is the contract for the sprites, animations, particle VFX,
  and audio, and how to load and wire each in. The HUD, the building and menu chrome,
  the scanner indicator, the tile grid, the cargo/fuel/hull gauges, and selection
  feedback all come from your code, in this palette.
- The canonical screens (the title screen, the live mine, the surface with its
  buildings and the assembling rocket, and the end screens for Victory and the
  Hardcore Game Over) are described in full under Game states in `specs/ui.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` is the title screen and main menu.
- `reference/mine.png` is a representative live frame deep in a dig.
- `reference/surface.png` is the surface camp with a building panel open.
- `reference/game-over.png` is an end screen.

Treat them as illustrative examples, not targets to reproduce: they show one way the
screens can look, but design your own miner, tiles, buildings, and layout rather
than copy them. The only firm requirement is that every menu and navigation path
this specification mandates is present, rendered in the palette and type the spec
defines. They are images only; the exact mine, ore scatter, depth, and miner pose
they show are just one example moment. Build the screens from this specification.
