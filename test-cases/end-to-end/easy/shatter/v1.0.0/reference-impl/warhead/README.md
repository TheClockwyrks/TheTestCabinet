# Shatter — Warhead

The **Warhead** variant of Shatter. It is the standard neon gravity-well rock
shooter — inertial flight, the central star that pulls every bullet and rock,
escalating waves, the hunting saucer, lives and respawns, and the full state
machine — with **two additions** that change how you clear the field:

- **Armored rocks.** Rocks now have **health** by size — a Large takes **3**
  bullet hits, a Medium **2**, a Small **1**. A non-fatal hit flashes the rock
  and cracks it (it reads hotter and more broken the closer it is to breaking)
  but does **not** split it; only the hit that drops its health to zero shatters
  and scores it. Split fragments and star-recycled rocks re-enter at full health.
- **A homing torpedo.** Secondary fire (**`F`**) launches a single guided
  torpedo on a **10-second recharge** (at most one stored, one in flight; the
  recharge shows in the HUD and keeps counting through a respawn). It leaves the
  nose straight, then homes onto the nearest rock or saucer within a narrow
  **±15° forward cone** at a limited turn rate, and — being self-propelled —
  flies **true through the gravity well** instead of curving like a bullet. It
  **ignores armor**: it destroys any rock in one hit and blasts the fragments
  outward far harder than a bullet shatter. It is absorbed by the star core.

Everything else matches the base game: the ship, inertial flight, the gravity
well, screen wrap, bullets, waves, the saucer, scoring (Large 20, Medium 50,
Small 100, saucer 200), lives and the 10,000-point extra ship, and the title /
how-to-play / pause / game-over states.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys; everything needed to play is in the built bundle. It is the authored
**reference implementation** of Shatter's **Warhead** variant: the correct
build, shown on the case's Reference tab. It is never seeded into a run.

## Controls

| Action | Keys |
| --- | --- |
| Rotate | `←` / `→` or `A` / `D` |
| Thrust | `↑` or `W` |
| Fire (primary) | `Space` |
| Fire torpedo (secondary) | `F` |
| Pause | `Esc` or `P` |
| Menu navigation | `↑` / `↓` (or `W` / `S`) |
| Confirm | `Enter` or `Space` |
| Back | `Esc` |
| Mute / unmute audio | `M` |

**Armored rocks:** clearing a single Large with the primary gun alone costs
`3 + (2 × 2) + (4 × 1) = 11` hits — which is why the torpedo matters. Watch a
rock's cracks and glow to judge how many hits it has left.

**The torpedo:** fire it down a lane of rocks or into a saucer. It flies straight
until a target falls into its forward cone, then curves onto it — and, unlike a
bullet, it does not bend around the star, so you can drive it straight past the
well.

**Gravity:** shots fired near the star bend — you can curve a bullet around it to
strike a rock on the far side. Rocks orbit on curved paths and wrap at the edges.
The torpedo, the ship, and the saucer are powered and fly free of the pull.

**Lives:** you start with three ships. Losing one respawns the next at the safe
point below the star with a brief invulnerability; an extra ship is granted at
each 10,000-point threshold; the game ends at zero lives.

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
  constants.ts        Palette, geometry, physics + armor/torpedo constants
  types.ts            Shared entity types (Rock now carries armor; Torpedo)
  entities.ts         The Ship class and rock/saucer factories
  input.ts            Keyboard: held flight state (incl. F) + edge events
  audio.ts            Web Audio sounds (optional, mutable)
  physics.ts          Wrap, the gravity well, swept collision, angle helpers
  game.ts             State machine, waves, scoring, lives, saucer, armor,
                      the torpedo (launch, homing, recharge), collisions
  render.ts           All canvas drawing (neon-on-charcoal, damage + torpedo)
```
