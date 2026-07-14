---
title: Authoring a Material Test Case
---

A **material** [asset-generation](/testing/asset-generation/overview/) test case
(`asset_kind = "material"`) asks a model to **author a tileable PBR material** — the
set of maps that dresses a 3D surface so a [meshed
model](/testing/asset-generation/mesh-binaries/) reads as painted metal, worn stone,
or scuffed hull plating rather than a flat `#rrggbb` — to **match a written brief**,
rather than to build a game. As with every asset-generation case there is **no target
image**: the model is given a precise description and the freedom to author a material
that matches it, so the case rewards creativity within tight constraints rather than
the faithful reproduction of a supplied picture. Authoring one is mostly writing a
precise, **self-contained brief**.

[Manifests](/testing/asset-generation/manifests/#material-cases) is the authoritative
schema — every field and the rules enforced at resolution — and you should read it
first, along with the [Material binaries](/testing/asset-generation/material-binaries/)
page (the `texture` + `pbr` tools, the height→normal/AO bake workflow, and the
triplanar consumption model the material is authored for), the
[Overview's PBR-materials section](/testing/asset-generation/overview/#pbr-materials),
and [Evaluation](/testing/asset-generation/evaluation/#material-validation) (how the
emitted maps — not a replay of the operations — are validated and human-reviewed).

Drawing a 2D pixel sprite instead is a different `asset_kind` with its own tools and
tables; see [Authoring an Asset-Generation Test
Case](/guides/authoring/authoring-an-asset-generation-test-case/). Building a playable game is a
different test type entirely; see [Authoring an End-to-End Test
Case](/guides/authoring/authoring-an-end-to-end-test-case/).

The **worked example** for this guide is **`caldera-basalt`** — a tileable, weathered
volcanic-basalt material meant to dress the terraced terrain of the `caldera` case —
authored alongside this guide. A new material case should look like it.

## What a material case is, and what gets seeded

A material case produces **one tileable PBR material**: a set of square maps (a
required **base-color** map plus any of normal, roughness, metallic, ambient
occlusion, and emissive), each painted **seamlessly** so it tiles without a seam, and
a `material.json` that binds them together. A case authors exactly one material, the
way a single sprite is one image — the *variants* vary the brief, not the number of
materials.

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/asset-generation/medium/caldera-basalt/v1.0.0/
  test-case.toml         # manifest: type, asset_kind, material, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: the surface + which maps to emit + how the tools behave — SEEDED
```

A run receives only the seeded files: the selected variant's brief. There is **no
target image** — the model authors a material to match the brief, not to copy a
supplied picture. It also gets the two binaries in its environment — **`texture`**
(the primary map painter) and **`pbr`** (bake/uniform/assemble/preview), both on
`PATH` in the single `material` run-container image — plus a seeded
`material.config.json` the orchestrator writes (giving the map size, the declared
channels and tiling, the layer-store and op-log paths, and the `{map}` preview
template, so no operation needs size flags). **No operations schema is seeded** — each
binary's `--help` is the contract. Everything marked *NOT seeded* is authoring- or
site-side only.

Unlike a `draw`/`draw-sheet` sprite, a material run is **not regenerated from its
operation log**. Its authoritative output is the **maps the tools emit** —
`maps/{map}.png` per declared channel plus `material.json`, both produced automatically
by core (they are *not* manifest-declared). The op log is recorded for the run record
and the live preview only. Because the emitted maps are authoritative however produced,
there is **no cheat-divergence check** for a material case.

## Procedure

### 1. Choose the surface and confirm it qualifies

Pick a catalog **slug** for the lineage (e.g. `caldera-basalt`) and the **surface** to
author. A material case is about a *tileable surface*, not an object: think "weathered
volcanic basalt," "riveted iron deck plating," "mossy granite," not "a rock." A good
subject:

- **reads as a repeating surface** — it has consistent grain and mesocale detail (a
  brick course, a rust mottle, a stone crack network) rather than a single focal
  feature that would betray the tiling repeat;
- **reads at the declared tiling scale** — decide up front roughly how large one tile
  is in world units, and choose detail that stays legible at that scale (fine sand
  grain reads at a small tile; a brick course needs a larger one). The tiling scale is
  intrinsic to the brief, because the same maps read differently projected small vs.
  large;
- **exercises the maps you declare** — if you ask for a normal map, the surface must
  have relief worth baking (cracks, pits, mortar lines); if you ask for roughness
  variation, it must have wet-vs-dry or polished-vs-worn contrast; if metallic, it must
  have metal-vs-dielectric regions. Do not declare a map the surface gives nothing to
  fill.

Pick a `version` (`vX.Y.Z`).

For `caldera-basalt`: a dark, weathered basalt for the terraced walls and floors of a
volcanic caldera — a base-color of near-black basalt cut by cooled-lava fissures and
mineral crust, relief in the fissures and vesicle pitting, roughness that lifts on the
crusted highlights and drops in the glassy fissures, no metal, and ambient occlusion
sinking the cracks. Emitted maps: `base-color`, `normal`, `roughness`, `ao`.

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file. A material brief has to pin
down more than a sprite brief, because the material is a *set* of maps and each one
means something specific. Cover:

- **the surface** — what it is, its mesoscale structure (the fissure network, the
  vesicle pitting, the crust patches), and how uniform vs. varied it should read across
  a tile. State that it must **tile seamlessly** with no visible repeat, and give the
  **tiling scale intent** in real terms ("one tile covers roughly a 2 m span of caldera
  wall") so the model knows how coarse or fine to work and a reviewer knows how to judge
  the repeat.
- **the exact palette** — named colors with **hex values**, stated as the palette the
  base-color (and emissive, if any) works within, so a reviewer can judge the material
  against the brief unambiguously. Give the basalt body, the fissure glow or mineral
  crust, and any accent as concrete hexes — e.g. basalt body `#1c1a1d`, cooled fissure
  `#2b2f36`, mineral crust `#6b5a44`, ember hint `#7a2a12`.
- **which maps to emit, and what each encodes** — spell out every map the manifest's
  `[material].maps` declares and what the surface should put in it:
  - **base-color** (required, sRGB) — the albedo: the basalt body, the fissure and
    crust colors, no baked lighting or shadow (that is the AO map's job).
  - **normal** (linear) — the surface relief: fissures cut *in*, vesicle pits, the
    raised lip of crust patches. Author this by **painting a grayscale `height` field**
    and **baking** the normal from it (see the tool workflow below), not by
    hand-painting an RGB normal.
  - **roughness** (linear, 0 = mirror … 1 = matte) — where the surface is glassy vs.
    matte: the fissures read glassier (lower roughness), the crust and weathered body
    matte (higher). Give the intended range.
  - **ao** (linear) — baked ambient occlusion darkening the recesses (the fissures, the
    pit bottoms), also baked from the `height` field.
  - Note explicitly which channels you are **not** emitting — `caldera-basalt` declares
    no `metallic` (basalt is a dielectric) and no `emissive` — so the model does not
    waste effort on them.
- **the `height` channel is an authoring aid, not an output** — tell the model to paint
  relief into `height` and bake `normal`/`ao` from it; `height` is never one of the
  emitted maps and is not in `[material].maps`.
- **how the tools behave** — that `texture` is the only way to paint a map and that
  **everything wraps seamlessly** (a stroke off one edge continues on the opposite
  edge, so the map tiles by construction — there is no separate "make seamless" pass);
  that `pbr` bakes the relief maps, sets uniform scalar maps, assembles
  `material.json`, and renders the lit 3D preview; and that the **emitted maps are the
  output** (anything produced outside the tools is discarded). Point the model at the
  `--help` of each tool and its subcommands for the exact operations.

The same self-containment and precise-values rules as an end-to-end spec apply: the
brief must stand on its own, with no link outside the seeded set, and every visual
detail written in real terms (concrete hexes, an explicit roughness range, a stated
tile scale) — never "pick a nice weathered look."

#### How `texture` + `pbr` behave, and the height→normal/AO bake workflow

Fold a short, factual working-the-tools section into the brief so the model knows the
intended path — it should not have to reverse-engineer the workflow from `--help`
alone:

- **Select the map on every op.** Every `texture` operation carries `--map <channel>`
  (`base-color`, `roughness`, `height`, …); it defaults to `base-color`. Each channel
  is its own layered document of the case's `size`.
- **Build the body with procedural generators.** `texture` adds the generators material
  work leans on — `noise --type <perlin|worley|fbm|ridged>` for grain and mottle,
  `pattern --type <bricks|hex|planks|checker|weave>` for regular structure, `warp` to
  distort one map by another, and `gradient-map` to remap a grayscale field to a color
  ramp — each writing into the active map and wrapping to stay tileable. A natural
  basalt body is fbm/worley noise gradient-mapped into the basalt palette.
- **Sculpt relief once, in `height`.** Paint the fissures, pits, and crust lips into the
  grayscale `height` map (brushes, noise, patterns — all seamless), then let `pbr`
  derive the relief maps: `pbr bake-normal --from height --strength <n>` writes the
  `normal` map, `pbr bake-ao --from height --radius <n>` writes (or multiplies into) the
  `ao` map, and `pbr bake-curvature --from height` is available for edge wear. Baking
  from one height field keeps the normal, AO, and any curvature-driven color **coherent**
  — they describe the same relief.
- **Fill flat scalar maps with uniforms.** `pbr set-uniform --map <channel> --value
  <0..1>` fills a scalar map with a constant (a uniform base roughness, a
  fully-dielectric metallic) without hand-painting a flat field; paint variation on top
  in `texture` only where it belongs.
- **Assemble and preview.** `pbr assemble` writes `material.json` (also run
  automatically when the run finishes). `pbr render --shape <sphere|cube|cylinder|plane>`
  renders the **lit 3D preview** of the assembled material on a test surface, applied by
  the same **triplanar projection** a mesh uses — the model should render periodically
  to judge how the maps combine on geometry, not just as flat swatches. `texture`
  re-renders the active map's flat preview (shown 2×2-tiled, so seams show) after every
  op; the `pbr` 3D preview is the one on-request render.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read each
binary's `--help` for the operations (`texture --help`, `pbr --help`, and the
per-subcommand help), and states the hard requirements: author **only** through the
`texture` and `pbr` tools; paint every map seamlessly; emit exactly the declared maps
(base-color plus the rest); and return when finished. The template renders in **strict
mode**, so use only the documented variables — `{{variant.slug}}` / `{{variant.name}}`
/ `{{variant.description}}` and `{{#each specs}}`. Keep it factual: the shared
asset-generation **quality directive** (the brief is the floor, not the goal — produce
the best-looking material you can within its constraints) is prepended to every
asset-generation prompt at render time, so the case's own `prompt.hbs` need not restate
it.

### 4. Write the manifest

Author `test-case.toml` per the
[schema](/testing/asset-generation/manifests/#material-cases). A full, realistic
manifest for the worked example:

```toml
# test-cases/asset-generation/medium/caldera-basalt/v1.0.0/test-case.toml
slug = "caldera-basalt"
name = "Caldera Basalt"
difficulty = "medium"
tags = ["asset-generation", "material", "pbr"]
summary = "A tileable, weathered volcanic-basalt PBR material for terraced caldera terrain."
description = "description.md"
prompt = "prompt.hbs"
max_runtime_hours = 0.5
type = "asset-generation"      # REQUIRED; omitting it defaults to end-to-end, which rejects
                               # the [material]/[tool]/[output] tables below
asset_kind = "material"        # a tileable PBR material — see "Material cases"

# Variants: an ORDERED list of standalone variant files (first = default). As a root
# key it must appear BEFORE the first table header.
variants = ["variants/base.toml"]

# The maps the material carries and how they are baked. Replaces [canvas]/[voxel];
# a material case declares NO [model].
[material]
size = 512                     # square map resolution, a power of two (required)
tile = true                    # seamless authoring: every brush/gradient/filter wraps
                               # across the edges so it tiles without a seam (default true;
                               # required for triplanar application)
maps = ["base-color", "normal", "roughness", "ao"]
                               # the channels this material emits; "base-color" is REQUIRED,
                               # the rest a subset of: normal | roughness | metallic | ao | emissive.
                               # (No metallic — basalt is a dielectric. "height" is an
                               # authoring aid, baked from, NOT emitted, so it is NOT listed.)
background = "transparent"     # preview clear color ONLY (it never paints a map)

# The tools. `binary` names the PRIMARY painter (`texture`); the companion `pbr` binary
# (bake normal/AO, set uniforms, assemble material.json, render the lit 3D preview)
# ships in the SAME `material` run-container image and is on PATH — the brief directs
# the model to both. `preview` is a {map} template: one preview per declared map,
# each shown 2×2-tiled so seams show.
[tool]
binary  = "texture"
preview = "maps/{map}.png"

# The recorded op log — a SINGLE interleaved record (both binaries share one stream;
# each op carries --map). NOT a {map} template. Core emits the per-map PNGs and
# material.json automatically; neither is manifest-declared.
[output]
actions = "actions.json"

# The self-contained brief, seeded for EVERY variant. `dest` defaults to `source`
# with a trailing `.hbs` removed, so naming the source is usually enough.
[[spec]]
source = "specs/brief.md"

# At least one scoring domain, rated for EVERY variant. A variant may add its own.
[[domain]]
id = "fidelity"
name = "Fidelity"
description = "How faithfully the emitted maps realize the brief's surface, palette, and tiling scale."

[[domain]]
id = "craft"
name = "Craft"
description = "How cleanly the material tiles, how coherent the relief/roughness/AO read on the lit preview, and how convincingly it dresses a surface."

# Reviewer checklist items (reporter-side; NOT seeded). Each carries only a domain and
# an optional weight/title/text/id — NOT a reference (a material case has no target).
[[review_item]]
id     = "seamless"
title  = "Tiles without a visible seam"
text   = "In the 2×2 tiling the base-color and normal show no repeat line or hotspot."
weight = 3
domain = "craft"

[[review_item]]
id     = "maps-coherent"
title  = "Maps describe the same surface"
text   = "Normal, roughness, and AO agree with the base-color: fissures read as glassy, recessed, and occluded together."
weight = 2
domain = "craft"

[[review_item]]
id     = "palette"
title  = "On-palette weathered basalt"
text   = "The albedo stays within the brief's basalt/fissure/crust palette and reads as weathered volcanic rock at the stated tile scale."
weight = 2
domain = "fidelity"
```

And the default variant file it lists:

```toml
# test-cases/asset-generation/medium/caldera-basalt/v1.0.0/variants/base.toml
slug = "base"                  # stable slug, recorded in the run record
name = "Base"                  # display name (optional; default humanizes the slug)
spec = []                      # ADDITIVE specs on top of the common specs (none here)
# review_item = [...]          # ADDITIVE reviewer items, if this variant needs its own
# [[domain]]                   # ADDITIONAL domains, rated only when this variant runs
```

Points to get right, most specific to a material case:

- **`type = "asset-generation"`** is required. Omitting it defaults to `end-to-end`,
  which then rejects the `[material]`/`[tool]`/`[output]` tables.
- **`asset_kind = "material"`**, a version-level choice (never a variant axis).
- **`[material]`** replaces `[canvas]`/`[voxel]` and is required for — and only for — a
  material case. `size` must be a **power of two**; `tile` defaults to `true` (leave it
  on — seamless authoring is what makes triplanar projection repeat without seams);
  `maps` **must include `base-color`** and is otherwise any subset of `normal`,
  `roughness`, `metallic`, `ao`, `emissive`. Do **not** list `height` in `maps` — it is
  an authoring aid the tools bake from, not an emitted map. `background` is the preview
  clear color only.
- **No `[model]`** — a material is judged subjectively against its brief, with no
  required-animation contract (that table is for the animated voxel/mesh/skinned kinds).
- **`[tool].binary` is `texture`** (the primary painter); the companion `pbr` binary is
  on `PATH` in the same image — the brief directs the model to both. `[tool].preview` is
  the **`{map}` template** (`maps/{map}.png`), one preview per declared map.
- **`[output].actions` is a single interleaved log** (`actions.json`) — **not** a
  `{map}` template — because both binaries share one recorded op stream and each op
  carries its own `--map`.
- **Core emits the output automatically.** The per-map PNGs (`maps/{map}.png`) and
  `material.json` (map paths, per-map color space, and the world-space tiling scale) are
  produced by core, **not** declared in the manifest. The manifest declares only the
  `actions` log.
- **No `[[reference]]`, no `[build]`, no `[[check]]`.** A material case has no target
  image, produces emitted maps rather than a static site, and its validity is the
  validator's job — declaring any of these is rejected. A `[[review_item]]` must **not**
  carry a `reference` field either.
- **At least one `[[domain]]`**, plus the reviewer `[[review_item]]` checklist that
  guides how the emitted maps and the lit preview are judged against the brief. These
  are reporter-side and **not seeded**.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a run;
keep them honest about what is seeded (the brief) and what the model emits (the maps,
not a replay of its ops).

## Validate your work

There is no separate authoring linter — you validate a case by resolving and seeding
it. For **every** variant:

```sh
tcab prompt --test-case caldera-basalt --version v1.0.0 --variant base
tcab seed   --test-case caldera-basalt --version v1.0.0 --variant base
```

`prompt` renders the instruction (catching strict-mode template errors and manifest
problems — including a missing `type`, a `[material]` without `base-color`, or a `size`
that is not a power of two). `seed` writes the seeded repository to disk so you can read
exactly what the model would receive — the brief, plus the seeded `material.config.json`
— and confirm it is self-contained (no dangling links, every visual detail in real
terms, every declared map explained). When the case is ready, exercise it end to end
with [Run a Test Case](/quickstarts/development/run-a-test-case/), then read the emitted `maps/`
and `material.json` and the `pbr` preview to confirm the material reads as the brief
describes.

If you are editing an **already-ingested** case (or adding `type`/`asset_kind` to one),
the `[material]`/`[tool]`/`[output]` tables live in the backend's immutable def store,
so a re-ingest must be **forced** (`POST /ingest {"force": true}`) or the backend keeps
serving the stale definition; new cases are unaffected.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run of
  your case, judging the material per map, as a 2×2 tiling, and on the lit `pbr`
  preview surface.
