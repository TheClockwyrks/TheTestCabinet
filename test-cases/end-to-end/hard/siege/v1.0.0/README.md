# Siege — `v1.0.0`

An end-to-end test case: the model builds **Siege**, a first-person voxel
last-stand survival shooter that runs entirely in the browser.

- In-game title: Siege
- Catalog slug: `siege` (the kebab-cased title)
- Type: end-to-end (a playable game built from a specification)
- Difficulty: hard

## What the game is

A first-person shooter fought over a procedurally generated voxel world. The
player defends a chain of three fortified redoubts (A → B → C) against the
Scourge, an escalating red enemy tide, aided by a four-Warden squad: a
rifleman, a machine gunner, a medic, and an engineer. The medic is the only
healer and the engineer the only ammo resupply. Each redoubt is a health-based
objective that dedicated breaker sappers and arcing artillery grind down until
it falls, and the player then falls back to the next.

It is pure survival with no win state, so the score is how long the player
survives and how many attackers they destroy before redoubt C falls. From the
title screen, PLAY prompts for a starting phase (A/B/C). The player picks one
of three classes (Ranger / Marksman / Breacher) at the in-game spawn UI, and
may change class on every respawn.

The build exercises procedural terrain generation and a real-time 3D voxel
renderer with a performance target and a wireframe mode. It adds a first-person
pointer-lock controller, hitscan/projectile/arcing weapon systems, telegraphed
artillery, and a health-based capture/respawn loop. Two independent
3D-pathfinding AI systems drive the Scourge and the friendly squad. It is the
catalog's largest build.

## Layout

- `test-case.toml` — the manifest (metadata, `[build]`, common specs, scoring
  domains, and the reviewer checklist).
- `specs/` — the seeded specification, decomposed by concern: `overview`,
  `world` (arena + terrain + redoubts), `phases` (survival loop + escalation),
  `combat` (classes + weapons + Scourge roster/tiers), `ai` (pathfinding +
  enemy + squad), `flow` (states, controls, HUD), and `standard` (the Last
  Stand mode).
- `variants/base.toml` — the single default variant (Last Stand).
- `prompt.hbs` — the rendered build instruction, not seeded.
- `workspaces/base/` — the seeded starter project: a `package.json` pinning
  Playwright, plus a `.gitignore`.
- `description.md`, `README.md` — site and human prose, not seeded.

## Validation

```sh
npm run lint:specs
tcab prompt --test-case siege --version v1.0.0 --variant base
tcab seed   --test-case siege --version v1.0.0 --variant base
```
