---
title: Authoring a Voxel Animation Test Case
---

## Overview

A voxel-animation [asset-generation](/testing/asset-generation/overview/) test
case asks a model to sculpt and rig a 3D model out of opaque `#rrggbb` voxels
with the `voxel-anim` binary, one recorded operation at a time, toward a goal
described in a brief. Instead of animation frames the model produces a rig: named
parts in a parent/child hierarchy with named joints it invents, plus the
animations a consuming game plays. There is no target model, and the result is
reviewed against the brief.

The defining requirement is the animation contract. The case's `[model]` table
declares the set of required animations the model must author, each by name, a
`loop` flag, and an `auto_play` flag. That set is the game-facing interface and
the reviewer's scoring target. The parts, joints, pivots, ranges, and pose angles
are the model's to invent at run time, and working them out is the test. The
produced `rig.json` carries the result, and the validator reconciles that each
required animation exists and actually animates.

Read the authoritative pages first:
[Voxel binaries](/testing/asset-generation/voxel-binaries/) for the `voxel-anim`
operation set, the required `--part`, the seeded `voxel-anim.config.json`, the
per-part and assembled-scene previews, the rig subcommands, and F-curve
interpolation; [Voxel cases](/testing/asset-generation/manifests/voxel-cases/)
for the schema; and
[Evaluation](/testing/asset-generation/evaluation/#voxel-validation) for the
animation reconciliation, where a missing required animation, or one that never
animates, is a recorded, zero-scored contract gap.

This guide covers the `voxel-animation` kind. A static cube model belongs in
[a voxel-model case](/guides/authoring/authoring-a-voxel-model-test-case/), a
rigged meshed model in
[a mesh-animation case](/guides/authoring/authoring-a-mesh-animation-test-case/),
and a character whose skin deforms across its joints in
[a skinned case](/guides/authoring/authoring-a-skinned-test-case/). To add a
variant to an existing version, see
[the variant guide](/guides/authoring/creating-a-voxel-animation-variant/).

The worked example is the `ironward` siege tank, whose `[model]` fixes a single
required animation (`turret_sweep`, a game-triggered playable that swivels the
gun across its arc) while the model invents the chassis, turret, and barrel parts
and the joints that carry them.

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

A run receives the selected variant's brief, the seeded
`voxel-anim.config.json`, and a `rig.json` pre-populated with the case's required
animation declarations and any declared caller joints, with empty tracks the
model fills. The `voxel-anim` binary is on its `PATH` and its `--help` is the
operations and rig-subcommand contract, so no operations schema is seeded.

## Procedure

### 1. Choose the subject and the required animations

Pick a catalog slug and a subject that is naturally articulated, with distinct
movable components a game would want to see move. The rig contract you fix is the
set of required animations. For each motion the subject must perform, decide:

- a `name` a game plays it by, such as `march`, `bombardment`, or `radar_spin`;
- whether it `loop`s, default `true`;
- whether it `auto_play`s: `true` for a self-playing idle that runs on its own
  under everything else, `false` for a game-triggered playable.

Describe in prose what each animation must show, and leave the joints that
produce it to the model. Keep the required set to the motions a game truly needs;
the model may add its own on top. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- what to sculpt: the subject, its silhouette and orientation, and the volume
  framing (which axis is up, which way is forward);
- the exact palette: named `#rrggbb` values, the only colors allowed;
- the subject's key features: name the components that must read and how they
  relate. Each part the model defines is sculpted separately with
  `voxel-anim --part <name>` in the shared volume's coordinates, positioned where
  it sits on the assembled model;
- how the tool behaves: `voxel-anim` is the only way to place a voxel and edit
  the rig, `--part` is required on every operation, `--help` lists the operations
  and rig subcommands, and a sculpting operation only records. `voxel-anim
render` draws each part's preview and the assembled-scene previews under
  `scene/` (`iso`, `front`, `side`, `top`) and emits the geometry, with
  `render --component <part>` for one part and `render --time <ms> --animation
<name>` to preview a motion, so the model must render before finishing;
- the required animations: name each one, describe the behavior it must show,
  and state whether it loops and whether it self-plays;
- that the model may add parts, joints, and animations beyond the required set
  while still authoring every required animation.

A brief authored as `specs/brief.md.hbs` reads its volume from `{{voxel.width}}`,
`{{voxel.height}}`, `{{voxel.depth}}`, and the inclusive maxima `{{voxel.maxX}}`,
`{{voxel.maxY}}`, and `{{voxel.maxZ}}`, so one brief serves every size variant.

The shared quality directive (`ASSET_QUALITY_PREAMBLE` in
`crates/core/src/prompt.rs`) is prepended to every asset-generation prompt at
render time, so the brief stays factual.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read
`voxel-anim --help` for the operations and the rig subcommands, and restates the
hard requirements: sculpt and rig only through the tool, pass `--part` on every
operation, author every required animation, run `voxel-anim render` to draw and
read each `parts/<part>.png` and the assembled-scene previews and again before
finishing so the geometry is emitted, and return when finished. The scene
previews are how the model confirms its separately sculpted parts fit together.

The template renders in strict mode, and the available variables are
`{{workspace}}`, `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{#each specs}}`, `{{time_limit_hours}}`, and
`{{voxel}}`.

### 4. Write the manifest

Author `test-case.toml` per the
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) schema.

