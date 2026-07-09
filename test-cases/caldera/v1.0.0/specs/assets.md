# Caldera — The provided models

This file defines the **art you are given** and what you must do with it. Every Slag
unit, every tower, the Core, the three fluid structures, and the pipe kit arrive as
**finished 3D models** under `assets/`, described by `assets/models.json`. You do
**not** author them.

Everything else is still yours, generated in code: the terrain mesh and its
procedural surface color, the animated water, the geothermal vents, where the pipes
run, the effects, and the HUD (`specs/overview.md`, `specs/world.md`).

## What you are given

- `assets/models.json` — the manifest below. Read it; do not hard-code names.
- One directory per entity — `assets/runner/`, `assets/repeater/`, `assets/core/`, …
  Each animated model holds a `rig.json` plus its `meshes/*.glb` parts. Each static
  model (the pipe kit) holds a single `mesh.glb`.

Load them by **page-relative** URL (never a leading `/`) — the game is served from a
per-run sub-path (`specs/overview.md`).

A `rig.json` names the model's parts, its joints and their hierarchy, and its
animations as F-curves keyed on joint values. Each part's `.glb` is a standard glTF
2.0 binary whose geometry decodes to plain typed arrays — `positions`, `normals`,
`colors`, `indices`. Decoding the `.glb`, composing the joint hierarchy, and sampling
the F-curves are yours to implement.

## The manifest

`assets/models.json` gives each entity its entry file, its `kind`, its extents
(`dimensions`, the on-field relative-scale contract), the `clips` mapping a game
event to the animation name to play, and its `accent` — the reserved color the
recolor rules below act on. Clip names follow a stable convention (`move`, `attack`,
`idle`, `fire`), but **always read the exact names from the manifest**.

The manifest also carries three recolor tables — `tiers`, `towerLevels`, and
`pipeFluids` — each mapping a source color to a target color.

## What you must do with them

- **Load and found each model** on the terrain at its cell's elevation, snapped to
  the cell center, sitting on the surface — never floating, never buried
  (`specs/build.md`).
- **Play the authored clips from the simulation.** A Slag plays its `move` clip while
  it advances and its `attack` clip when it strikes; a tower plays its self-playing
  `idle` and its `fire` clip on each shot, in sync with its cadence
  (`specs/towers.md`); the Scald runs its `emit` loop while its field is up; a Boiler
  plays `boil` only while it is actually receiving water; a Pump plays `pump` while
  delivering; the Core plays its one-shot `upgrade` on purchase. The Colossus's
  `aura` is self-playing and runs continuously (`specs/enemies.md`).
- **Carry a health bar** above any damaged structure or unit (`specs/overview.md`).
- **Destroy without an animation.** A Slag at `0` HP breaks apart or fades — a brief
  blocky effect you generate — and is removed (`specs/enemies.md`). There is no death
  clip.

## Recoloring: tiers, upgrades, and pipe fluids

This is the mechanism that turns **one** provided model into three Slag tiers, three
tower upgrade levels, and two pipe fluids. Get it right; it is directly reviewed.

### How the models encode color

Each model's color is baked into its geometry as **per-vertex colors** — not
textures, not named materials. The meshing is flat-shaded and **never blends colors
across a seam**, so every vertex carries exactly one of the authored `#rrggbb`
colors, stored as `channel / 255` with no gamma conversion. `Math.round(c * 255)`
recovers the authored byte exactly.

### The accent region

Each model reserves one **accent region** — the plates and trim on a Slag, the
fittings on a tower — authored in a color used **nowhere else on that model**:

| Family | Accent color | Reads as, unrecolored |
| --- | --- | --- |
| Slag | `#2b2433` | Obsidian (indistinguishable from the body) |
| Towers, Core, fluid structures | `#9a7a34` | Brass |
| Pipe kit | `#808890` | Neutral metal |

At Tier I and upgrade level `0` the accent is *supposed* to be invisible as an
accent. That is the design: you still run the recolor, mapping the accent onto the
true base color, so one code path serves every tier.

### The remap

For each (model, tier) pair, **remap the vertex colors once at load** — before you
construct any rig — and cache the result. Walk the decoded mesh's `colors` array;
where a vertex matches the accent color exactly, write the target color; leave every
other vertex alone. So a Tier III Runner keeps its obsidian body and its acid-green
glow, and only its plates turn violet.

```js
const key = (r, g, b) => (r << 16) | (g << 8) | b;

function remap(mesh, table) {                  // table: Map<key, [r, g, b] in 0..1>
  const colors = Float32Array.from(mesh.colors);
  for (let i = 0; i < colors.length; i += 3) {
    const hit = table.get(key(
      Math.round(colors[i] * 255),
      Math.round(colors[i + 1] * 255),
      Math.round(colors[i + 2] * 255),
    ));
    if (hit) [colors[i], colors[i + 1], colors[i + 2]] = hit;
  }
  return { ...mesh, colors };
}
```

Three tiers × one model per archetype = three cached mesh sets per archetype. Every
Tier II Runner on the field is built from the same cached set.

**Do not** implement tiers or upgrades by tinting the whole model with a material
color. A whole-model multiply drags the acid-green glow and the steel plating along
with the body, and it cannot make a plate violet while the body stays obsidian. That
is what the accent region exists to avoid.

### Whole-model tinting *is* correct for state

A **dark** tower (brownout or severed steam, `specs/fluids.md`), a **starved** pipe,
and a structure flashing on damage are whole-model state changes, not region swaps.
Do those with a material color multiply over the baked vertex colors, which is cheap
and leaves the cached geometry untouched.

## The pipe kit

Pipes are the one provided model whose **placement is entirely yours**. You are given
two static pieces:

- `assets/pipe-span/mesh.glb` — one straight run of pipe, which you orient and
  stretch between two adjacent cell centers, absorbing the rise across a terraced
  edge (`specs/world.md`).
- `assets/pipe-hub/mesh.glb` — the junction body you place at each pipe cell, where
  up to six spans meet.

You decide the topology (which neighbors a cell connects to), the orientation, and
the raised trestle that carries a pipe over a river channel (`specs/build.md`) —
simple pylons you generate. Recolor the kit per network with `pipeFluids`: water
pipes `#3d9bd6`, steam pipes `#7fcabc`. The **animated flow** along a live pipe
(`specs/fluids.md`) is a shader or material effect you write; it is not authored into
the model.

## Performance

A late-wave assault puts dozens of Slag on the field alongside hundreds of pipe cells,
against a hard 30 FPS floor (`specs/overview.md`). Caching the remapped meshes saves
the recolor, not the GPU upload: share one geometry across every instance of a given
(model, tier) rather than building it per unit. If you need instancing, merging, or a
level-of-detail scheme to hold the frame rate, build it — the frame rate is the
requirement, and how you meet it is your choice.

## What is not provided

The terrain and its procedural surface color, the animated water, the geothermal
vents and their heat wisps, the pipe routing and the flow animation, the steam plumes
on powered towers, muzzle flashes, the Slag death effect, the Core's health bar and
every HUD element, and both end screens. Generate all of it in code.
