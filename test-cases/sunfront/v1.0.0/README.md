# Sunfront — test case (v1.0.0)

An end-to-end test case: the model builds **Sunfront**, a real-time **3D**
tug-of-war strategy game — fought corner-to-corner across a diagonal desert front —
that runs entirely in the browser, rendering **provided** unit and structure models.

- **In-game title:** Sunfront
- **Catalog slug:** `sunfront` (the kebab-cased title)
- **Type:** end-to-end (a playable game built from a specification)
- **Difficulty:** hard

## What the game is

Two legions of solar automatons (the Duneforged) fight a diagonal,
corner-to-corner tug-of-war rendered in 3D. The player spends a ticking **sol**
income on **spawner structures** placed in a fogged staging yard; every wave
(first at 20 s, then every 45 s) each spawner emits one unit that auto-marches
and auto-fights toward the enemy base. Units follow an armor/attack **counter
matrix** (Normal / Piercing / Splash / Flak / Support × Light / Heavy / Air), a
strict **fog of war** hides the enemy's build, and a mid-map **Reliquary**
funds whoever razes it but spawns a lone **Aegis** defender for the losing
side. Every unit and structure is rendered from a **provided 3D model** the
build loads and animates. Raze the enemy base to win. The opponent is an
adaptive, non-cheating, beatable AI.

## Layout

- `test-case.toml` — the manifest (metadata, `[build]`, common specs, references,
  proofs, the title check, scoring domains, and the reviewer checklist).
- `specs/` — the seeded specification, decomposed by concern: `overview`,
  `playfield` (diagonal geometry + fog), `assets` (the provided models), `economy`,
  `units` (roster + counter matrix), `waves` (wave clock + Reliquary/Aegis), `flow`
  (states, controls, HUD, AI), `proof`, and `standard` (the Skirmish mode).
- `assets/` — the **provided models** (one directory per entity) plus `models.json`,
  seeded into the run root via the manifest `assets` key; the only art the build gets.
  See `assets/README.md` (models are populated once authored).
- `variants/base.toml` — the single default variant (Skirmish).
- `prompt.hbs` — the rendered build instruction (not seeded).
- `reference/` — mockup **source** for the title, gameplay, and game-over views
  and the shared `theme.css`; rendered to screenshots by the harness, never seeded
  directly.
- `workspaces/base/` — the seeded starter project (a `package.json` pinning
  Playwright, plus a `.gitignore`).
- `description.md`, `README.md` — site/human prose (not seeded).

## Provided models

Every unit and structure is rendered from a **provided 3D model** the build loads (the
only art it gets); the world — arena, fog, effects, HUD — is generated in code. The
models live under `assets/` (one directory per entity) with a `models.json` manifest,
and each model's authored `width x height x depth` is the on-field relative-scale
contract; `specs/assets.md` defines what the build does with them. The model files are
**not yet in place** — the case is not run until they land, and the `assets` seed key
in `test-case.toml` stays commented until then (see `assets/README.md`).

## Validation

```sh
npm run lint:specs
tcab prompt --test-case sunfront --version v1.0.0 --variant base
tcab seed   --test-case sunfront --version v1.0.0 --variant base
```
