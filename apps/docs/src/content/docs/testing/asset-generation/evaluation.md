---
title: Evaluation
---

An asset-generation run is validated by
[`crates/core`](/components/core/overview/) and then rated by a person. There is
no target asset and no automated similarity score. The validator confirms that
what the run produced is well-formed and satisfies the case's contract, and the
reviewer judges it against the brief.

Which artifact is authoritative depends on the kind. The `sprite` and
`sprite-sheet` kinds are scored on the image regenerated from their recorded
action log. Every other kind is scored on the data its binary emitted.

## Regeneration

For a sprite kind, the validator replays the recorded operations through the same
drawing logic the binary used and takes the regenerated image as the run's
output. Because the regeneration runs exactly the operations the model issued, an
image produced by any other means contributes nothing to the result. This is what
makes the constrained drawing channel enforceable.

For a sprite sheet each frame is its own file, so each is regenerated
independently and carries its own cheat-divergence number. There is no
whole-sheet aggregate. The declared
[sequences](/testing/asset-generation/manifests/sprite-cases/) are played back as
live animations in the review UI, in each sequence's frame order, so a person can
judge the motion the sheet encodes.

## Cheat detection

Comparing the regenerated image against the model's final on-disk image is a
second, independent signal. If a model drew only through the binary, the two
match. If they diverge, the model put pixels on the canvas outside the recorded
operations, for instance by writing an image file directly. The divergence is
recorded so a reviewer sees it. Only the regenerated image is ever scored, so a
model gains nothing from drawing outside the tool.

