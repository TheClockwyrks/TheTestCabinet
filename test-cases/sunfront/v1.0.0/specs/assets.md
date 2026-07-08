# Sunfront — The provided unit and structure models

Unlike the battlefield — the sand arena, the lane banding, the staging yards and
build grid, the fog of war, projectiles, effects, and every HUD and menu element,
all of which you **generate in code** (`specs/overview.md`, `specs/playfield.md`) —
every **unit and structure** in Sunfront is **provided to you** as a finished 3D
**model file**. This file defines what you are given and what you must do with it.
The units these models represent are in `specs/units.md`; the structures are in
`specs/economy.md` and `specs/playfield.md`.

## What you are given, and what you generate

- **Generated in code** (no art files): the sand arena and its banding, the two
  staging-yard panels and their build grid, the fog of war, health bars, selection
  and placement markers, projectiles and muzzle/impact effects, and every HUD and
  menu element — in the palette of `specs/overview.md`.
- **Provided as model files** (the **only** art you are given): every **buildable
  unit** (`specs/units.md`), the **Aegis**, both **bases**, both **Reliquaries**,
  every **spawner structure** (one per buildable unit), and the **Solar Extractor**
  economy structure. You must **load and use** these; you must **not** replace them
  with primitives of your own, and you must **not** fetch any other art at runtime.

## The models, their manifest, and their scale

The models are seeded under `assets/`, one directory per entity. A machine-readable
manifest ships beside them at **`assets/models.json`**, listing for each entity: its
model file path, its **named parts, joints, and animation clips**, whether it is
**rigid** or **skinned** (below), and its authored **dimensions**
(`width x height x depth`).

You must render every entity **at the relative scale its dimensions imply** — a
Monolith towers over a Scarab, and the Aegis dwarfs every buildable unit — never
renormalized to a common size. **The dimensions are the size contract; honor them.**
Ground the models on the arena floor and space units so their footprints read; a
unit's on-field footprint follows its model's `width x depth`.

## The models are rigged, articulated assemblies

Most provided models are **rigid, articulated assemblies**: a hierarchy of rigid
parts joined by **named joints** — a turret that yaws, a barrel that elevates, legs
that stride, the Aegis radar vane that sweeps — plus **authored animation clips** you
play back. The parts move only by rotating or sliding on their joints; there is no
mesh deformation.

A small number of models — the **infantry** class (the Trooper) — instead deform as
one **continuous skinned mesh** over a skeleton (linear-blend skinning); the manifest
marks these `skinned`. Load both kinds with a standard glTF loader and play their
clips with a standard animation mixer.

Each model is delivered with its **named parts, joints, and clips enumerated** in
`assets/models.json`, so you know which part is which and which clip to play for each
game event. Clip names follow a stable convention — a locomotion clip (a `march` /
`fly`), an attack clip (a `fire` / `bombardment`), and any idle or self-playing clip
(the Aegis `radar_spin`; the Trooper `brace`) — but always read the exact names from
the manifest rather than hard-coding them.

## What you must do with them

- **Load** each provided model and render it for every unit and structure of that
  type in the arena you generate (`specs/playfield.md`), **tinted to its owner's team
  color** (Ember for the player, Azure for the enemy; `specs/overview.md`) with the
  team energy accent, and carrying a **health bar** when damaged (`specs/overview.md`).
  Neutral-looking structures (the Reliquary) keep their own color with the owner's
  accent.
- **Play the authored clips from the simulation.** A unit plays its locomotion clip
  while it advances and its attack clip when it fires (`specs/units.md`); the Aegis
  strides under `march`, works its guns under `bombardment`, and sweeps its radar
  under the self-playing `radar_spin` (`specs/waves.md`); a spawner plays its emit
  clip as it stamps out a unit each wave (`specs/waves.md`). When a unit that can be
  destroyed (including the Aegis) reaches `0 HP`, **flash the whole model white a few
  times and then remove it**, so it reads as no longer functional. There is no death
  animation — the flash is the only destruction cue.
- **Orient** each model to its facing on the field: a unit faces along its travel or
  toward its target; the Aegis **rotates its hull** to bring its main-gun target into
  its forward cone, while its side turrets traverse independently (`specs/waves.md`).
- **Carry structure level** onto each build-grid structure (`specs/economy.md`) as
  small pips or similar markers. For spawners, also carry unit level onto the model
  it emits: a brighter accent or rank marker over the provided geometry, so a veteran
  army reads on the field.

## Loading rule — page-relative paths only

Because the build **loads the model files at runtime**, and a finished run is played
back from a **per-run sub-path**, every URL the build uses to load a model (and
`assets/models.json`) must be **page-relative**: it must **never** begin with a
leading `/`, and for a bundler you must set a **relative base** (such as Vite's
`base: './'`) so the built site resolves its assets relative to wherever it is served.
A model that loads under a server root but 404s its models under a sub-path does not
satisfy this case.
