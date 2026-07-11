# Sunfront — The provided models and muzzle-flash effects

Unlike the battlefield — the sand arena, the lane banding, the staging yards and
build grid, the fog of war, and every HUD and menu element, all of which you
**generate in code** (`specs/overview.md`, `specs/playfield.md`) — every **unit and
structure** in Sunfront is **provided to you** as a finished **rigid voxel rig**, and
the **muzzle-flash effects** its firing units play are **provided** too, as particle
systems (see *Provided muzzle-flash effects* below). This file defines what you are
given and what you must do with it. The units these models represent are in
`specs/units.md`; the structures are in `specs/economy.md` and `specs/playfield.md`.

## What you are given, and what you generate

- **Generated in code** (no art files): the sand arena and its banding, the two
  staging-yard panels and their build grid, the fog of war, health bars, selection
  and placement markers, any projectile or impact effects, and every HUD and
  menu element — in the palette of `specs/overview.md`.
- **Provided as rigid voxel rigs**: every **buildable unit** (`specs/units.md`), the
  **Aegis**, both **bases**, both **Reliquaries**, every **spawner structure** (one
  per buildable unit), and the **Solar Extractor** economy structure. You must
  **load and use** these; you must **not** replace them with primitives of your own,
  and you must **not** fetch any other art at runtime.
- **Provided as particle effects** (played, not drawn): the **muzzle-flash effects**
  that firing units play — a small-arms, a heavy-cannon, and a rail-lance flash, one
  shared system each — seeded under `assets/effects/` and played with the provided
  particle runtime (see *Provided muzzle-flash effects* below).

## The models, their manifest, and their scale

The models are seeded under `assets/`, one directory per entity. Each entity is a
**voxel rig**: a **`rig.json`** (the `ModelSpec` — its named parts, joints, and
authored animation clips) plus a **`meshes/*.glb`** file per part holding that part's
vertex-colored voxel geometry. A machine-readable manifest ships beside them at
**`assets/models.json`**, listing for each entity: its `rig.json` path, its `kind`
(`rigid` for every entity), the animation **clips** to play for each game role, and
its authored **dimensions** (`width x height x depth`).

You must render every entity **at the relative scale its dimensions imply** — a
Monolith towers over a Scarab, and the Aegis dwarfs every buildable unit — never
renormalized to a common size. **The dimensions are the size contract; honor them.**
Ground the models on the arena floor and space units so their footprints read; a
unit's on-field footprint follows its model's `width x depth`.

## The models are rigid, articulated voxel rigs

Every provided model is a **rigid, articulated voxel rig**: a hierarchy of rigid parts
joined by **named joints** — a turret that yaws, a barrel that elevates, legs that
stride, the Aegis radar vane that sweeps — plus **authored animation clips** you play
back. The parts move only by rotating or sliding on their joints; there is **no** mesh
deformation and **no** skinning. The whole roster is uniform this way, which is what
lets you render it with one instanced pipeline.

Each model is delivered with its **named parts, joints, and clips enumerated** in
`assets/models.json` and in its own `rig.json`, so you know which part is which and
which clip to play for each game event. In `models.json`, each entity's `clips` map is
a game-**role** → clip-**name** map (e.g. `move → "march"`, `attack → "bombardment"`);
the real animation lives under that name in the rig's `animations[]`. Clip names follow
a stable convention — a locomotion clip (a `march` / `fly`), an attack clip (a `fire` /
`bombardment`), and any idle or self-playing clip (the Aegis `radar_spin`) — but always
resolve the exact animation by reading `models.json`'s `clips` map and then looking that
name up in the rig, rather than hard-coding it.

## Load and pose the rigs with the provided runtime

You do **not** write a glTF loader or an animation mixer, and you do **not** fetch any
other art: the runtime that decodes and poses these rigs,
**`@test-cabinet/voxel-runtime`**, is already a dependency of your project (it is in
your `package.json`; run your install as usual and import it by name). It is the same
library the rigs were authored against. For each entity, at load time:

- **Read `assets/models.json`** to resolve the entity's `rig.json` path, its `clips`
  role→name map, its `dimensions`, and (for firing units) its `muzzle` joint.
- **Fetch each part's `meshes/*.glb`** (the parts named in the `rig.json`) **and the
  `rig.json` itself**, page-relative (see *Loading rule* below). Decode each part with
  the runtime's `parseGlb` and build its geometry with the `/three` binding's
  `buildPartGeometry`; **reuse one geometry per (entity type, part)** across all
  instances of that type.
