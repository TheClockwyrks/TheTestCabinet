# Wick v1.0.0 — authoring notes

Wick is a 2D full-stack survival case: a lamplighter who only moves, tools that
fire on their own, a ten-minute night, and a roster of sixteen weapons, ten
passives, and thirteen enemies whose sprites and sounds the build produces
itself. This file is for people working on the case; nothing in it is seeded.

## Design intent

- **Breadth over depth.** The case is `easy` because nothing in it is hard to
  reason about: every rule is a table row or a one-line formula, there is no
  physics to tune and no opponent to model. What it measures is whether a
  build carries a large, exactly specified roster all the way through without
  dropping or blurring a row, which is why `max_runtime_hours` is generous.
- **The roster is the measurement.** The checklist is one item per weapon
  behavior, per passive formula, per evolution recipe, per enemy, per screen,
  per cue, and per produced asset group, weighted `1` each, so a build that
  ships nine weapons scores differently from one that ships ten.
- **Determinism by debug verbs, not seeds.** A scenario does not replay a
  night from a seed to reach the moment it wants; it poses that moment
  directly. `spawnEnemy`, `grant`, `setOffers`, `addXp`, `setPlayer`,
  `setTime`, and `openChest` all route through the real systems, and no
  operation sets an outcome, so every hit, kill, and evolution a validator
  reads comes from stepping the simulation. The one seeded generator exists
  so a posed scenario is repeatable, not so a whole run is.
- **Appearance is free; legibility is fixed.** No palette, font, sprite
  artwork, or animation timing is specified. What is specified is what a
  player must read at a glance: thirteen silhouettes told apart by form, an
  evolved effect distinct from its base, gems by size, the HUD over the world.

## The engine extension this case adds

Wick loops two cues, the music bed for the length of a run and a hum while
Halo or Corona is held. Under `simple-2d` that is `api.audio.loop(cue)`,
`api.audio.stop(cue)`, and `api.audio.looping(cue)`: a file-backed cue loops
its decoded buffer seamlessly, a synthesized cue holds its tone until stopped,
and mute is live over a running loop. The engine branch of the specs and the
seeded stub are written against that API, and `LOOPING_CUES` in
`src/constants.ts` names the two cues. Under `none` the build's own audio layer
supports the same, through a looping `AudioBufferSourceNode`.

## Where things live

- `specs/` — twelve files, seeded for every run. `overview`, `controls`,
  `state`, `instrumentation`, `ui`, and `assets` are `.hbs` and branch on
  `engine.slug` alone; the rest are plain Markdown identical under either
  engine. `world.md` holds the rules every other file leans on: the order of
  the phases within a tick, and the timer rule (a timer set to `s` seconds is
  due exactly `round(s × TICK_HZ)` ticks later), which is what lets a
  validator assert a cooldown or a re-hit on an exact tick.
- `workspaces/none/` — configuration and `index.html` only; the build writes
  `src/` and the runtime.
- `workspaces/simple-2d/` — the same configuration plus `src/constants.ts`
  (every figure the specs fix), `src/main.ts` (the entry), and the `src/game.ts`
  stub the build implements. Produced assets go under `public/assets/` so
  Vite copies them to the engine's `assets/` root unchanged.
- `test-case.toml` — the manifest: both engines, the toolchain, the twelve
  specs, four domains, and the checklist in the categories grammar. The
  version is `experimental` until the items below land, so it cannot run and
  freeze without its validators.

## Figures the specs add beyond the brief

- `SLASH_FLASH` (`0.1` s): how long a Taper or Pyre slash is drawn. The brief
  fixed the slash's hitbox to one tick and left the drawing open; the specs
  give it a named flash like `SPARK_FLASH` and `FLARE_FLASH` so the effect
  is legible and the zone's `ttl` is exact.
- Lantern's cooldown timer is set on firing to `duration + cooldown`, both
  read on that tick. The brief's "then they vanish and the cooldown starts"
  gives the same period; this form keeps the common timer rule and the HUD
  readout exact.

## Still to do

- Reference implementations, one per engine (`references/none/`,
  `references/simple-2d/`), declared from `variants/base.toml`. Play a full
  night under each and tune anything in the brief's numbers that a real run
  shows to be off; the weapon tables and the spawn windows are designed to be
  self-consistent but have not been played end to end.
- Validation suites per engine under `validation/none/` and
  `validation/simple-2d/`, and the `validation` keys on the checklist items.
  The mechanical points are the ones to move first: the move speed and
  facing, each weapon's first-tick fire and level-1 and level-8 rows, each
  derived stat, the xp curve and the offer pool, each evolution recipe, each
  enemy's stats and behavior, the spawn windows and events, and the two
  endings. Every threshold traces to a figure in the specs, never to the
  reference.
- Baselines (`tcab capture-baselines`) once references and suites exist.
