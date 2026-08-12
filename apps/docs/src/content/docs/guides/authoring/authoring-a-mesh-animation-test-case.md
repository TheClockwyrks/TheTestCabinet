---
title: Authoring a Mesh Animation Test Case
---

## Overview

A mesh-animation [asset-generation](/testing/asset-generation/overview/) test
case asks a model to sculpt and rig a 3D model by compositing signed-distance
fields with a meshing binary (`mc-anim`, `sn-anim`, or `dc-anim`), one recorded
operation at a time, toward a goal described in a brief. The binary extracts a
triangle mesh per part. There is no target model, and the result is reviewed
against the brief.

It is the surface-extraction sibling of the
[voxel animation](/guides/authoring/authoring-a-voxel-animation-test-case/):
instead of one field of opaque cubes, the model produces a rig of named parts in
a parent/child hierarchy, each an independently authored signed-distance field
meshed on its own, with named joints and model-authored animations a consuming
game poses and plays.

Read the authoritative pages first:

- [Overview](/testing/asset-generation/overview/#voxel-and-meshed-models) covers
  what the type measures and how the required animations are the contract while
  the parts and joints are the model's to invent;
- [Mesh binaries](/testing/asset-generation/mesh-binaries/) covers the `-anim`
  interface: the signed-distance field, the CSG vocabulary, the Dual-Contouring
  `--sharp` tag, the required per-operation `--part`, and the per-part output;
- [Voxel binaries](/testing/asset-generation/voxel-binaries/) covers the shared
  rig subcommands and F-curve interpolation;
- [Rigging walkers](/testing/asset-generation/rigging-walkers/) gives the design
  guidance for legged rigs and walk cycles;
- [Voxel cases](/testing/asset-generation/manifests/voxel-cases/) is the schema,
  including the `[[model.animation]]` declarations;
- [Evaluation](/testing/asset-generation/evaluation/#the-rig) covers per-part
  review and the animation reconciliation, where a missing required animation, or
  one that never animates, is a recorded, zero-scored contract gap.

A static meshed model belongs in
[a mesh-model case](/guides/authoring/authoring-a-mesh-model-test-case/), a
rigged cube model in
[a voxel-animation case](/guides/authoring/authoring-a-voxel-animation-test-case/),
and a continuous-skin character in
[a skinned case](/guides/authoring/authoring-a-skinned-test-case/).
To add a variant to an existing version, see
[Creating a Mesh Animation Variant](/guides/authoring/creating-a-mesh-animation-variant/).

## Mesh animation versus the skinned kinds

The rigid `-animation` kinds and the skinned kinds share the CSG sculpting and
the F-curve rig, and differ in how the rig moves the geometry.

- A rigid `-animation` kind builds a separate mesh per part, each posed rigidly
  about a pivot, with a seam at every joint. That is the right read for a tank, a
  turret, a mech, or a walking fortress.
- A skinned kind builds one continuous mesh bound to a skeleton and deforms it by
  per-vertex weights, so the skin stretches and folds across the joint. That is
  what a limbed creature or a fabric-and-flesh character needs.

Author a mesh-animation case when the subject is a rigid machine or structure
whose components pivot, sweep, and stride without deforming.

## Choosing the kind

The three animated meshed kinds share one authoring workflow and differ in which
`-anim` binary the case names and the surface character that binary produces,
which is a property of the binary rather than a manifest knob.

| `asset_kind` | binary | surface character | pick for |
| --- | --- | --- | --- |
| `mc-animation` | `mc-anim` (Marching Cubes) | bold low poly: chunky, faceted, coarse grid | stylized, blocky machines |
| `sn-animation` | `sn-anim` (Surface Nets) | smooth mid-fidelity: rounded, watertight, uniform | smooth, rounded forms |
| `dc-animation` | `dc-anim` (Dual Contouring) | crisp: preserves sharp edges and corners | armored, hard-surface machines |

Dual Contouring adds a per-primitive `--sharp` and `--smooth` tag. The kind is a
property of the whole version, so a case is exactly one kind.

The worked examples are the Aegis walking fortress, rigged and animated once per
algorithm as `aegis-mc-anim`, `aegis-sn-anim`, and `aegis-dc-anim` under
`test-cases/asset-generation/hard/`. Each `[model]` fixes three required
animations: a `march` walk, a `bombardment` weapon showcase, and a self-playing
`radar_spin`. The model invents the legs, turrets, and joints that carry them.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`.
Versioning is per-case and immutable: once a run references a version, that
version is frozen. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, [voxel], [tool], [output], [model]
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  changelog.md            # per-version site-facing entry (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/brief.md          # what to sculpt, how it moves, how the tool behaves (SEEDED)
```

A run receives the selected variant's brief, the seeded `<binary>.config.json`,
and a `rig.json` pre-populated with the case's required animation declarations
and any declared caller joints, with empty tracks the model fills. The `-anim`
binary is on its `PATH` and its `--help` is the operations and rig-subcommand
contract, so no operations schema is seeded.

The per-part extracted meshes are emitted as binary glTF under `meshes/`, and
`rig.json` is written back, by core when the model runs `render`. Neither is
declared in the manifest.

## Procedure

### 1. Choose the subject, the algorithm, and the required animations

Pick a catalog slug and a subject that is naturally articulated, with distinct
movable components a game would want to see move. Pick the algorithm for the
surface character you want, which fixes the `asset_kind` and the `[tool].binary`.

The rig contract you fix is the set of required animations, exactly as for a
voxel animation. For each motion declare a `[[model.animation]]` with a `name` a
game plays it by, whether it `loop`s (default `true`), and whether it
`auto_play`s (`true` for a self-playing idle, `false` for a game-triggered
playable). The parts, joints, pivots, ranges, and pose angles are the model's to
invent, and working them out is the test. See
[the voxel-animation guide](/guides/authoring/authoring-a-voxel-animation-test-case/)
for the full detail. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- what to sculpt: the subject, its silhouette and orientation, and the volume
  framing (which axis is up, which way is forward);
- the exact palette: named opaque `#rrggbb` values, the only colors allowed;
- how meshing works: the binary maintains a signed-distance field per part and
  meshes each part's surface, shaped by compositing primitives (`add-*` and
  `subtract-*`), `--blend` for a smooth join (default `0` for a hard union), and
  the whole-field edits;
- which extractor meshes the fields: name the binary and state factually how it
  reconstructs the surface, and for `dc-anim` that a per-primitive `--sharp` or
  `--smooth` tag holds or rounds an edge. How to exploit it is the model's design
  choice;
- the subject's key features: name the components that must read and how they
  relate. Each part the model defines is its own field, sculpted separately with
  `<binary> --part <name>` in the shared volume's coordinates and positioned
  where it sits on the assembled model;
- how the tool behaves: the `-anim` binary is the only way to shape the field and
  edit the rig, `--part` is required on every operation, `--help` lists the
  operations and the rig subcommands, and a sculpting operation only records. The
  binary's `render` draws each part's preview and the assembled-scene previews
  and emits the per-part geometry, with `render --component <part>` for one part
  and `render --time <ms> --animation <name>` to preview a motion, so the model
  must render before finishing;
- the required animations: name each one, describe the behavior it must show, and
  state whether it loops and whether it self-plays;
- that the model may add parts, joints, and animations beyond the required set
  while still authoring every required animation.

Pin only the true requirements: the volume, the exact palette, the extractor's
character, and the required animation names. Describe motion in world terms and
keep the required animation set minimal, exactly as the
[brief rules](/guides/authoring/authoring-a-voxel-animation-test-case/#writing-the-brief)
for a voxel animation describe. The shared quality directive (`ASSET_QUALITY_PREAMBLE` in
`crates/core/src/prompt.rs`) is prepended to every asset-generation prompt at
render time, so the brief stays factual.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read
the `-anim` binary's `--help` for the operations and the rig subcommands, names
the field vocabulary (`add-*`, `subtract-*`, `--blend`, and for `dc-anim`
`--sharp` and `--smooth`), and restates the hard requirements: shape and rig only
through the tool, pass `--part` on every operation, author every required
animation so it actually animates, run `render` to draw and read each part's
preview and the assembled-scene previews and again before finishing so the
geometry is emitted, and return when finished.

The template renders in strict mode, and the available variables are
`{{workspace}}`, `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{#each specs}}`, `{{time_limit_hours}}`, and
`{{voxel}}`.

### 4. Write the manifest

Author `test-case.toml` per the
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) schema.

- Metadata. `slug` (the stable identity every run records, normally the
  folder name), `name`, `difficulty`, `tags` (include the algorithm), `summary`,
  `description`, `prompt`, and `max_runtime_hours`.
- `type = "asset-generation"` and `asset_kind` are both required. `asset_kind` is
  one of `"mc-animation"`, `"sn-animation"`, or `"dc-animation"`.
- `[voxel]` fixes `width`, `height`, `depth`, and the preview `background`,
  framing each part's field, which starts empty. The case must not declare
  `[canvas]`. Size the volume with the
  [scale rule](/guides/authoring/authoring-a-voxel-model-test-case/#sizing-the-volume)
  the voxel-model guide states.
- `[tool]` names the `-anim` binary for the kind and a `preview` path that
  must carry the `{part}` token, such as `parts/{part}.png`.
- `[output]` names an `actions` path that must carry the `{part}` token, such
  as `parts/{part}.actions.json`.
- `[model]` is required for this kind and carries the required
  `[[model.animation]]` entries, each a unique `name`, a `loop` flag (default
  `true`), and an `auto_play` flag (default `false`). Declare no period, no joint
  list, and no keyframes. A case may also declare `[[model.joint]]` caller DOFs,
  the runtime-drivable degrees of freedom a game sets each frame.
- `variants` is an ordered array of paths to standalone variant files, the
  first being the default. As a root key it precedes the first table header.
- No `[[reference]]`, `[build]`, or `[[check]]`. Resolution rejects all
  three, and the emitted geometry and rig are what is judged.
- `[[domain]]` declares the single `overall` scoring domain, and the case
  declares no review checklist. The produced rig is judged as a whole against the
  brief, with the 3D viewer posing the rig and playing every produced animation.

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md`, and `README.md`. These never reach
a run.

## Validate your work

Lint the specs from the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell
```

If `cspell` flags a legitimate domain term, add it to
`.cspell/project-words.txt`.

Then render the prompt and seed the repository for every variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including a duplicate
animation `name` and a missing `{part}` token on `preview` or `actions`. `seed`
writes the seeded repository (under `tmp/`) so you can read exactly what the
model receives: the brief, the seeded `<binary>.config.json`, and the pre-seeded
`rig.json` holding the required animation declarations.

### Re-ingest after editing

A backend-driven run resolves its definition from the backend's immutable
definition store, which skips a version it already holds. After editing a case,
force a re-ingest:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place, so use it only while
iterating on a version no run has been published against. Once a published run
references a version, revise by creating a new version. See
[Running the services locally](/development/running/).

When the case is ready, exercise it with
[Run a Test Case](/quickstarts/development/run-a-test-case/). Commit with a
conventional-commit message scoped to the case, such as
`feat(<slug>): add <version>`.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case. The reviewer judges the produced parts and
  animations against the brief and the required set, then gives the run its one
  overall rating.