- **Pose and animate** from the rig's authored animations: sample the active animation
  at the unit's clock, compose it with any caller-driven joints (e.g. an Aegis turret
  yaw derived from targeting), and evaluate the rig with the runtime's posing math to
  get each part's world transform. Play the locomotion clip while a unit advances, the
  attack clip when it fires (`specs/units.md`), the Aegis `radar_spin` on its own
  (`specs/waves.md`), and a spawner's emit clip as it stamps out a unit each wave. The
  runtime's own types are the authoritative API.

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
- **Play a muzzle flash for each shot.** A unit that fires a weapon plays **one
  instance** of its **provided muzzle-flash effect** at its muzzle **per shot**, in
  sync with its firing cadence (the *Provided muzzle-flash effects* section below);
  melee units (Scarab, Bulwark) and the support Lumen play none.
- **Orient** each model to its facing on the field: a unit faces along its travel or
  toward its target; the Aegis **rotates its hull** to bring its main-gun target into
  its forward cone, while its side turrets traverse independently (`specs/waves.md`).
- **Carry structure level** onto each build-grid structure (`specs/economy.md`) as
  small pips or similar markers. For spawners, also carry unit level onto the model
  it emits: a brighter accent or rank marker over the provided geometry, so a veteran
  army reads on the field.

## Provided muzzle-flash effects — `assets/effects/` (provided; play them)

When a unit fires, the flash at its muzzle is a **provided particle effect**, not
something you draw. Sunfront ships **three** shared muzzle-flash systems under
`assets/effects/`, and you **must play them** rather than hand-code your own or
substitute another:

- **`muzzle-small-arms.json`** — a small, stuttering rifle / light-gun flash. Used by
  the **Sentinel**, **Trooper**, **Flakhound**, and **Sunhawk**.
- **`muzzle-cannon.json`** — a big, smoky heavy-gun blast. Used by the **Bombard**,
  the **Monolith**, and the **Aegis**.
- **`muzzle-lance.json`** — a thin, searing energy discharge. Used by the **Lancer**.

The **Scarab** and **Bulwark** (melee) and the **Lumen** (support, no weapon) fire no
muzzle flash. Each unit names its effect with its **`muzzle`** key in
`assets/models.json` (`null` for the melee and support units), and the effect files
are mapped under that manifest's **`effects`** block — read the effect to play from
the manifest rather than hard-coding it.

Each effect is a **particle system**, not a frozen clip — a description of emitters,
forces, and per-particle curves, authored on a small transparent volume. You play it
by **simulating it live**, so it looks slightly different every shot while its
character (the flash, the forward spit, the smoke or bolt) reads the same. These are
**one-shot** systems: **play one fresh instance each time a unit fires a shot**, in
sync with its firing cadence and attack animation, so the flash rate matches the
unit's fire rate — a `2.0 s` cannon flashes once every `2 s`; a `0.8 s` rifle flashes
roughly once a second. Do **not** hold a single instance on continuously.

### Play them with the provided runtime

You do **not** write a particle simulator, and you do **not** fetch anything: the
runtime that plays these systems, **`@test-cabinet/particle-runtime`**, is already a
dependency of your project (it is in your `package.json`; run your install as usual
and import it by name, like any other dependency). It is the *same* library the
effects were authored against, so each flash plays in your game exactly as intended.
For Sunfront's 3D world use the package's **`/three`** binding — it simulates the
system and renders its particles as billboards in your `three` scene. The package's
own types are the authoritative API; the effect's field size, duration, fps, and loop
flag are carried inside the system itself, so you need not supply them.

### Where, when, and how to place it

- **Anchor** each effect to the firing unit's **muzzle** — the barrel tip or lance
  tip named as that model's muzzle joint (`assets/models.json`) — and **orient it
  along the barrel** so the flash and its forward spit fire in the direction the unit
  is shooting. Each effect is authored firing **forward along `+z`**; rotate it to the
  muzzle's world facing.
- **Trigger one flash per shot** — play a fresh instance each time the unit fires, on
  its attack cadence (the shot moment of its attack clip, `specs/units.md`), and let
  each instance run its one-shot and dispose. The **Aegis** fires from **three**
  turrets that aim independently (`specs/waves.md`), so play its cannon flash at
  **each** turret as that turret fires.
- **Scale** each effect to its unit's muzzle — a Monolith's blast reads larger than a
  Sentinel's flash — since the systems are authored small; fit them to the barrel,
  not the whole model. Tinting is optional: the flashes are authored as neutral
  gunfire and need no team tint.

## Loading rule — page-relative paths only

Because the build **loads the model files and effect systems at runtime**, and a
finished run is played back from a **per-run sub-path**, every URL the build uses to
load a model, an effect system under `assets/effects/`, or `assets/models.json` must
be **page-relative**: it must **never** begin with a leading `/`, and for a bundler
you must set a **relative base** (such as Vite's `base: './'`) so the built site
resolves its assets relative to wherever it is served. A model or effect that loads
under a server root but 404s under a sub-path does not satisfy this requirement.