- Metadata. `slug` (the stable identity every run records, normally the
  folder name), `name`, `difficulty`, `tags`, `summary`, `description`, `prompt`,
  and `max_runtime_hours`.
- `type = "asset-generation"` and `asset_kind = "voxel-animation"` are both
  required.
- `[voxel]` fixes `width`, `height`, `depth`, and the preview `background`.
  The volume starts empty, and a voxel case must not declare `[canvas]`. Size it
  with the
  [scale rule](/guides/authoring/authoring-a-voxel-model-test-case/#sizing-the-volume)
  the voxel-model guide states.
- `[tool]` names `binary = "voxel-anim"` and a `preview` path that must carry
  the `{part}` token, such as `parts/{part}.png`.
- `[output]` names an `actions` path that must carry the `{part}` token, such
  as `parts/{part}.actions.json`. The per-part logs are the authoritative output.
- `[model]` is required for this kind. Each `[[model.animation]]` entry
  declares a `name` unique across the set, a `loop` flag (default `true`), and an
  `auto_play` flag (default `false`). Declare no period, no joint list, and no
  keyframes: the period, the joints, and the F-curves are the model's to invent
  at run time with `define-animation` and `add-keyframe`, using `constant`,
  `linear`, or `bezier` interpolation and the ease presets. A case may also
  declare `[[model.joint]]` caller DOFs, the runtime-drivable degrees of freedom
  a game sets each frame.
- `variants` is an ordered array of paths to standalone variant files, the
  first being the default. As a root key it precedes the first table header.
- No `[[reference]]`, `[build]`, or `[[check]]`. Resolution rejects all
  three.
- `[[domain]]` declares the single `overall` scoring domain, and the case
  declares no review checklist. The produced rig is judged as a whole against the
  brief, with the 3D viewer posing the rig and playing every produced animation.

An example `[model]` table, from `ironward`:

```toml
[model]

[[model.animation]]
name = "turret_sweep"
loop = true
auto_play = false
```

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md`, and `README.md`. These never reach
a run.

## Writing the brief

The brief is the test case. The rules that make one good:

- Be self-contained. No link outside the seeded set, and no target model.
  Point at the binary's `--help` for the operations and rig subcommands.
- Specify what rather than how. Describe what the subject is and how it must
  move, and pin only the true requirements: the volume, the exact palette, and
  the required animation names. Working out the pieces a moving subject needs and
  where they attach is the test.
- Use precise, testable values for what you pin. Exact `#rrggbb` colors, the
  volume framing, the silhouette features that must read, and the behavior each
  animation must show, such as "the turret sweeps a full half-turn each way with
  every voxel of it staying on the hull".
- Describe motion in world terms. Say what the viewer should see: the barrel
  elevates; the feet stay flat on the ground and the body advances over them so
  it reads as a heavy machine pushing itself forward. Leave the rig mechanics
  that achieve it to the model. The
  [walker-rigging doc](/testing/asset-generation/rigging-walkers/) exists to help
  you state that requirement crisply; its mechanics stay out of the brief.
- Keep the required animation set minimal and stable. A game plays the
  required animations by name, so keep them few and well named. Extra motion
  belongs in model-added animations.
- Use emphasis sparingly. Bold a genuine hard constraint such as the palette,
  the volume, or a required animation name.
- Keep the bar high. Ask for a model that both reads as the subject and
  animates convincingly; the review UI plays the produced animations.

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
model receives: the brief, the seeded `voxel-anim.config.json`, and the
pre-seeded `rig.json` holding the required animation declarations.

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
  assesses a run of your case. The reviewer judges how well the model reads as the
  subject and how each produced animation reads against the required set, then
  gives the run its one overall rating.
