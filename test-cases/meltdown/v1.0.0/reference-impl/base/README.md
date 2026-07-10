# Meltdown

**Meltdown** is a thermal, open-field **tower-defense** game for the browser.
Waves of "surge" intruders pour through the intakes of a reactor floor and race
for the exhaust vents; you stop them with **emitter towers**. Your towers are
also **walls**, so there is no fixed path — you *build the maze* the surge must
walk, winding it the long way around so your guns have time to burn it down.

Meltdown's defining idea is **heat as power**. Every emitter fires harder the
hotter it runs, on an accelerating curve — feeble when cold (about `0.5x`),
roughly `3x` just under the redline — but push it to `100` heat and it **trips**
offline for three seconds, leaving a hole in your defense. Laying out the floor
is a thermal problem as much as a spatial one: keep your guns hot, but not so hot
they cut out. Two support structures sculpt that heat — a **Forge** that pours
heat into its orthogonal neighbours and a **Vent** that draws it away — and the
cryo **Rime** runs the rule *backward*: it slows the surge best while it stays
cold.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys; everything needed to play is in the built bundle.

## The floor

A fixed `1280 x 720` stage: the reactor floor on the left (a `50 x 36` grid of
`20 px` tiles) and the build panel on the right. The surge enters at the
**mid-left** and **mid-top** intakes and must cross to its **opposite** exhaust
(left→right, top→bottom, never the nearer one), so the maze must lengthen that
crossing to matter. You can never seal the floor: a placement that would strand
an intake or a walking unit is refused.

## Towers

Six emitters and two heat-movers:

| Tower | Role |
| --- | --- |
| **Arc** | Balanced workhorse; the tower to learn on. |
| **Stutter** | Rapid, low per-shot; trips the easiest — wants a Vent. |
| **Lance** | Long-range sniper; runs cold and cannot trip alone — wants a Forge. |
| **Bloom** | Area splash; heats fast in a packed chokepoint. |
| **Rime** | Cryo slow; slows hardest when **cold**, fades as it heats. |
| **Flak** | Anti-air **only**; dedicated flyer coverage. |
| **Forge** | Adds heat to each orthogonal emitter (asset in a lull, liability in a push). |
| **Vent** | Adds cooling to each orthogonal emitter; holds a hot gun under the redline. |

Each tower upgrades through three levels (stronger **and** hotter-running for
emitters) and sells back for a `70%` refund.

## The surge

Motes, fast Sprints, armoured Hulks, Swarm packs, maze-ignoring **Drift** flyers,
and the slow-immune **Core** boss on waves 10 and 20. Twenty waves; a leak costs
lives, `0` lives breaches the reactor, and clearing wave 20 wins.

## Controls

Mouse-driven, with keyboard accelerators.

| Action | Input |
| --- | --- |
| Arm a shop tower | Click the shop button, or `1`–`8` (shop order) |
| Place / select | Left-click the floor |
| Keep placing the same type | Hold `Shift` while placing |
| Cancel placement / deselect / pause | Right-click, or `Esc` |
| Upgrade selected | Inspector **Upgrade** button, or `U` |
| Sell selected | Inspector **Sell** button, or `S` |
| Send next wave (early bonus) | **Send Next Wave** button, or `Space` |
| Game speed `1x` / `2x` | Speed toggle, or `F` |
| Pause | **Pause** button, or `P` / `Esc` |
| Menu navigation | Mouse, or `↑` / `↓` + `Enter` |

## Requirements

- Node.js 18+ and npm. No other toolchain is needed.

## Install

```sh
npm ci        # or: npm install
```

## Run in development

```sh
npm run dev
```

Vite serves the game with hot-reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root. Serve that directory as-is from any static file
server:

```sh
npm run preview        # serves dist/ locally for a final check
```

## Project layout

```
index.html            Vite entry; hosts the <canvas>
vite.config.ts        Build config (emits to dist/)
src/
  main.ts             Bootstrap: canvas fit/letterbox + fixed-timestep loop
  constants.ts        Geometry, palette, heat/economy constants (logical 1280x720)
  types.ts            Shared types
  defs.ts             Tower & surge definitions + per-level derived stats
  colors.ts           The heat-ramp colour helpers
  grid.ts             Floor grid, Dijkstra pathing, the can't-seal rule
  towers.ts           Tower entity: heat state, derived stats, coupling caches
  surge.ts            Surge unit: maze steering, flyer flight, slows
  waves.ts            The 20-wave composition
  input.ts            Mouse + keyboard, mapped to logical space
  ui.ts               Build-panel layout (shared by render + hit-testing)
  game.ts             State machine, economy, the fixed-step simulation, input
  render.ts           All canvas drawing (industrial floor lit by heat)
```
