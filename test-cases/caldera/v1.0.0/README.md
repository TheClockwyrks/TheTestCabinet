# Caldera — test case (v1.0.0)

An end-to-end test case: the model builds **Caldera**, a real-time strategy
tower-defense played over a procedurally generated hex caldera, rendered in
real-time 3D and running entirely in the browser.

- **In-game title:** Caldera
- **Catalog slug:** `caldera` (the kebab-cased title)
- **Type:** end-to-end (a playable game built from a specification)
- **Difficulty:** hard

## What the game is

A tower-defense fought over a **procedurally generated hexagonal** volcanic basin,
viewed through a tilted RTS camera. The player defends a single fixed **Core**
against the **Slag**, an obsidian tide that pours in from **two rim breaches** in
escalating **waves**. There is no soldier to control: the player spends **funds**
(produced by the upgradeable Core) to build a two-fluid supply chain — drawing
**water** from rivers/lakes, pumping it to **boilers** on geothermal **vents** to
raise **steam**, and piping steam to **towers** that only fire when supplied — and
defends both approaches. Clear the final wave with the Core standing to **hold**
(win); lose the Core to be **overrun**.

The build exercises: procedural **hex-mesh terrain generation** with terraces,
cliffs, carved rivers, deep water, and procedural-noise surface color; a
**real-time 3D renderer** from a tilted RTS camera with a wireframe mode and a
performance target; animated water; a **flow-network fluid simulation** (water →
steam → power) with elevation-aware flow, brownouts, and severable lines; a
build/economy layer with a Core-upgrade lever and tower upgrades; a four-tower
roster and a four-archetype **Slag** roster that **3D-pathfinds** across the terrain
from two breaches; and a discrete, curve-driven **wave loop** with a win and a loss.
It is among the catalog's largest builds.

## Layout

- `test-case.toml` — the manifest (metadata, `[build]`, common specs, references,
  proofs, the title-screen check, five scoring domains, and the reviewer checklist).
- `specs/` — the seeded specification, decomposed by concern: `overview`, `world`
  (hex caldera + terraces/cliffs + water + vents), `build` (economy + structures),
  `fluids` (the flow simulation), `enemies` (the Slag roster + pathfinding), `towers`
  (the Holdfast towers), `waves` (the wave loop + win/loss), `flow` (states,
  controls, HUD), `proof`, and `modes/standard.md` (The Hold mode).
- `variants/base.toml` — the single default variant (The Hold).
- `prompt.hbs` — the rendered build instruction (not seeded).
- `reference/` — mockup **source** for the `title`, `gameplay`, and `game-over` views
  and the shared `theme.css`; rendered to screenshots by the harness, never seeded
  directly. The mockups do not fake the 3D view — the gameplay mockup is HUD-only —
  and exist to pin the palette, HUD, and type.
- `workspaces/base/` — the seeded starter project (a `package.json` pinning
  Playwright, plus a `.gitignore`).
- `description.md`, `README.md` — site/human prose (not seeded).

## Validation

```sh
npm run lint:specs
tcab prompt --test-case caldera --version v1.0.0 --variant base
tcab seed   --test-case caldera --version v1.0.0 --variant base
```
