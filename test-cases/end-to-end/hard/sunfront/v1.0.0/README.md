# Sunfront — `v1.0.0`

An end-to-end test case: the model builds **Sunfront**, a real-time 3D
tug-of-war strategy game fought corner-to-corner across a diagonal desert
front, running entirely in the browser and rendering provided unit and
structure models.

- In-game title: Sunfront
- Catalog slug: `sunfront` (the kebab-cased title)
- Type: end-to-end (a playable game built from a specification)
- Difficulty: hard

## What the game is

Two legions of solar automatons, the Duneforged, fight a diagonal,
corner-to-corner tug-of-war rendered in 3D. The player spends a ticking sol
income on spawner structures and Solar Extractors placed in a fogged staging
yard. On every wave, first at 20 s and then every 45 s, each spawner emits one
unit that auto-marches and auto-fights toward the enemy base.

Units follow an armor/attack counter matrix (Normal / Piercing / Splash /
Flak / Support × Light / Heavy / Air), a strict fog of war hides the enemy's
build, and a mid-map Reliquary funds whoever razes it and spawns a lone Aegis
defender for the losing side. Raze the enemy base to win. The opponent is an
adaptive, non-cheating, beatable AI.

## Layout

- `test-case.toml` — the manifest (metadata, `[build]`, common specs, scoring
  domains, and the reviewer checklist).
- `specs/` — the seeded specification, decomposed by concern: `overview`,
  `playfield` (diagonal geometry + fog), `assets` (the provided models),
  `economy`, `units` (roster + counter matrix), `waves` (wave clock +
  Reliquary/Aegis), `flow` (states, controls, HUD, AI), and `standard` (the
  Skirmish mode).
- `assets/` — the provided models, one directory per entity, plus
  `models.json`, seeded into the run root via the manifest `assets` key.
- `variants/base.toml` — the single default variant (Skirmish).
- `prompt.hbs` — the rendered build instruction, not seeded.
- `workspaces/base/` — the seeded starter project: a `package.json` pinning
  Playwright, plus a `.gitignore`.
- `description.md`, `README.md` — site and human prose, not seeded.

## Provided models

Every unit and structure is rendered from a provided 3D model the build loads
and animates, and those models are the only art it gets. The arena, fog,
effects, and HUD are generated in code. Each model's authored
`width x height x depth` is the on-field relative-scale contract.
`specs/assets.md` defines what the build does with them, and
[`assets/README.md`](assets/README.md) documents the folder.

## Validation

```sh
npm run lint:specs
tcab prompt --test-case sunfront --version v1.0.0 --variant base
tcab seed   --test-case sunfront --version v1.0.0 --variant base
```
