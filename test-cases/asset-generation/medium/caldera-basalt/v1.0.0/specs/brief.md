# Caldera Basalt — material brief

You are authoring the **Caldera basalt**: a tileable, seamless PBR material of
**weathered volcanic basalt** — the cooled-lava rock of a caldera. It dresses the
terraced hex terrain of *Caldera*, a volcanic tower-defense case: the near-vertical
cliff walls and the flat terrace floors of a volcanic bowl. The terrain mesh has no
UV layout; the material is applied by **triplanar projection**, so it must **tile
seamlessly** — no visible repeat, no seam, no single focal feature that would betray
the tiling repeat. You are authoring **one material**: the full set of maps below.

## The surface

Dark, cooled basalt — near-black volcanic rock — that has weathered in a caustic,
ashy caldera:

- **A near-black basalt body** with subtle grey-on-black mottle, the base tone of
  the whole surface. It is not flat black: it carries a faint mineral grain (fine
  worley/fbm noise) so it reads as rough rock rather than a painted panel.
- **A hairline fissure network** — the cracks where the lava cooled and split.
  Thin, branching, irregular fissures that cut *into* the surface. Most are dark and
  ashen; a few carry a **faint ember** hint at their deepest points, as if heat
  still lingers far below — but the surface is **cooled**, so the ember is a subtle
  warm tint in the base-color, never a bright glowing line.
- **Mineral crust and grit** — patches of pale, dusty mineral deposit (ash and
  sulphurous crust) sitting on the raised parts of the surface, weathered onto the
  high points, with loose grit scattered between. The crust reads matte and slightly
  raised; the fissures read glassier and recessed.
- **Vesicle pitting** — the small gas-bubble pockmarks basalt is full of, scattered
  across the body as shallow round pits.

Keep it **uniform enough to tile** — consistent grain and fissure density across the
tile, no one dominant crack or crust patch — but **varied enough to read as real
rock**, not a regular pattern.

### Tiling scale intent

One tile covers roughly a **2 m span** of caldera wall or floor. Choose your fissure
and vesicle scale for that: the main fissures should read as finger- to hand-width
cracks at 2 m, vesicle pits as thumb-sized pocks, and the mineral crust as
palm-to-plate-sized patches — coarse enough to be legible when a 2 m tile is
projected onto a cliff, fine enough that several fissures and many pits fall within
one tile.

## Palette

The base-color (and the faint ember tint within it) works within this palette. State
your colors against these named hexes so the surface reads unambiguously as weathered
volcanic basalt:

| Role | Hex |
| --- | --- |
| Basalt body (near-black rock) | `#191a1d` |
| Basalt mottle (lifted grey grain) | `#33363b` |
| Cooled fissure (ashen, dark) | `#2b2f36` |
| Mineral crust / ash (pale, dusty) | `#6b5a44` |
| Ash grit (light dusting) | `#8a7c66` |
| Faint ember (deep-fissure warm hint) | `#5a2412` |

Basalt is a **dielectric**, so there is **no metallic** channel and no metal in the
palette. There is **no emissive** channel either — the ember is a subtle warm tint
painted into the base-color at the fissures' deepest points, not self-illumination.
Keep the whole surface **dark**: the crust and grit are the only light values, and
even those are dusty, not bright.

## The maps to emit

Emit **exactly** these four maps. Each is an independent square map of the case's
size, painted seamlessly (everything wraps across the edges).

- **`base-color`** (required, sRGB) — the albedo: the near-black basalt body, the
  grey mottle, the ashen fissures with their faint ember hint, and the pale mineral
  crust and grit. **No baked lighting or shadow** goes here — that is the AO map's
  job. This is the color of the rock, lit flat.
- **`normal`** (linear) — the surface relief: the fissures cut *in*, the vesicle
  pits sunk, the mineral crust patches raised with a soft lip. **Do not hand-paint an
  RGB normal.** Paint the relief once into a grayscale **`height`** field (dark =
  recessed fissures and pits, light = raised crust) and **bake** the normal from it
  with `pbr bake-normal --from height`.
