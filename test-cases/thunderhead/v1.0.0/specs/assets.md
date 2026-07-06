# Thunderhead — The provided unit models

Unlike the world — which you **generate in code** (`specs/overview.md`,
`specs/world.md`) — the game's **units are provided to you** as finished 3D **model
files**. This file defines what you are given and what you must do with it. The units
these models represent are in `specs/units.md`; the joints you drive them by come from
the stations and weapons in `specs/units.md` and `specs/combat.md`.

## What you are given, and what you generate

- **Generated in code** (no art files): the terrain, floating islands, the cloud sea
  and murk, water, projectiles, tracer, explosions, and every HUD element, in the
  palette of `specs/overview.md`.
- **Provided as model files** (the **only** art you are given): every **unit** — each
  ship, aircraft, submarine, and support craft, for each power. You must **load and
  use** these; you must **not** replace them with primitives of your own, and you must
  **not** fetch any other art at runtime.

## The models are rigid, articulated assemblies

Every provided model obeys the **rigid-body** contract (`specs/overview.md`): it is a
**hierarchy of rigid parts** connected by **named joints**, with **no** skeletal or
soft-body deformation. The parts move **only** by rotating or sliding on their joints.
The joints you will drive include:

- **Turret joints** — a turret **yaws** (traverses) about its mount to bear on a
  target;
- **Barrel joints** — a gun barrel (or gun block) **elevates/pitches**; a
  multi-barrel turret exposes its barrels as parts (so you can show per-barrel recoil
  and reload; `specs/combat.md`);
- **Rotor/propeller joints** — spin continuously while running;
- **Control-surface / hatch joints** — hinges such as rudders, flaps, dive planes, or
  torpedo doors, where a model provides them.

Each model is delivered with the **named parts and joints** enumerated, so you know
which part is which turret, which barrels belong to it, and about which axis each
joint moves. (The set of models, their file paths, and the per-model part/joint
listing are provided **with the assets**, in a manifest alongside the model files.)

## What you must do with them

- **Load** each provided model and render it for every unit of that type, in the
  world you generate (`specs/world.md`).
- **Drive its joints from the simulation.** A ship's turret **traverses and elevates**
  to aim where its class is firing (`specs/combat.md`); a destroyed turret reads as
  wrecked; propellers and rotors **spin** while under power; a bomber's manned turret
  tracks where the player aims it (`specs/units.md`, `specs/command.md`). The
  articulation is what makes the fleet read as alive.
- **Color and mark** each unit: a power's material/color (`specs/factions.md`) and its
  **allegiance** marker (allied/hostile; `specs/overview.md`), plus health, shield, or
  resonance state (`specs/combat.md`), applied over the provided geometry.
- **Wireframe.** The wireframe toggle (`specs/flow.md`) must show the provided model
  geometry as wireframe alongside the generated terrain (`specs/overview.md`).

## Loading rule — page-relative paths only

Because the build **loads the provided model files at runtime**, and a finished run is
played back from a **per-run sub-path** (`specs/overview.md`), every URL the build
uses to load a model (and its manifest) must be **page-relative**: it must **never**
begin with a leading `/`, and for a bundler you must set a **relative base** (such as
Vite's `base: './'`) so the built site resolves its assets relative to wherever it is
served. A model that loads under a server root but 404s its models under a sub-path
does not satisfy this case.
