# Siege — test case (v1.0.0)

An end-to-end test case: the model builds **Siege**, a first-person voxel
last-stand survival shooter that runs entirely in the browser.

- **In-game title:** Siege
- **Catalog slug:** `siege` (the kebab-cased title)
- **Type:** end-to-end (a playable game built from a specification)
- **Difficulty:** hard

## What the game is

A first-person shooter fought over a **procedurally generated voxel world**. The
player defends a chain of three fortified **redoubts** (A → B → C) against the
**Scourge**, an escalating red enemy tide, aided by a four-Warden **squad** — a
rifleman, a machine gunner, a medic (the only healer), and an engineer (the only
ammo resupply). Each redoubt is a **health-based** objective that dedicated
**breaker** sappers and arcing **artillery** grind down until it falls; the player
then falls back to the next. It is **pure survival**: there is no win, so the score
is **how long you survive** and **how many attackers you destroy** before redoubt C
falls. From the title screen **PLAY** prompts for a **starting phase** (A/B/C); the
player then picks one of three **classes** (Ranger / Marksman / Breacher) at the
in-game spawn UI, and may change class on every respawn.

The build exercises: procedural terrain generation, a **real-time 3D voxel
renderer** with a performance target and a wireframe mode, a first-person
pointer-lock controller, hitscan/projectile/arcing weapon systems, **two**
independent 3D-pathfinding AI systems (the Scourge and the friendly squad), a
health-based capture/respawn loop, and telegraphed artillery. It is the catalog's
largest build.

## Layout

- `test-case.toml` — the manifest (metadata, `[build]`, common specs, references,
  proofs, the deploy-screen check, scoring domains, and the reviewer checklist).
- `specs/` — the seeded specification, decomposed by concern: `overview`,
  `world` (arena + terrain + redoubts), `phases` (survival loop + escalation),
  `combat` (classes + weapons + Scourge roster/tiers), `ai` (pathfinding + enemy +
  squad), `flow` (states, controls, HUD), `proof`, and `modes/standard.md` (the
  Last Stand mode).
- `variants/base.toml` — the single default variant (Last Stand).
- `prompt.hbs` — the rendered build instruction (not seeded).
- `reference/` — mockup **source** for the `title`, gameplay, and game-over views
  and the shared `theme.css`; rendered to screenshots by the harness, never seeded
  directly. The mockups do not fake the 3D view — the gameplay mockup is HUD-only —
  and exist to pin the palette, HUD, and type.
- `workspaces/base/` — the seeded starter project (a `package.json` pinning
  Playwright, plus a `.gitignore`).
- `description.md`, `README.md` — site/human prose (not seeded).

## Validation

```sh
npm run lint:specs
tcab prompt --test-case siege --version v1.0.0 --variant base
tcab seed   --test-case siege --version v1.0.0 --variant base
```
