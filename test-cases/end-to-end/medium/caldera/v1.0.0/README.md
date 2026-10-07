# Caldera — `v1.0.0`

An end-to-end test case: the model builds **Caldera**, a real-time strategy
tower-defense played over a procedurally generated hex caldera, rendered in
real-time 3D and running entirely in the browser.

- In-game title: Caldera
- Catalog slug: `caldera` (the kebab-cased title)
- Type: end-to-end (a playable game built from a specification)
- Difficulty: medium

## What the game is

The player defends a single fixed Core, viewed through a tilted RTS camera,
against the Slag, an obsidian tide that pours in from two rim breaches in
escalating waves. There is no soldier to control. The player spends funds,
produced by the upgradeable Core, to build a two-fluid supply chain and defend
both approaches: water is drawn from rivers and lakes, pumped to boilers on
geothermal vents to raise steam, and piped to towers that only fire when
supplied. Clearing the final wave with the Core standing holds the caldera;
losing the Core is being overrun.

Caldera is among the catalog's largest builds. It exercises:

- Procedural hex-mesh terrain generation with terraces, cliffs, carved rivers,
  deep water, and procedural-noise surface color.
- A real-time 3D renderer from a tilted RTS camera, with a wireframe mode and a
  performance target.
- Animated water.
- A flow-network fluid simulation (water → steam → power) with elevation-aware
  flow, brownouts, and severable lines.
- A build/economy layer with a Core-upgrade lever and tower upgrades.
- A four-tower roster and a four-archetype Slag roster that 3D-pathfinds across
  the terrain from two breaches.
- A discrete, curve-driven wave loop with a win and a loss.

## Layout

- `test-case.toml` — the manifest (metadata, `[build]`, common specs, five
  scoring domains, and the reviewer checklist).
- `specs/` — the seeded specification, decomposed by concern: `overview`,
  `world` (hex caldera, terraces and cliffs, water, vents), `build` (economy and
  structures), `fluids` (the flow simulation), `enemies` (the Slag roster and
  pathfinding), `towers` (the Holdfast towers), `waves` (the wave loop and
  win/loss), `flow` (states, controls, HUD), and `standard` (The Hold mode).
- `variants/base.toml` — the single default variant, The Hold.
- `prompt.hbs` — the rendered build instruction. Not seeded.
- `workspaces/base/` — the seeded starter project: a `package.json` pinning
  Playwright, plus a `.gitignore`.
- `description.md`, `README.md` — site and human prose. Not seeded.

## Validation

```sh
npm run lint:specs
tcab prompt --test-case caldera --version v1.0.0 --variant base
tcab seed   --test-case caldera --version v1.0.0 --variant base
```