This check applies only to the pixel-drawing tools, `draw` and `draw-sheet`,
whose scored image is regenerated from the log. Every other kind is judged on the
data it emitted, whatever produced it. A Blender run carries an analogous
[provenance re-run](#blender-validation).

## UI validation

A `ui` run is scored on the flattened image data the
[`paint`/`ui` binaries](/testing/asset-generation/ui-binaries/) emit. The
operation log is neither replayed nor re-composited. The validator checks:

- Each element's flattened RGBA PNG, at the path `[tool].preview` names, one per
  declared element for a kit and a single file otherwise. Each must decode and
  match the element's declared size.
- The emitted `ui.json`, which must parse, must carry no degenerate atlas
  rectangle, and whose per-element `nine_slice` insets must fit within that
  element's declared bounds.

The review UI shows each element and can render its nine-slice stretch previews,
so a reviewer checks that a panel or button scales cleanly as well as judging its
static art.

## Material validation

A `material` run is scored on the maps the
[`texture`/`pbr` binaries](/testing/asset-generation/material-binaries/) emit.
The validator decodes each declared map at the path `[tool].preview` names,
confirming it is a well-formed PNG of the declared square `size`, and records the
required `base-color` map failing to decode. It parses `material.json` for each
map's color space and the tiling scale, defaulting the color space to sRGB for
`base-color` and `emissive` and linear for the rest.

A reviewer judges the material per map, as a 2×2 tiling so seams show, and on the
lit 3D preview the `pbr` tool renders, where the material is applied to a test
surface by
[triplanar projection](/testing/asset-generation/material-binaries/#the-triplanar-consumption-model).

## Voxel validation

A voxel run is scored on the data its binary emits. The operation log is not
re-run and no preview is re-rendered. The validator parses the emitted data, per
part, and confirms it is well-formed and readable:

- The emitted geometry, a per-part `.glb` decoded into the `PartMesh` shape the
  runtime and the
  [glTF exporter](/components/voxel-runtime/overview/#exporting-to-gltf)
  consume. The cube tools emit a face-culled cube mesh in the same form. This is
  a produced artifact rather than part of the run record, and it is what the
  frontend renders as an interactive 3D model with three.js.
- The rendered preview PNGs the binary wrote during the run, taken as the
  reviewer sees them.

The validator confirms the emitted data is parseable, within the declared volume,
and satisfying the [rig contract](#the-rig) for an animated model. It does not
re-derive the geometry or police how it was produced.

A static model has one part, the whole model, so it emits one geometry set and
one preview. An animated model emits one set per part it defines, with no
assembled-model aggregate.

### The rig

For an animated model the model authors the mesh, the animations, and the rig
that carries them. The parts, joints, and pivots are the model's to devise. The
only rig contract a case fixes is the set of required animations, by name.

The validator derives the parts to score from the model-produced `rig.json` and
reconciles it against that contract. Each required animation must be present and
must carry keyframes. A missing or empty required animation is recorded as
a zero-scored contract gap rather than aborting evaluation, because the required
motions are the scoring targets.

The run record carries both the required animation contract and the produced rig,
so the 3D viewer poses the full rig and plays the animations back without a
separate catalog lookup. The reviewer scores the produced motion alongside the
mesh, such as a walk with a planted stance or the snap of a recoil, with the
review UI playing each animation beside each caller joint's live control.

### Skinned characters

A skinned run is validated like an animated voxel run with one shape difference:
it emits one skinned `mesh.glb` and one `rig.json`, because a skinned model is a
single continuous field rather than a set of parts.

The validator decodes the glb, confirming its skin binding is well-formed with
per-vertex bone weights, inverse-bind matrices, and the joint node hierarchy,
parses `rig.json`, and applies the same rig contract. The reviewer scores how
well the skin deforms: an elbow that bends without tearing, a stride that reads as
a walking creature, with the 3D viewer posing the rig by linear-blend skinning.

## Blender validation

A Blender run is scored on the native glTF the model's `build.py` exported
through headless Blender. The validator decodes it, `character.glb` for a
character and `model.glb` for a prop or mechanism, confirms it is well-formed and
carries at least one mesh, and applies the per-kind contract:

- A `blender-character` must also carry a skin, a skeleton-bound mesh with bones,
  per-vertex weights, and inverse-bind matrices. Its glTF named animations are
  reconciled against the case's
  [required set](/testing/asset-generation/manifests/blender-cases/).
- A `blender-mechanism` reconciles its named animations the same way and requires
  no skin, because its motion is glTF node-hierarchy clips.
- A `blender-prop` is static, so only the well-formed-mesh check applies.

Each required animation must be present and carry channels; a missing one is
recorded as a zero-scored contract gap. The animated kinds also carry the
[caller DOFs](/testing/asset-generation/blender-binaries/#runtime-control-caller-dofs-and-node-extras)
a game sets each frame to aim the asset. Each required `[[model.joint]]` must be
exposed as a node whose `extras.tcab_joint` tag carries that name with the right
kind and axis; a missing or mis-typed DOF is another recorded contract gap.

A Blender run's rig lives in the glTF itself, in its skin, its animations, and
the DOF tags in node `extras`, so there is no separate `rig.json`. The browser
viewer plays the glTF-native animations, skinning a character and posing a
mechanism's parts, drives each caller DOF from a slider, and turntables a static
prop.

In place of the sprite kinds' cheat-divergence check, a Blender run has a
provenance re-run. The validator re-runs the authored `build.py` through
`tcab-blend` in a clean scratch copy and compares the re-exported glTF's summary
of mesh and skin counts, animation names, and caller-DOF set against the run's
emitted glTF. A divergence is recorded rather than gated, and a host without
Blender skips the re-run. This is what makes `build.py` a reproducible authoring
trace.

## Particle validation

A particle run is scored on the authored `system.json` the binary emits. The
validator parses it and records a system that declares no emitters, or declares
emitters of which none actually emits particles. It takes the rendered preview
animation as the reviewer sees it.

There is no bake and no determinism requirement. A particle effect is simulated
live, so it varies slightly from play to play, and the validator judges the
emitted system rather than a frozen frame sequence. The reviewer scores the
character of the effect, with the review UI simulating the system live.

## Audio validation

An audio run emits a rendered PCM `clip.wav`, and for a `music` run a portable
`clip.mid` score. The validator decodes the `.wav` and records any of: a
malformed or missing file, a sample rate or channel count that disagrees with the
`[audio]` table, a duration past `max_duration_ms`, and a silent clip whose
samples never rise above roughly -72 dBFS. A `music` run that emitted no
`clip.mid` is recorded too. Each is a contract gap rather than a crash.

There is no runtime to pose and nothing to re-render. The reviewer plays the clip
against the brief, with the rendered waveform and spectrogram, and the piano-roll
for music, shown alongside.

## Review

The human [review](/components/core/results/#reviews) is the assessment. A
published asset-generation run carries a writeup of how convincingly the asset
realizes the brief and how the model approached the work, alongside the asset
itself and the recorded actions. The cheat-detection and provenance signals
inform that assessment; the judgment of the asset is the reviewer's.

That review is one overall rating and nothing else. An asset-generation case
declares
[no reviewer checklist](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating),
only the single `overall` scoring [domain](/components/core/results/#reviews),
because how well an asset reads is a judgment about the whole thing. The reviewer
takes in the asset as a whole, playing back every declared sequence, turning the
model, or hearing the clip, then reads the brief and gives it one rating. Being
the only domain, that rating is the run's rating. Runs of these cases carry a rating and a
writeup and no point score.

That puts the weight on the brief. It is both what the model is asked to satisfy
and the only thing the rating is given against, so anything that would have been
a checklist item has to be stated there.
