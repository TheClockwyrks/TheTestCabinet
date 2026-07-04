---
title: Rigging and animating walkers
---

Legged walkers — striders, mechs, walking fortresses — are the hardest voxel rigs to
make read as *believable* rather than *flailing*, and they fail in consistent ways.
This page is a reference for how a walker's legs **behave** — how a believable leg is
structured and how a convincing walk cycle moves — drawn from how established walkers
(the AT-TE and AT-AT) are built.

This is **design guidance, not a rig a case pins.** A case no longer declares parts,
joints, or pose angles: its `[model]` table fixes only the [required
animations](/testing/asset-generation/manifests/) (by name), and the model **invents**
the parts, joints, pivots, and F-curves it needs to satisfy them. Use this page in two
ways:

- As an **author**, to write a walker
  [`voxel-animation`](/testing/asset-generation/overview/#voxel-models-and-rigs) case's
  brief — its behavioural requirements, in prose, for how the walk must read (a planted
  stance phase, a flat foot, a believable gait). Describe *what convincing walking looks
  like*; do not prescribe a skeleton, segment counts, or angles.
- Point the **model** toward these principles from that brief, so it can work out and
  build a leg that walks convincingly rather than following a pinned rig.

The angles and segment breakdowns below are **illustrative** — they explain *why* real
walkers read as heavy and grounded, not a spec to reproduce. The mechanics referenced
here (parts, joints, model-authored **animations**, and **F-curves**) are defined in
[The voxel binaries](/testing/asset-generation/voxel-binaries/) and
[Manifests](/testing/asset-generation/manifests/); this page is the *design* guidance
that sits on top of them.

## A leg is three segments and two joints

A believable walker leg is **not** one rigid part swung from a hip, and it is **not**
a whole bank of legs sharing one pivot. It is an **articulated chain**: three
segments (an upper thigh, a lower shin, and a short foot) joined by two moving joints
(a hip and a knee), with the foot kept flat. Equivalently, the upper joint carries
**two degrees of freedom** — it moves the leg up/down *and* fore/aft — so the foot can
be lifted and placed rather than only swung.

Each leg is its **own** chain of parts on its **own** hip, positioned directly above
its **own** foot. Do not model a left/right *bank* of legs as a single part on one
shared pivot: rotating a fore-and-aft spread of feet about one point drives the rear
feet **down through the ground** while the front feet lift. Independent per-leg chains
are what stop the feet clipping.

### The AT-TE, dissected

The AT-TE is the richest reference — its three leg pairs use two distinct designs.
Angles below take **0° as flat/forward** and **−90° as straight down**.

- **Rear legs — three segments, two joints** (foot → very short segment → joint →
  segment → joint → body):
  - the **upper** segment travels roughly **−30° to −150°** (a large sweep),
  - the **middle** segment travels roughly **−120° to −150°** (a small sweep, held
    well behind the upper joint),
  - the **bottom** segment is **extremely short and barely moves** — it stays almost
    vertical the whole cycle, and the **foot itself tilts only about ±15°**.
- **Middle legs — two segments, two joints** (foot → segment → joint → segment →
  joint → body):
  - the **upper joint** travels a **semicircle**: while the foot is planted it swings
    **backward across the body**, then lifts up and comes back down to place the foot
    forward again,
  - the **top** segment moves only a little, roughly **−60° to −120°** (≈ −70° to
    −110°),
  - the **lower joint** exists to keep the **foot flat**, tilting it only about
    **±15°**.
- **Front legs — the rear legs mirrored**: the same three-segment/two-joint design,
  but the middle segment sits **forward** of the joint, travelling roughly **+30° to
  +60°** instead of behind.

The through-line: **big motion at the top joint, small motion lower down, and a foot
that stays nearly flat.** A leg that instead splits a large rotation evenly down the
chain — or lets the foot tilt with the shin — reads as a spider tiptoeing, not a
heavy machine walking.

## The gait needs a planted stance phase

This is the single most important rule, and the most common omission. A believable
walk cycle has **two phases per leg**:

1. **Stance** — the foot is **planted flat and translates straight backward
   relative to the body.** Because the walk is authored **in place** (the body's
   origin does not travel across the scene — see the next section), the planted foot
   slides straight back *under* the body through stance, like a treadmill belt; it is
   a consuming game moving the whole unit forward at that same speed that makes the
   foot read as anchored to the ground while the machine advances over it. The leg
   **extends and folds** (hip and knee working together) to carry the foot straight
   back along the ground line while the body holds station.
2. **Swing** — the foot **lifts clear of the ground, travels forward, and plants**
   again at the front of the stride, ready for the next stance.

A cycle with **no** planted stance phase — where the foot is in a continuous arc the
whole time and never sits still on the ground — is what makes a walker look like it is
**flailing its legs** instead of **pushing itself forward**. If you take nothing else
from this page: **there must be a segment of the cycle where the foot is flat and
still on the ground while the body moves relative to it.**

Phase the legs so the machine is always supported: a **biped** alternates the two legs
in opposite phase; a **quadruped** moves diagonal pairs together; a **hexapod** walks
two alternating **tripods** (three planted legs at all times) a half-period apart.

## Author the walk in place — the body must not travel

A walk or march clip is a **looping, in-place cycle**: over one period the rig's
**root does not translate across the scene** — it starts and ends at the same place,
with **zero net displacement**. Forward motion is conveyed **entirely by the legs** —
the planted foot sliding straight back under the body during stance, then swinging
forward — **not** by sliding the whole model across the volume. A consuming game plays
the clip while *it* drives the unit's real world movement; if the clip *also* translated
the body, the two would compound and the unit would rocket forward. Authoring the walk
in place is what lets a game reuse it.

When you author the cycle:

- Keep the **root/body part centered** — do not keyframe a steady forward translation
  onto the root. A small vertical bob (the body rising and settling with the stride) is
  right; a net forward drift across the loop is not.
- Express all forward motion as the **foot path in the body's frame** — back during
  stance, a lifting arc forward during swing — exactly as in *Authoring method* below.
- The review viewer plays the clip **in place**, so a correct walk shows the body
  holding station while the feet cycle underneath (a treadmill), **not** the model
  marching off across the scene.

The same rule applies to **any** locomotion animation — a strider's `march`, a flyer's
`hover` or `cruise`: the clip animates the motion **in place**, and the game supplies
the travel.

## Keep the foot flat, and bend the knee the right way

- **Flat foot.** The foot should tilt only about **±15°** in the **world** across the
  whole cycle, held level by the foot/ankle joint counter-rotating against the leg. A
  foot that tilts far more than this (the tell-tale of a rigid two-joint arc with no
  foot control) reads as the machine walking on its toes and heels.

### World-space angle vs. relative rotation — why feet don't stay flat

This is the single most common reason a foot refuses to stay flat, and it is worth
being explicit about. The example angles throughout this page (0° flat/forward, −90°
straight down) describe the **world** orientation of each segment — how it points in
the scene. But a joint does not set its segment's world angle. A joint's rotation is
applied **relative to its parent segment**, and it stacks on top of everything above
it: a segment's world orientation is the **sum** of its parent's world orientation and
its own local joint rotation.

So keeping the foot flat in the world is **not** a matter of holding the ankle at a
fixed local angle. As the hip and knee rotate through the stride, their rotations
**accumulate** down the chain, and the foot inherits all of them. To hold the foot flat
(a roughly constant *world* angle), the ankle must **counter-rotate** by the negative of
that accumulated hip + knee rotation, tracking it frame by frame — a moving local angle,
not a constant one. A foot pinned to a fixed *local* angle will visibly tip as the leg
folds and extends.

Two consequences for the design:

- The ankle needs **enough range** to cancel the full swing of the joints above it. If
  the hip and knee together sweep a large arc, the ankle's range must be able to absorb
  it; an ankle with a narrow range simply **cannot** stay flat through the stride.
- When you author (or ask the model to author) the foot's track, think in the **world**
  frame — "the foot stays flat while the shin swings back" — and let the relative ankle
  keyframes fall out of that goal, rather than keyframing a fixed local ankle angle and
  hoping it looks level.

- **Knee direction.** The lower joint must bend the way a real walker's does (a
  reverse / digitigrade knee). The common failure is the **lower segment rotating the
  wrong way relative to the upper** — the knee bending "inside-out" — which instantly
  reads as broken. Fix the sign of the knee's motion, not just its range.

