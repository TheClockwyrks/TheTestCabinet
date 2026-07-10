# Sunfront — Provided unit and structure models (assets)

This folder holds the **provided models** the build loads and renders — the only art
the case supplies. Everything else (the sand arena, staging yards, fog, effects, HUD)
is generated in code; see [`../specs/assets.md`](../specs/assets.md).

Each entity is a directory (e.g. `scarab/`, `aegis/`, `reliquary/`) holding its
produced model. Most are **rigid, articulated assemblies** delivered as a voxel/mesh
**rig** — a `rig.json` (parts, joints, animation clips) plus its `meshes/*.glb` parts,
one per joint; the infantry class (`trooper/`) is a **skinned** mesh delivered as a
single `mesh.glb` (linear-blend skinning) alongside its `rig.json`. The manifest of
every entity — its entry file, `rigid`/`skinned` kind, animation clips, and authored
`width x height x depth` dimensions — is [`models.json`](models.json), whose `model`
field points at each entity's entry file (`rig.json`, or `mesh.glb` for the skinned
Trooper).

## Status

**The roster is complete.** All **24** entities — every buildable unit, the Aegis,
both structures plus the Solar Extractor, and one spawner per unit — have been seeded
from their asset-generation runs, alongside the three provided muzzle-flash particle
systems under [`effects/`](effects). The `assets` key in `../test-case.toml` is active
and lists all of them; nothing is held back.

The build loads each provided model through the **model runtime package** (the voxel
rigs are posed/animated from their `rig.json`; the skinned Trooper loads its
`mesh.glb`). Loading is page-relative, per [`../specs/assets.md`](../specs/assets.md).
