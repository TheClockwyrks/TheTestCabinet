---
title: Authoring a Particle Test Case
---

A [particle](/testing/asset-generation/particle-binaries/) asset-generation test
case asks a model to **author a visual effect** — an explosion, a muzzle flash, an
engine plume, a splash, a victory burst — with the `particle-2d` or `particle-3d`
binary, one recorded operation at a time, to **match a written brief**. The one
thing to fix up front is the paradigm: the model does **not** place individual
particles. It **authors a system** — emitters, forces, and per-particle F-curves —
that the review UI and a game **simulate live**, exactly the way a real particle
editor (Unreal's Niagara, Unity's VFX Graph) plays a system. The authored
**`system.json` definition is the asset**; every consumer plays it by running the
simulation. There is **no target frame sequence** and **no bake**: the model is
given a precise description and the freedom to build a system that reads as that
effect, so the case rewards a well-shaped effect rather than the reproduction of a
supplied clip. Authoring one is mostly writing a precise, **self-contained brief**.

[Manifests](/testing/asset-generation/manifests/) (the "Particle cases" section) is
the authoritative schema — every field and the rules enforced at resolution — and
you should read it first, along with
[The particle binaries](/testing/asset-generation/particle-binaries/) (the emitter,
force, and curve operations, and why the emitted system — not any frame on disk —
is the output), the [Overview](/testing/asset-generation/overview/#particle-effects),
and [Evaluation](/testing/asset-generation/evaluation/#particle-validation) (how a
particle effect is human-reviewed against its brief by simulating it live).

Building a playable game instead is a different test type with its own manifest;
see [Authoring an End-to-End Test Case](/guides/authoring-an-end-to-end-test-case/).
Other asset kinds — sprites, voxel and meshed models, skinned characters, audio —
have their own guides; this one covers the **particle** kinds only.

A case authors **one effect** in **either 2D or 3D**, chosen by the manifest's
`asset_kind` — a version-level choice, not a variant:

- **`particle-2d`** — a planar, screen-space effect (a 2D field with **width and
  height** only), drawn with the `particle-2d` binary and composited in a 2D raster
  path. Good for UI, 2D-game, and screen-space VFX. The worked example
  **`spectra-burst`** is a screen-space enemy-explosion / muzzle VFX.
- **`particle-3d`** — a volumetric effect (a volume with **width, height, and
  depth**), drawn with the `particle-3d` binary and rendered as `wgpu` orbit
  billboards. This is what the [3D games](/testing/asset-generation/mesh-binaries/)
  consume. The worked example **`thunderhead-flak`** is a volumetric flak-burst /
  shell explosion; it is the primary manifest example below.

Read the worked example matching the kind you are authoring alongside this guide; a
new case should look like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, particle, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: the effect + how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief. There is **no
target clip** and **no simulation seed** — the model authors a system to match the
brief, not to reproduce a supplied effect. It also gets the `particle-2d` (or
`particle-3d`) binary in its environment, whose `--help` is the operations
contract; **no operations schema is seeded**. The orchestrator seeds a
`particle-3d.config.json` (or `particle-2d.config.json`) alongside the workspace
carrying the `[particle]` field dimensions, the duration and playback fps, and the
log / preview / `system.json` paths, so neither an operation nor `render` needs any
of those flags. Everything marked *NOT seeded* is authoring- or site-side only.

## Procedure

### 1. Choose 2D vs 3D and the subject

Pick `particle-2d` for a planar, screen-space effect and `particle-3d` for a
volumetric one that lives in a 3D scene — a choice driven by where the effect is
consumed. Then pick a catalog **slug** for the lineage (e.g. `thunderhead-flak`)
and the **subject**: a **self-contained VFX moment** that reads on its own from its
motion, color, and timing alone, needs no surrounding game context, and is
achievable within the tool's emitter/force/curve vocabulary. Pick a `version`
(`vX.Y.Z`).

Because the effect is **simulated live and varies slightly from one play to the
next**, choose a subject whose *character* is what matters — the read of an
explosion, a plume, a burst — not one that depends on an exact, frozen arrangement
of particles. A good particle subject reads the same across replays.

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file describing:

- **what the effect depicts** — the VFX moment (a flak shell detonating, an enemy
  popping, a muzzle flash), its overall silhouette, and how it sits in the
  `[particle]` field;
- its **lifecycle and timing over `duration_ms`** — what happens at the start
  (the initial burst or ignition), through the middle (expansion, drift, secondary
  sparks), and at the end (decay to empty for a one-shot, or the steady state a loop
  settles into) — described in real terms against the duration;
- the **emitters and forces, conceptually** — what spawns (a burst core, a spark
  ring, a smoke plume), roughly how fast and for how long, and which forces shape
  the motion (gravity, drag, a radial explosion push, a vortex, curl-noise
  turbulence, wind) — written as intent, not as exact flags, since the model reads
  the binary's `--help` for the operations;
- the **color, opacity, and size curves** — how each particle looks over its life
  (fire runs white → orange → red → smoke; a spark fades and shrinks as it dies),
  stated as the read you want;
- the **exact palette** — named colors with hex values, stated as the only colors
  allowed, so a reviewer can judge the effect against the brief unambiguously;
- **one-shot vs loop** — whether the effect is a **one-shot** that decays to empty
  (an explosion, the default) or a **loop** that settles into a steady state (fire,
  smoke), matching the manifest's `loop` flag;
- **how the tool behaves** — that the particle binary is the only way to shape the
  effect, that it authors a *system* (not individual particles) that is
  **simulated live**, that `render` simulates the system and emits the
  `system.json` the result is built from, and that the effect therefore **varies
  slightly from play to play** and should read well across replays.

The same self-containment and precise-values rules as an end-to-end spec apply: the
brief must stand on its own, with no link outside the seeded set, and every visual
detail written in real terms.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the operations, and states the hard requirements: shape the
effect only through the tool; author a *system* (emitters, forces, per-particle
curves) rather than individual particles; run `render` to simulate and emit
`system.json` before finishing; return when done. The template renders in **strict
mode**, so use only the documented variables —
`{{variant.slug}}`/`{{variant.name}}`/`{{variant.description}}` and
`{{#each specs}}`.

### 4. Write the manifest

Author `test-case.toml` per the
[schema](/testing/asset-generation/manifests/#particle-cases). A realistic
`particle-3d` example for **`thunderhead-flak`**:

```toml
slug       = "thunderhead-flak"
name       = "Thunderhead Flak Burst"
difficulty = "medium"
tags       = ["asset-generation", "particle", "3d", "explosion", "vfx"]
prompt     = "prompt.hbs"
description = "description.md"
type       = "asset-generation"

# A 3D particle effect: a volumetric flak-shell detonation.
asset_kind = "particle-3d"

# Variants: a root key, so it MUST appear before the first table header below.
variants = ["variants/base.toml"]

# The field the effect plays in. particle-3d gives width/height/depth (a volume,
# like [voxel]); a particle-2d case would give width/height only (a 2D field).
[particle]
width       = 64             # extent along x (required)
height      = 64             # extent along y — up (required)
depth       = 64             # extent along z (required for particle-3d; omitted for particle-2d)
duration_ms = 1200           # the effect's length in milliseconds (required)
fps         = 60             # the preview/playback frame rate (required, > 0)
loop        = false          # one-shot — a shell that bursts and decays to empty (default)
background  = "transparent"  # preview clear color only

[tool]
binary  = "particle-3d"      # the particle binary: particle-2d | particle-3d
preview = "effect.gif"       # where the binary writes the preview animation

[output]
actions = "actions.json"     # the recorded op record; core emits the authored
                             # system.json automatically (not declared here)

# The self-contained brief, seeded for EVERY variant (dest defaults to source).
[[spec]]
source = "specs/brief.md"

# At least one scoring domain, rated for EVERY variant; each REQUIRES a description.
[[domain]]
id   = "read"
name = "Effect read"
description = "How clearly the simulated effect reads as the brief's subject — its core, burst, and lingering elements, in the declared palette."

[[domain]]
id   = "motion"
name = "Motion & timing"
description = "How well the effect is paced over its duration_ms — the initial burst, the expansion/drift, and the clean decay — and how consistently it reads across live replays."

[[review_item]]
domain = "read"
title  = "Reads as a flak burst"
text   = "The effect reads as an airburst shell: a bright detonation core, an expanding smoke ring, and falling sparks, in the declared palette."

[[review_item]]
domain = "motion"
title  = "Lifecycle over the duration"
text   = "Bursts hard at the start, expands and drifts through the middle, and decays cleanly to empty by the end of duration_ms; reads the same across replays."
```

Notes on the fields, and what a particle case leaves out:

- **Metadata** — `name`, `difficulty`, and `tags` are required and site-facing.
- **`type = "asset-generation"`** is required. Omitting it defaults to `end-to-end`,
  which then rejects the tables below.
- **`asset_kind`** picks the binary: `"particle-2d"` or `"particle-3d"`.
- **`[particle]`** fixes the field the effect plays in — `width`/`height` (and, for
  `particle-3d`, `depth`), `duration_ms`, playback `fps` (> 0), the `loop` flag
  (`false` = one-shot like an explosion, the default; `true` = looping like fire or
  smoke), and a `background` used only as the preview's clear color. It is required
  for — and only for — a particle case, and **replaces `[canvas]`/`[voxel]`**. For a
  `particle-2d` case, **omit `depth`**. There is **no simulation seed**: the effect
  is simulated live, so it varies slightly from one play to the next.
- **`[tool]`** — the `binary` and the `preview` path the binary writes its preview
  animation to (e.g. `effect.gif`) when it runs `render`. **No operations schema** —
  the binary's `--help` is the contract.
- **`[output]`** — only the `actions` op log. Core emits the authored **`system.json`**
  (the emitter/force/curve definition the review UI and a game simulate live)
  **automatically**; it is **not** manifest-declared.
- **No `[model]`** — a particle effect carries no game-facing rig interface and no
  required-animation contract; it is judged subjectively against its brief.
- **A `variants` list** — an ordered array of paths to standalone variant files
  under `variants/` (the first is the default; at least one is required, usually
  `base`), each a self-contained TOML document. As a root key it must precede the
  first table header.
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain and the
  reviewer checklist that guides how the simulated effect is judged against the
  brief. A review item carries only a `domain` (and an optional weight, title, text,
  or id); it must **not** carry a `reference` field — there is no target to point
  at, and one is rejected. These are reporter-side and **not seeded**.

A particle case declares **no `[[reference]]`** (there is no target clip; the effect
is reviewed against the brief), **no `[build]`** (it produces a recorded system, not
a static site), and **no `[[check]]`** — and there is **no cheat-divergence check**,
which applies only to the pixel-drawing `draw`/`draw-sheet` tools. A particle run is
scored on the **system it emits** and the preview the simulation plays.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded and about the fact that the effect is
simulated live rather than baked.

## Validate your work

There is no separate authoring linter — you validate a case by resolving and seeding
it. For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` renders the instruction (catching strict-mode template errors and manifest
problems); `seed` writes the seeded repository to disk so you can read exactly what
the model would receive — the brief, plus the seeded `particle-3d.config.json` (or
`particle-2d.config.json`) — and confirm it is self-contained. When the case is
ready, exercise it end to end with [Run a Test Case](/quickstarts/run-a-test-case/).

## Next steps

- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess a run
  of your case, playing the emitted system live in the review UI.