## Animate with curves, not straight lines

Legs carry weight, and weight means the motion is **not** a constant-speed slide
between poses. Author the joint tracks as **F-curves**
([Manifests](/testing/asset-generation/manifests/#f-curves-the-curve-model)), not
linear interpolation — linear keys read as weightless, mechanical flailing however
correct the poses are.

How much easing depends on the machine:

- The **AT-AT** walks **largely smoothly** — gentle acceleration and deceleration at
  each key (`ease-in-out`), a slow ponderous roll.
- The **AT-TE**'s front and rear legs are about **80% smooth, then accelerate hard
  into the foot-plant** — an `ease-in` on the final descent that gives the satisfying
  **"thump"** of a heavy foot landing. Its middle legs stay smooth.

So a heavy walker typically eases most of its motion and reserves a sharp `ease-in`
for the moment of contact. Match the curve to the weight you want the viewer to feel.

## Authoring method: design the foot path, then solve the joints

Because the joints are driven by keyframed angles but the *goal* is a specific **foot
path** (planted-flat during stance, a lift arc during swing), author a walk by working
backward:

1. Define the **foot path** in the body's frame: a flat, ground-level segment moving
   straight back (stance), then a lifting arc forward (swing), with the foot held
   flat throughout.
2. At several sample times, **solve the leg's joint angles (inverse kinematics)** that
   place the foot on that path — hip, knee, and foot/ankle together.
3. Set those solved angles as the track keyframes, choose the easing per segment
   (smooth through the swing, a sharp `ease-in` into the plant), and phase the legs
   per the gait above.

Design the rest pose as a **bent** leg (a clearly folded knee), not a straight column
— a near-straight leg has no room to extend and fold, so the foot cannot stay planted
as the body passes over it.
