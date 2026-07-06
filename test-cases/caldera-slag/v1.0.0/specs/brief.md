# Caldera Slag — sculpting and rigging brief

You are sculpting and rigging the Caldera Slag, a lumbering molten elemental — a
hunched mass of glowing magma sheathed in a cracked cooling-basalt crust — as a
rigged 3D **skinned** character a game poses at runtime. There is no target model to
copy: it must read unmistakably as the Slag and satisfy the animation contract below.

This brief fixes what the Slag is and how it must move. It deliberately does not give
you a skeleton, joint placements, or pose angles — working out the bones a hunched,
lumbering creature needs, where they sit inside the body, and how they articulate is
the test. Invent the rig.

## How the tool works — one continuous skin

`sn-skin` sculpts a **single, whole-body signed-distance field** — the entire creature
at once — and extracts it into **one continuous, watertight surface** (Surface Nets:
smooth, mid-fidelity, uniform, rounded). There is **no `--part` flag**: unlike the
rigid per-part animated tools, a skinned character is **one field with one log**,
extracted once and bound to a skeleton, and the skin **deforms across its joints** —
an elbow bends without a seam. You build the model by:

- Compositing the body with the tool's CSG primitives — `add-sphere` / `add-box` /
  `add-ellipsoid` / `add-cylinder` and their `subtract-*` counterparts, softened into
  one organic mass with `--blend` — each an opaque `#rrggbb` `--color` (there is **no
  alpha**), and clearing where you overreach.
- Defining a **skeleton** with `define-bone` (a head→tail segment under a parent),
  positioning it with `set-bone`, and placing degrees of freedom on it with
  `define-joint`. The per-vertex skin weights that bind the mesh to the skeleton are
  **derived automatically** at render by bone-heat diffusion (nearest bones, smooth
  falloff, capped at four influences per vertex, normalized) — you do **not** paint
  them operation by operation; an optional `paint-weight` only overrides a region the
  automatic weighting gets wrong.
- Authoring each required animation with `define-animation` then `add-keyframe` as
  F-curves — the joints drive the bones and the skin follows via linear-blend skinning.

Build one operation at a time. A sculpting or skeleton op only **records** — run
`sn-skin render` to (re)draw the whole-model preview `model.png` and read it between
calls (`render --view iso|front|side|top` for a camera, `render --time <ms>
--animation <name>` for a preview posed with **actual skin deformation** at an instant
of an animation), and run it before you finish so the skinned **`mesh.glb`** geometry
and skin weights are emitted (an unrendered model scores as empty). `sn-skin --help`
is the contract.

## The volume and coordinate system

- The field bounds are **44 wide (x) × 36 tall (y) × 44 deep (z)**, in field units,
  starting empty. Primitive centers and extents are real-valued and signed (anything
  outside the bounds is simply not meshed).
- **x** runs across the creature. **y** runs up, `0` (ground) to `35` (top). **z**
  runs front-to-back, `0`–`43`. **Forward is +z:** the creature faces toward higher
  `z` at rest.
- Build the Slag roughly symmetric left-to-right about the lengthwise vertical
  centerplane (between `x = 21` and `x = 22`). It is a hunched, top-heavy mass — its
  bulk gathered high and forward over shorter, planted limbs — that reads clearly from
  its silhouette alone.
- The one whole-body field is sculpted in these shared coordinates.

## What the Slag is (and what is yours to invent)

Fixed — the creature must read unmistakably as all of these:

- A **lumbering molten elemental** for the Caldera hex tower-defense game: a hunched,
  top-heavy quadruped-or-biped mass — a heavy body carried on short, thick limbs it
  hauls itself along on — not a humanoid and not a plain blob.
- A body of **glowing molten magma** sheathed in a **cracked cooling-basalt crust**:
  dark rocky plates over a hot interior, with the glow of the magma showing through
  deep fissures and seams in the crust.
- **One continuous skin** — a single organic surface, smooth and watertight, that
  bends and flexes as one body across its joints (never detached chunks).
- A clear read of hot core versus cooled crust, in the palette below.

Everything else is yours to invent — the exact silhouette and proportions, whether it
walks on two heavy limbs or four, how the crust cracks and where the fissures glow, how
the mass hunches, and how you lay out the bones and place the joints. Nothing here
prescribes a shape; the test rewards a bold, characterful creature that is unmistakably
the Slag and deforms convincingly.

## Palette

Use only these opaque colors (skinned material has no alpha):

| Role | Hex |
| --- | --- |
| Molten core (incandescent orange-yellow) | `#ffb42a` |
| Hottest seams (bright yellow) | `#ffe27a` |
| Fissures (deep red) | `#8f1d14` |
| Basalt crust (near-black) | `#17151a` |

Let the near-black crust dominate the outer surface as cracked cooling rock, with the
incandescent core, the bright hottest seams, and the deep-red fissures glowing through
the cracks so the magma reads as hot from many angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **three required animation declarations** by name (you
author the motion). Author each with `sn-skin define-animation` then `add-keyframe`,
choosing the period and each key's interpolation
(`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` for bezier) so a heavy molten mass eases and carries
weight rather than sliding linearly. Every animation must deform the **one continuous
skin across its joints** — the whole point of a skinned character — not slide rigid
lumps:

- **`advance`** — the lumbering walk (a game-triggered playable that **loops**). The
  creature hauls its heavy mass forward on planted limbs — feet plant and still, then
  lift, swing, and plant — while the **pelvis, spine, and crust flex across the joints**
  so the skin stretches and folds at each bend and the whole body rolls with weight. It
  loops seamlessly.
- **`slam`** — the one-shot attack (a game-triggered playable that **plays once and
  holds** its last pose). The creature rears and brings its mass down in one heavy blow;
  the impact carries up through the **shoulders and spine as continuous-skin
  deformation** — the body compresses and recoils as one piece — then settles.
- **`emerge`** — the rise (a game-triggered playable that **plays once and holds**). The
  creature heaves up out of the ground into its standing pose, the **body unfolding and
  the skin stretching into shape across the joints** as it rises, reading as a molten
  mass forming and lifting rather than a rigid model snapping upright.

You may add extra bones, joints, and animations of your own (for example a subtle
breathing sway, or a crust-shudder idle); you must produce these three animations, by
these names, and each must actually deform the skin (a required animation that never
animates is a contract gap).

## Working the tool

Composite the body's one field with the CSG primitives and `--blend`, lay out your
skeleton with `define-bone`/`set-bone`, place your degrees of freedom with
`define-joint`, and author each required animation's keyframes — running `sn-skin
render` and reading `model.png` (and `render --time <ms> --animation <name>` for a
posed, deformed preview) between calls to confirm the mass reads as the Slag, the crust
and core sit right, and the skin **deforms** convincingly across the joints in each
animation. The recorded operation log and `rig.json` are your submission.
