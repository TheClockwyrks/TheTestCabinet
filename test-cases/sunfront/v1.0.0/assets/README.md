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

**The models are in place and the `assets` key in `../test-case.toml` is active.**
22 of the 24 entities have been seeded from their asset-generation runs. Two remain
**pending** and are held commented in the `assets` list:

- **`lancer`** (the unit) — its asset case is being **re-run** (the latest run failed
  at the infrastructure stage).
- **`garrison`** (the Trooper's spawner) — it has **no asset case yet**. Its
  `models.json` entry is kept so re-adding it later is just uncommenting one line.

The build loads each provided model through the **model runtime package** (the voxel
rigs are posed/animated from their `rig.json`; the skinned Trooper loads its
`mesh.glb`). Loading is page-relative, per [`../specs/assets.md`](../specs/assets.md).
