# Sunfront — Provided unit and structure models (assets)

This folder holds the **provided models** the build loads and renders — the only art
the case supplies. Everything else (the sand arena, staging yards, fog, effects, HUD)
is generated in code; see [`../specs/assets.md`](../specs/assets.md).

Each entity is a directory (e.g. `scarab/`, `aegis/`, `reliquary/`) holding its model
file. Most are **rigid, articulated assemblies** (a hierarchy of rigid parts on named
joints, plus authored animation clips); the infantry class (`trooper/`) is a
**skinned** mesh (linear-blend skinning). The manifest of every entity — its file path,
parts, joints, animation clips, `rigid`/`skinned` kind, and authored
`width x height x depth` dimensions — is [`models.json`](models.json).

## Status

**The model files are not yet in place.** `models.json` records the entity roster and
authored dimensions; per-model part/joint lists are added with each model. Until the
files are populated the case is **not run** and the `assets` key in `../test-case.toml`
stays commented out. The **Garrison** (the Trooper's spawner) and **Solar Extractor**
are not yet modelled either — their `assets/garrison` and `assets/solar-extractor`
directories need to be added to complete the roster.