- **`roughness`** (linear, 0 = mirror … 1 = matte) — where the surface is glassy vs.
  matte. Cooled-lava fissures read **glassier** (lower roughness, around **0.35**);
  the weathered basalt body and especially the dusty mineral crust read **matte**
  (higher, around **0.75–0.9**). Aim for a roughness range of roughly **0.35 at the
  glassy fissures to 0.9 at the dusty crust**, with the body around 0.7. Start from a
  uniform base and paint the variation on top.
- **`ao`** (linear) — baked ambient occlusion darkening the recesses: the fissure
  bottoms and the vesicle-pit interiors. **Bake it from the same `height` field**
  with `pbr bake-ao --from height` so it agrees with the normal.

You are **not** emitting `metallic` (basalt is a dielectric) or `emissive` (the ember
is a base-color tint). Do not spend effort on those channels.

### The `height` channel is an authoring aid, not an output

Paint all the relief — the fissure network, the vesicle pits, the raised crust lips —
into the grayscale **`height`** map, then bake `normal` and `ao` from it. `height` is
**never** one of the emitted maps; it exists only so the normal, AO, and any
curvature-driven color describe the *same* relief. Baking the relief maps from one
height field is what keeps them coherent.

## Working the tools

The `texture` binary is the only way to paint a map, and everything it does **wraps
seamlessly** across the map edges — a stroke off one edge continues on the opposite
edge — so the map tiles by construction. The `pbr` binary bakes the relief maps, sets
uniform scalar maps, assembles `material.json`, and renders the lit 3D preview. The
**emitted maps are the output**; anything produced outside the tools is discarded.

A sensible path for this surface:

- **Build the basalt body** in `base-color` with the procedural generators: lay down
  fbm or worley `noise` for the mineral grain, then `gradient-map` that grayscale
  field into the basalt palette (`#191a1d` up to the `#33363b` mottle). This is the
  base tone the rest sits on.
- **Sculpt relief once, in `height`.** Paint the branching **fissure network** dark
  (recessed) and the **mineral-crust** patches light (raised) into the grayscale
  `height` map — brushes, noise, and patterns all wrap and stay tileable. Add the
  **vesicle pits** as small dark round marks (a scattered hard brush is ideal). Then
  let `pbr` derive the relief maps from it: `pbr bake-normal --from height --strength
  <n>` writes the `normal` map, and `pbr bake-ao --from height --radius <n>` writes
  the `ao` map. `pbr bake-curvature --from height` is available if you want to drive
  crust/edge wear in the base-color from the same relief.
- **Paint the fissures and crust into `base-color`**, aligned to the height relief:
  the ashen fissure color `#2b2f36` in the cracks (with the `#5a2412` ember hint only
  at their deepest points), and the pale crust `#6b5a44` / grit `#8a7c66` on the
  raised patches. Warping one map by another (`warp`) keeps the color and relief
  organically aligned.
- **Fill the scalar maps with a uniform, then vary.** Use `pbr set-uniform --map
  roughness --value 0.7` for the body base, then paint the glassier fissures (~0.35)
  and the matte crust (~0.9) on top with `texture`. There is no metallic map to fill.
- **Assemble and preview.** `pbr assemble` writes `material.json` (also run
  automatically when the run finishes). Render periodically with `pbr render --shape
  <sphere|cube|cylinder|plane>` — this applies the maps by the **same triplanar
  projection** the terrain uses, so you judge how the maps combine on geometry, not
  just as flat swatches. `texture` re-renders the active map's flat 2x2-tiled preview
  after every op so you can watch for seams; the `pbr` 3D preview is the one on-request
  render.

Run `texture --help` and `pbr --help` (and `<op> --help` for each subcommand) for the
exact operations and flags. Call the tools one operation at a time and read the
previews between calls to judge your progress against this brief.
