# Thunderhead — v1.0.0

**Thunderhead** is an end-to-end test case: a real-time, combined-arms
**fleet-command** game the model builds from this specification, played over a
procedurally generated archipelago drowned in a **cloud sea** and rendered in
real-time 3D in the browser. The player commands a fleet from a tactical view **and**
possesses individual units — and the stations aboard them — to fight directly, across
three asymmetric powers.

This is the catalog's **hardest** case: multiple independent, highly complex systems
that must interoperate (procedural 3D worldgen, two-scale command-and-possession
control, class-based gunnery with per-turret/per-barrel simulation, a damage model,
fog of war, a reinforcement economy, three asymmetric powers, and an AI opponent). It
is intended to exceed current models and to reward fanning the work out across the
engine and the per-power packages.

## Slug vs. title

- **Title:** Thunderhead (display name).
- **Slug:** `thunderhead` (the case's stable identity, matching the folder name;
  recorded in every run).

## Layout

- `test-case.toml` — the manifest: seeded specs, references, proofs, checks, scoring
  domains, and the reviewer checklist.
- `specs/` — the **seeded** specification, decomposed by concern (`overview`,
  `world`, `factions`, `units`, `command`, `combat`, `recon`, `battle`, `flow`,
  `assets`, `proof`, and `mode`).
- `variants/base.toml` — the single **Open Battle** variant (the default).
- `prompt.hbs` — the instruction rendered per run (not seeded).
- `reference/` — the mockup **source** (theme + views), rendered to screenshots as
  visual targets; the source is never seeded.
- `assets/` — the **provided unit models** the build loads (added when authored; see
  `assets/README.md`).
- `workspaces/base/` — starter files seeded into the run root (a `package.json`
  pinning Playwright, and a `.gitignore`).
- `description.md` — site-facing prose (not seeded).

## Provided models

Unlike the other 3D cases, Thunderhead does **not** ask the model to generate its unit
geometry: the ships, aircraft, and submarines are **provided** as rigid, articulated
model files (`specs/assets.md`), authored separately via the dual-contouring
asset-generation cases and seeded from `assets/`. The build generates the world
(terrain, cloud sea, effects) in code and **loads** the provided models for the
fleets. This case is not run until those models are in place.
