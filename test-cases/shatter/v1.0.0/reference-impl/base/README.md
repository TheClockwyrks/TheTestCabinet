# Shatter

**Shatter** is a neon, top-down space-rock shooter for the browser, built around
a central **gravity well**. A star fixed at the middle of the field pulls on
everything that flies ballistically — every bullet and every rock — so your
shots bend around it and the rocks churn on curved, wrapping paths. Your ship
and the enemy saucer are powered craft that fly free of the pull, so the star
never wrests the ship out of your hands; it only *shapes the board*.

Fly under pure momentum, shoot rocks to shatter them into smaller ones, clear
each wave for a denser and faster one, and outlast the hunting saucer. The star's
core is solid but not lethal — the ship slides along it — and any rock the star
swallows is recycled back in from the edge, so the field keeps churning without
ever emptying.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys; everything needed to play is in the built bundle. It is the *reference
implementation* of Shatter's **base** variant: the authored, correct build of
the standard endless arcade game.

## Controls

| Action | Keys |
| --- | --- |
| Rotate | `←` / `→` or `A` / `D` |
| Thrust | `↑` or `W` |
| Fire | `Space` |
| Pause | `Esc` or `P` |
| Menu navigation | `↑` / `↓` (or `W` / `S`) |
| Confirm | `Enter` or `Space` |
| Back | `Esc` |
| Mute / unmute audio | `M` |

**Gravity:** shots fired near the star bend — you can curve a bullet around it to
strike a rock on the far side. Rocks orbit on curved paths and wrap at the edges.

**Shatter:** a Large rock splits into two Medium, a Medium into two Small, and a
Small is destroyed outright. Fragments fan apart based on your shot's direction.
Smaller rocks (and the saucer) are worth more points.

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
  constants.ts        Palette, geometry, physics constants (logical 1280x720)
  types.ts            Shared entity types
  entities.ts         The Ship class and rock/saucer factories
  input.ts            Keyboard: held flight state + edge events
  audio.ts            Web Audio sounds (optional, mutable)
  physics.ts          Wrap, the gravity well, and swept collision
  game.ts             State machine, waves, scoring, lives, saucer, collision
  render.ts           All canvas drawing (neon-on-charcoal)
```
