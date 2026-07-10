# Sunfront — Provided unit and structure models (assets)

This folder holds the **provided models** the build loads and renders — the only art
the case supplies. Everything else (the sand arena, staging yards, fog, effects, HUD)
is generated in code; see [`../specs/assets.md`](../specs/assets.md).

Each entity is a directory (e.g. `scarab/`, `aegis/`, `reliquary/`) holding its
produced model. Every one is a **rigid, articulated voxel rig** — a `rig.json`
(parts, joints, animation clips) plus its `meshes/*.glb` parts, one per part. The
Trooper is rigid too: the whole roster is uniform, which is what lets the build render
it with a single instanced pipeline. The manifest of every entity — its `rig.json`
entry file, its (uniformly `rigid`) kind, its animation clips, and its authored
`width x height x depth` dimensions — is [`models.json`](models.json), whose `model`
field points at each entity's `rig.json`.

## Status

**The roster is complete.** All **24** entities — every buildable unit, the Aegis,
both structures plus the Solar Extractor, and one spawner per unit — have been seeded
from their asset-generation runs, alongside the three provided muzzle-flash particle
systems under [`effects/`](effects). The `assets` key in `../test-case.toml` is active
and lists all of them; nothing is held back.

The build loads and poses each provided model with **`@test-cabinet/voxel-runtime`**
(every rig is decoded from its `meshes/*.glb` parts and posed/animated from its
`rig.json` authored animations), and plays each firing unit's muzzle-flash effect
under [`effects/`](effects) with **`@test-cabinet/particle-runtime`**. Both runtimes
are seeded dependencies of the project. Loading is page-relative, per
[`../specs/assets.md`](../specs/assets.md).
