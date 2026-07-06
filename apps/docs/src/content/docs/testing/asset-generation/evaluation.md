---
title: Evaluation
---

An asset-generation run's output is the image the model produced — but the image
**regenerated from the recorded actions**, never the pixels the model left on
disk. The output of a run is the ordered
[action log](/testing/asset-generation/manifests/) the drawing binary recorded,
and evaluation begins by turning that log back into an image. Assessment is then
**subjective**: there is no target image and no automated similarity score — the
regenerated asset is judged by a human against the case's brief.

## Regeneration

The harness replays the recorded operations through the **same drawing logic** the
binary used and takes the **regenerated image** as the run's output. Because the
regeneration runs exactly the operations the model issued — and nothing else — an
image produced by any other means contributes nothing to the result. This is what
makes the constrained drawing channel enforceable rather than merely requested
(see [Overview](/testing/asset-generation/overview/#why-the-actions-are-the-output)).

For a **sprite sheet** each frame is its own separate file, so each is regenerated
independently and carries its own cheat-divergence number; there is **no
whole-sheet aggregate**. The `[sheet]` table's named
[sequences](/testing/asset-generation/manifests/) are surfaced to the reviewer and
**played back as live animations** in the review UI (the regenerated frames in
each named sequence's order) so a person can judge the motion the sheet encodes
against the brief. A checklist item may also
[name the sequences and frames it is about](/testing/asset-generation/manifests/#review-items-can-reference-sequences-and-frames),
in which case the reviewer is shown exactly those animations and frames beside the
item — with a toggle between the live animation and the still frames — instead of
scanning the whole sheet to find them.

## Voxel validation

A [voxel](/testing/asset-generation/overview/#voxel-models-and-rigs) run is **not
regenerated**. Where a sprite's output is replayed from its recorded action log, a
voxel run's output is the data the
[voxel binary](/testing/asset-generation/voxel-binaries/) **emits** —
[`crates/core`](/components/core/overview/) neither re-runs the operation log nor
re-renders any preview. Instead the validator **parses the emitted data**, per part,
and confirms it is well-formed and readable:

- **the emitted geometry** — the meshed surface as a per-part `.glb` (a standard
  glTF 2.0 binary decoded into the `PartMesh` shape the runtime and the [glTF
  exporter](/components/voxel-runtime/overview/#exporting-to-gltf) consume); the cube
  tools (`voxel`/`voxel-anim`) emit a face-culled cube mesh in the same `.glb` form.
  This is a produced artifact, not part of the run record; it is what the frontend
  renders as an interactive 3D model with three.js (see
  [voxel-runtime](/components/voxel-runtime/overview/)).
- **the rendered preview PNG(s)** — the previews the binary rendered during the run
  (see [voxel binaries](/testing/asset-generation/voxel-binaries/)). These are taken
  as the reviewer sees them, not reproduced.

The validator confirms this emitted data is **valid** — parseable, within the
declared volume, and (for an animated model) satisfying the [rig contract](#the-rig)
below — but it does **not** re-derive the geometry or police how it was produced.
The output is what is judged, not the production path. Scoring is on that
emitted-data validity plus the reviewer's judgment of the rendered previews.

A **static model** (`voxel-model`) has one part — the whole model — so it emits one
geometry set and one preview. An **animated model** (`voxel-animation`) emits **one
set per part the model defines**, independently; there is no assembled-model
aggregate. The per-part emitted data and previews are the scored artifacts.

### The rig

For an animated model the model authors **both** the mesh **and** the
**animations** — the timeline motions (a walk, a recoil, an idle) as
model-authored, first-class curves — **and invents the rig itself**: the parts,
joints, and pivots that carry the motion are the model's to devise, not a skeleton
the case prescribes. The only rig contract a case fixes is the set of **required
animations** (by name). The validator derives the parts to score from the
model-produced **`rig.json`** — the full rig it built — and reconciles it against
that contract: each **required animation** must be present and actually **animate**
(carry keyframed motion). A missing or empty required animation is a **zero-scored
contract gap** that is recorded (not a crash): the required motions a case declares
are the scoring targets, so failing to produce them counts against the run rather
than aborting evaluation. The run record carries both the required `model` (the
animation contract) and the produced `rig`, so the 3D viewer can pose the full rig
and play back the animations without a separate catalog lookup.

The reviewer scores the produced **motion** — how well each required animation
reads, such as a walk with a planted stance or the snap of a recoil — alongside the
mesh, and the review UI plays the produced animations back beside each caller
joint's live control.

### Skinned characters

A [skinned](/testing/asset-generation/skinned-binaries/) run
(`mc-skinned`/`sn-skinned`/`dc-skinned`) is validated like an animated voxel run,
with one shape difference: it emits **one** skinned `mesh.glb` and **one** `rig.json`
(a skinned model is a single continuous field, not a set of parts), so there is no
per-part set. The validator decodes the glb — confirming its skin binding is
well-formed (per-vertex bone weights and inverse-bind matrices, the joint node
hierarchy) — parses `rig.json`, and applies the **same rig contract** above: each
[required animation](/testing/asset-generation/manifests/#skinned-cases) must be
present and actually animate, a missing or empty one recorded as a zero-scored
contract gap. The reviewer scores how well the skin **deforms** — an elbow that bends
without tearing, a stride that reads as a walking creature — with the 3D viewer posing
the rig by linear-blend skinning.

## Particle validation

A [particle](/testing/asset-generation/particle-binaries/) run
(`particle-2d`/`particle-3d`) is **not regenerated** either: its output is the
data the binary emits — the authored **`system.json`**, the emitter/force/curve
definition. The validator parses it, confirms it is well-formed and **non-empty**
(the system actually emits particles within the declared `[particle]` field and
duration), and takes the rendered **preview animation** as the reviewer sees it.
There is no bake and no determinism: a particle effect is **simulated live**, so it
varies slightly from play to play — the validator judges the emitted **system**, not
a frozen frame sequence. The reviewer scores the **character of the effect** (the
read of an explosion, a muzzle flash, a plume) the way a sprite sheet's sequences are
judged, the review UI **simulating the system live** — a running particle editor, not
a replayed clip.

## Audio validation

An [audio](/testing/asset-generation/audio-binaries/) run
(`sfx-synth`/`sfx-sample`/`music`) emits a rendered PCM **`clip.wav`** (and, for
`music`, a portable **`clip.mid`** score). The validator decodes the `.wav`, confirms
it is well-formed, within the `[audio]` format (`sample_rate`, `channels`), no longer
than `max_duration_ms`, and **not silent** (the operations produced audible signal) —
a silent or empty clip is recorded as a contract gap, not a crash. There is no
runtime to pose and nothing to re-render: the clip is played as the reviewer hears it.
The assessment is **subjective** — a reviewer plays the clip against the brief (does
it read as a battleship's main gun, a footstep on a deck, a victory fanfare) — with
the rendered **waveform and spectrogram** (and, for music, the **piano-roll**) shown
alongside.

## Cheat detection

Comparing the **regenerated image** against the **final image from the model's
run** is a second, independent signal. If a model drew only through the binary,
the two match. If they **diverge**, the model put pixels on the canvas outside the
recorded operations — for instance by writing an image file directly — which is a
strong sign it tried to bypass the drawing tool. The divergence is recorded so a
reviewer sees it; because only the regenerated image is ever scored, a model gains
nothing from drawing outside the tool, and the mismatch simply marks the attempt.

This check applies only to the 2D drawing tools. A
[voxel](#voxel-validation), [skinned](#skinned-characters),
[particle](#particle-validation), or [audio](#audio-validation) run is judged on its
**emitted data** (see above) and is not policed this way — the geometry, effect, clip,
and preview it emits are what a reviewer evaluates, whatever produced them.

## Review

The human [review](/components/core/results/#reviews) is the assessment, not a
supplement to it: a published asset-generation run carries a writeup of how
convincingly the regenerated asset realizes the brief and how the model approached
the drawing, alongside the regenerated image and the recorded actions. The
cheat-detection signal informs that assessment — flagging a run that drew outside
the tool — but the judgment of the asset itself is the reviewer's.
