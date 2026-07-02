# Sunfront — test case (v1.0.0)

An end-to-end test case: the model builds **Sunfront**, a top-down real-time
tug-of-war strategy game that runs entirely in the browser.

- **In-game title:** Sunfront
- **Catalog slug:** `sunfront` (the kebab-cased title)
- **Type:** end-to-end (a playable game built from a specification)
- **Difficulty:** hard

## What the game is

Two legions of solar automatons (the Duneforged) fight a lane tug-of-war. The
player spends a ticking **sol** income on **spawner structures** placed in a
fogged staging yard; every wave (first at 20 s, then every 45 s) each spawner
emits one unit that auto-marches and auto-fights toward the enemy base. Units
follow an armor/attack **counter matrix** (Normal / Piercing / Splash / Flak /
Support × Light / Heavy / Air), a strict **fog of war** hides the enemy's build,
and a mid-map **Reliquary** funds whoever razes it but spawns a lone
**Aegis** defender for the losing side. Raze the enemy base to win. The opponent
is an adaptive,
non-cheating, beatable AI.

## Layout

- `test-case.toml` — the manifest (metadata, `[build]`, common specs, references,
  proofs, the title check, scoring domains, and the reviewer checklist).
- `specs/` — the seeded specification, decomposed by concern: `overview`,
  `playfield` (geometry + fog), `economy`, `units` (roster + counter matrix),
  `waves` (wave clock + Reliquary/Aegis), `flow` (states, controls, HUD, AI),
  `proof`, and `modes/standard.md` (the Skirmish mode).
- `variants/base.toml` — the single default variant (Skirmish).
- `prompt.hbs` — the rendered build instruction (not seeded).
- `reference/` — mockup **source** for the title, gameplay, and game-over views
  and the shared `theme.css`; rendered to screenshots by the harness, never seeded
  directly.
- `workspaces/base/` — the seeded starter project (a `package.json` pinning
  Playwright, plus a `.gitignore`).
- `description.md`, `README.md` — site/human prose (not seeded).

## Related asset-generation cases

The Duneforged faction's 3D hero models are produced by sibling **voxel** asset
-generation cases (each its own `sunfront-*` slug): the units
(`sunfront-scarab`, `-sentinel`, `-bulwark`, `-lancer`, `-bombard`, `-flakhound`,
`-sunhawk`, `-lumen`, `-monolith`, `-aegis`) and the structures (the spawner
foundries, `sunfront-bastion`, and `sunfront-reliquary`). Those are a separate
test type (`voxel-animation`) and are **not** consumed by this game build, which
renders its own top-down graphics in code; they share only the faction and theme.

## Validation

```sh
npm run lint:specs
tcab prompt --test-case sunfront --version v1.0.0 --variant base
tcab seed   --test-case sunfront --version v1.0.0 --variant base
```
