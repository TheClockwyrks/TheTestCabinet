# Spectra

## Overview

**Spectra** is a fixed-position formation shooter for the browser. You pilot a
lone resonator-fighter along the bottom of the screen while a swarm of
crystalline drones flies in along sweeping paths, assembles into a hovering
formation overhead, then peels off to dive-bomb you. You clear each wave by
destroying every drone.

Spectra's defining idea is **polarity**. Your cannon is tuned to one of two
spectral bands — **Cyan** or **Magenta** — and you flip between them at will. A
shot only destroys a drone of the **matching** band, and your current band is
also your **shield**: enemy fire of your own band is absorbed harmlessly, while
fire of the opposite band is lethal. The swarm always holds **both** bands at
once, so the drone you want to shoot and the bullets you must survive constantly
pull your choice in opposite directions. Skilled play is about reading the
field's colors and flipping at the right instant, not just dodging and holding
fire.

Spectra is inspired by classic formation-shooter arcade games but is its own
game, with an original name, look, the dual-use polarity system, and its own
drones. Do not reproduce the assets, branding, characters, or exact design of any
existing game. In particular it **drops** the genre's most recognizable
hooks — there is no captured-ship-and-rescue and no side-by-side double
fighter; survival is about polarity, not power-ups.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/playfield.md` — the geometry of the stage: the player's lane, the
  formation grid and its sway, the entry and exit lanes, bullets, and the HUD
  layout.
- `specs/polarity.md` — the signature systems: the two bands, matching to
  destroy, the dual-use shield, what a mismatched shot does, and the resonance
  meter and discharge. **Read this carefully.**
- `specs/controls.md` — how the ship moves, the controls, firing, and the
  discharge control.
- `specs/enemies.md` — the three drones, how each enters, holds formation, and
  dives, how each behaves with polarity, and the Prism's spectral inversion.
- `specs/flow.md` — waves and stages, challenge stages, scoring, lives, stage
  scaling, the game states, the HUD, audio, and what is out of scope.
- `specs/assets.md` — the **provided art assets** (seeded under `assets/`): the
  ship and drone sprites you must render from, how to load them under any base
  path, how each entity's second band is derived at runtime, and what is left to
  draw in code. **Read this carefully.**
- the mode specs under `specs/modes/` — the playable mode(s) and the main-menu
  entry for each. Read every mode spec present and implement the modes they
  define. The main menu lists those modes, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a fixed-step
simulation, drones that fly choreographed entrance and dive paths, a hovering
formation, two-band polarity combat with a dual-use shield, three distinct drone
behaviors, multiple game states and menus, and a HUD. Aim for a build a person
would actually want to play — tense and readable — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  test case.
- **Runs in the browser with no backend.** No server, accounts, database, or
  network calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`, which requires that
  lockfile. Running `npm ci` and then `npm run build` must produce the complete
  static site, with no further manual step, into one of `dist/`, `build/`, or
  `out/` at the project root, with an `index.html` at the root of that directory
  as the entry point. That output directory must run correctly when served as-is
  from a static file server **at any base path, not only the server root** — when
  it is played back it is mounted under a per-run sub-path (a path like
  `/runs/<id>/build/`), so every URL the build requests must resolve relative to
  the page rather than the origin root. `specs/assets.md` states the loading rule
  in full (no root-absolute `/…` URLs; a relative bundler base such as Vite's
  `base: './'`); it governs the seeded sprites and the bundled JS/CSS alike. You
  choose the language, framework, bundler, and rendering
  approach behind this interface; only the `npm ci` and `npm run build` commands
  and where the build output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above — including the npm-driven static build, which fixes the
`npm ci` and `npm run build` commands and where the output lands, but not how you
implement the build behind them. Plain TypeScript with Canvas 2D is entirely
sufficient; a framework is not required. Favor a clean, well-structured codebase
over any particular technology. **You design the drones' entrance choreography,
the formation layout, and the dive paths** (within the constraints in
`specs/playfield.md` and `specs/enemies.md`) — there is no fixed set of paths to
reproduce.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in **logical
pixels** on a fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the
**top-left**; `x` increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — the full play field, both HUD strips, and
  all four edges — fitted to the window and centered, with nothing clipped or
  pushed past the edges. The build must fit correctly on load, before any input,
  and at any pixel density.

The stage is divided into a **top HUD strip** (`y` in `[0, 64]`), the **play
field** (`y` in `[64, 656]`, full width), and a **bottom HUD strip** (`y` in
`[656, 720]`). All drones, the player ship, and every bullet live inside the play
field; the HUD strips are described in `specs/playfield.md` and `specs/flow.md`.

## Visual design

The look is **cold neon against deep space**: luminous drones and bullets glowing
out of a near-black void, with the two spectral bands — cyan and magenta — as the
dominant, deliberately opposed colors. The canonical palette and type are below;
match them.

| Element | Color |
| --- | --- |
| Void background | `#05060f` |
| Faint starfield | `#283250` |
| Panels / overlays | `#0b1020` |
| Cyan band (drones, bullets, your cyan tuning) | `#34e2ff` |
| Magenta band (drones, bullets, your magenta tuning) | `#ff4ec7` |
| Player ship hull | `#eaf0fb` |
| Resonance meter / discharge charge | `#ffd86b` |
| Discharge burst | `#ffffff` |
| Primary text | `#e8eef7` |
| Secondary text | `#8893ad` |
| Tertiary text / hints | `#4a5470` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do
  not depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- The ship, the drones, and every bullet have a soft neon glow against the void.
  A faint, mostly static starfield sits behind the play field for depth; keep it
  dim enough that it never competes with the drones or bullets for attention.
- **The two bands must be unmistakable, and readable by more than color alone.**
  Cyan and magenta are the core read of the game, so in addition to the colors
  above, give each band a distinct **shape accent or glyph** (for example a ring
  motif for cyan and a diamond motif for magenta) carried on the player's polarity
  indicator and echoed on drones and bullets, so a colorblind player can still
  tell the bands apart. Pick one convention and use it consistently everywhere a
  band appears.
- **The ship and the drones are provided as pre-drawn sprites** seeded under
  `assets/`, and you must render them from that art rather than drawing your own
  fighter or drones — see `specs/assets.md`, which is the contract for the sprites,
  their per-band derivation (the ring/diamond convention above applied to the art),
  and how to load them. Bullets, effects, the starfield, and the HUD have no sprite
  and you draw them in code in this palette.
- The three canonical screens — the title screen, the in-wave view, and the
  game-over screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-wave frame, mid-assault.
- `reference/game-over.png` — the game-over screen.

Treat them as **illustrative examples, not targets to reproduce**: they show one
way the screens can look, but design your own menus and layout rather than copy
them. The only firm requirement is that every menu and navigation path this
specification mandates is present, rendered in the palette and type the spec
defines. They are images only — and the formation, paths, and bullet positions
they show are just **one example moment**. Build the screens from this
specification, and design your own conforming choreography.
