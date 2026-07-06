# Siege Husk — sculpting and rigging brief

You are sculpting and rigging the **Siege Husk**, a decrepit, low-poly shambling
humanoid enemy for the Siege first-person voxel last-stand game — as one continuous
skin bound to a skeleton and deformed across its joints, a rigged character a game
poses at runtime. There is no target model to copy: it must read unmistakably as a
shambling husk and satisfy the animation contract below.

This brief fixes what the husk is and how it must move. It deliberately does not give
you a skeleton, joint placements, or pose angles — working out the bones a walking,
lunging, collapsing humanoid needs, where they pivot, and how the skin binds to them is
the test. Invent the skeleton.

## How the tool works

`mc-skin` sculpts **one whole-body signed-distance field** — the entire husk at once,
extracted into a single continuous **Marching Cubes** surface (a low-poly, chunky
faceted look; that surface character is fixed, not a knob). It is the only way to sculpt
the field and edit the skeleton. You build the character by:

- Compositing the body from primitives — additive and subtractive spheres, boxes,
  ellipsoids, and cylinders, each an opaque `#rrggbb` `--color`, with an optional soft
  `--blend` radius that fuses them into one skin — plus `mirror`/`translate`/`copy`/
  `replace-color`/`clear` to shape and correct. There is **one field for the whole
  body**: there is **no `--part` flag** — a skinned character is a single field with a
  single log.
- Building a **skeleton** on top of the field: bones in a hierarchy (`define-bone`,
  the first bone the root), positioned head→tail (`set-bone`), with joints on them
  (`define-joint`), and animations that drive the joints (`define-animation` /
  `add-keyframe`).

Build one operation at a time. A sculpting or skeleton op only records — run
`mc-skin render` to (re)draw the preview PNG and read it between calls, and run it
before you finish so the skinned `mesh.glb` geometry and the skin weights are emitted
(an unrendered model scores as empty). `mc-skin --help` is the contract.

## The volume and coordinate system

- The volume is **24 wide (x) × 48 tall (y) × 20 deep (z)**, in field units, starting
  empty — a standing humanoid, taller than it is wide or deep.
- **x** runs across the body, `0`–`23`. **y** runs up, `0` (ground, at the feet) to
  `47` (top of the head). **z** runs front-to-back, `0`–`19`. **Forward is +z:** the
  husk faces toward higher `z`, so it lunges toward higher `z`.
- Build the body roughly symmetric left-to-right about the vertical centerplane
  (between `x = 11` and `x = 12`), broken only by the natural asymmetry of a decayed,
  hunched figure.
- Everything is sculpted in these shared coordinates, standing where the finished husk
  stands.

## What the Siege Husk is (and what is yours to invent)

Fixed — the character must read unmistakably as all of these:

- A gaunt, decrepit **humanoid** — a head, a torso, two arms, and two legs — standing
  at rest but **hunched and sagging**, the wretched remains of a person rather than an
  upright, healthy figure. It reads as a shambling enemy on sight.
- **Ashen grey-green flesh** stretched over a starved frame, with **exposed bone** at
  the worn places (a jaw or teeth, a hand, a shoulder, or a rib) and **tattered dark
  cloth** hanging in rags off the body.
- A single continuous skin: as it moves, the body **deforms across its joints** — an
  elbow bends, a knee folds, the spine hunches — with no seam and nothing tearing away.
- The palette below and nothing outside it.

Everything else is yours to invent — the exact silhouette and proportions, how gaunt or
bloated the frame is, how the cloth hangs and where the bone shows through, and — the
whole point of the test — the entire **skeleton**: which bones the body needs, where
each pivots, and how the skin binds to them. Nothing here prescribes a shape or a
skeleton; the test rewards a bold, characterful husk that is unmistakably a shambling
enemy and deforms convincingly.

## Palette

Use only these opaque colors (there is no transparency):

| Role | Hex |
| --- | --- |
| Flesh (ashen grey-green) | `#7e8a68` |
| Flesh, deep (recessed, hollowed, bruised) | `#515a3c` |
| Cloth (tattered dark) | `#2c2824` |
| Cloth, worn (frayed, weathered rag) | `#4b4238` |
| Bone (exposed bone, teeth, nails) | `#d8ccac` |

Let the exposed bone read clearly against the flesh from many angles so the decay
shows.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **three required animation declarations** by name (you
author the motion). Author each with `mc-skin define-animation` then `add-keyframe`,
choosing the period and each key's interpolation
(`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` for bezier) so the body carries weight — a shamble that
lurches, a lunge that snaps then settles, a collapse that slumps — rather than sliding
linearly at a constant rate. In every one, the character is **one continuous skin**:
the joints drive the bones and the skin follows across them, so an elbow, hip, or spine
bends and folds smoothly rather than a rigid piece snapping about a pivot.

- **`walk`** — the shamble (a game-triggered playable that **loops**). A decrepit gait:
  the legs plant and drag forward while the pelvis and spine flex, the arms hang and
  sway, and the head lolls, looping smoothly. It carries the lurching weight of a husk
  rather than a stiff march. Author it **in place** — the leg cycle carries the stride
  and a game supplies the real forward travel — so the body cycles without leaving the
  volume.
- **`lunge`** — the attack (a game-triggered playable that **plays once and holds**).
  A single forward wrench toward higher `z`: the spine coils and then snaps the torso
  forward while a shoulder and arm carry out to grab or swipe, then the pose settles.
  The skin stretches across the shoulder and folds at the waist as one surface. It is a
  deliberate attack lunge, not a twitch.
- **`collapse`** — the death crumple (a game-triggered playable that **plays once and
  holds**). The legs buckle and the spine folds so the body crumples down and holds
  limp on the ground: the skin folds at the knees, waist, and neck as the body goes
  slack. It slumps and settles into death rather than tipping over rigid like a felled
  plank.

You may add extra bones, joints, and animations of your own (for example a subtle
breathing or twitching idle, or a stagger); you must produce these three, by these
names, and must not contradict them.

## Working the tool

Composite the whole body one op at a time, then build the skeleton: define your bones
with `define-bone` (the first the root, each under a parent), position each head→tail
with `set-bone`, place joints with `define-joint`, and author each required animation's
keyframes — running `mc-skin render` and reading `model.png` between calls to confirm
the body reads as a husk, and running a posed `mc-skin render --time <ms> --animation
<name>` to confirm the skin actually deforms across its joints with weight. Weights are
derived automatically at render by bone-heat diffusion (capped at four bone influences
per vertex), so you do not paint them by hand — you may use the optional `paint-weight`
override only for a region the automatic weighting gets wrong. The recorded operation
log and `rig.json` are your submission.
