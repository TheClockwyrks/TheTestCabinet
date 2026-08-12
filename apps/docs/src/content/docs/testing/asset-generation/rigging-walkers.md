---
title: Rigging and animating walkers
---

Legged walkers such as striders, mechs, and walking fortresses are the hardest
rigs to make read as believable, and they fail in consistent ways. This page is a
reference for how a walker's legs behave: how a believable leg is structured and
how a convincing walk cycle moves, drawn from how established walkers such as
the AT-TE and AT-AT are built.

This is author-facing design background. It is neither a rig a case pins nor
content for a brief. A case declares no parts, joints, or pose angles: its
`[model]` table fixes the required animations by name, and the model invents the
parts, joints, pivots, and F-curves it needs to satisfy them. Use this page to
understand what a convincing walk looks like, so you can state that as a crisp
behavioural requirement in the brief: the feet plant flat and the body advances
over them, and it reads as a heavy machine rather than flailing.

The brief carries only that requirement. The mechanics on this page are how a
walk is achieved, and they stay out of a brief. That covers segment counts,
joint angles, counter-rotation to hold a foot flat, knee direction, and gait
phasing. A brief specifies what rather than how, is seeded into a sandbox with no
access to these docs, and must never link here. Working the mechanics out from
the behavioural requirement is the test.

The angles and segment breakdowns below are illustrative. They explain why real
walkers read as heavy and grounded rather than giving a spec to reproduce. The
parts, joints, animations, and
[F-curves](/testing/asset-generation/voxel-binaries/#f-curves) they build on are
defined by the voxel binaries.

## Leg structure

A believable walker leg is an articulated chain: three segments (an upper thigh,
a lower shin, and a short foot) joined by two moving joints (a hip and a knee),
with the foot kept flat. Equivalently, the upper joint carries two degrees of
freedom, moving the leg up and down as well as fore and aft, so the foot can be
lifted and placed rather than only swung.

Each leg is its own chain of parts on its own hip, positioned directly above its
own foot. Modelling a left or right bank of legs as a single part on one shared
pivot drives the rear feet down through the ground while the front feet lift,
because a fore-and-aft spread of feet is rotating about one point. Independent
per-leg chains are what stop the feet clipping.

### The AT-TE

The AT-TE's three leg pairs use two distinct designs. Angles below take 0° as
flat and forward, and −90° as straight down.

Rear legs use three segments and two joints, running foot → very short segment →
joint → segment → joint → body:

- The upper segment travels roughly −30° to −150°, a large sweep.
- The middle segment travels roughly −120° to −150°, a small sweep held well
  behind the upper joint.
- The bottom segment is extremely short and barely moves. It stays almost
  vertical the whole cycle, and the foot itself tilts only about ±15°.

Middle legs use two segments and two joints, running foot → segment → joint →
segment → joint → body:

- The upper joint travels a semicircle. While the foot is planted it swings
  backward across the body, then lifts up and comes back down to place the foot
  forward again.
- The top segment moves only a little, roughly −60° to −120°.
- The lower joint exists to keep the foot flat, tilting it only about ±15°.

Front legs are the rear legs mirrored: the same three-segment, two-joint design,
with the middle segment sitting forward of the joint and travelling roughly +30°
to +60°.

The through-line is big motion at the top joint, small motion lower down, and a
foot that stays nearly flat. A leg that splits a large rotation evenly down the
chain, or lets the foot tilt with the shin, reads as a spider tiptoeing rather
than a heavy machine walking.

## The planted stance phase

A believable walk cycle has two phases per leg, and the stance phase is the one
most often omitted.

In stance, the foot is planted flat and translates straight backward relative to
the body. The walk is authored in place, so the body's origin does not travel
across the scene and the planted foot slides straight back under the body
through stance, like a treadmill belt. A consuming game moves the whole unit
forward at that same speed, which is what makes the foot read as anchored to the
ground while the machine advances over it. The leg extends and folds, hip and
knee working together, to carry the foot straight back along the ground line
while the body holds station.

In swing, the foot lifts clear of the ground, travels forward, and plants again
at the front of the stride, ready for the next stance.

A cycle whose foot is in a continuous arc the whole time and never sits still on
the ground makes a walker look like it is flailing its legs instead of pushing
itself forward. There must be a segment of the cycle where the foot is flat and
still on the ground while the body moves relative to it.

Phase the legs so the machine is always supported. A biped alternates the two
legs in opposite phase, a quadruped moves diagonal pairs together, and a hexapod
walks two alternating tripods, three planted legs at all times, a half-period
apart.

## In-place authoring

A walk or march clip is a looping, in-place cycle. Over one period the rig's
root does not translate across the scene: it starts and ends at the same place,
with zero net displacement. Forward motion is conveyed entirely by the legs, the
planted foot sliding straight back under the body during stance and then
swinging forward. A consuming game plays the clip while it drives the unit's real
world movement, so a clip that also translated the body would compound with that
and rocket the unit forward. Authoring the walk in place is what lets a game
reuse it.

When you author the cycle:

- Keep the root or body part centered. A small vertical bob, the body rising and
  settling with the stride, is right. A net forward drift across the loop is not.
- Express all forward motion as the foot path in the body's frame: back during
  stance, then a lifting arc forward during swing.
- The review viewer plays the clip in place, so a correct walk shows the body
  holding station while the feet cycle underneath.

The same rule applies to any locomotion animation, a strider's `march` or a
flyer's `hover` or `cruise`. The clip animates the motion in place, and the game
supplies the travel.

## Foot angle and knee direction

The foot should tilt only about ±15° in the world across the whole cycle, held
level by the foot or ankle joint counter-rotating against the leg. A foot that
tilts far more than this reads as the machine walking on its toes and heels, and
is the tell-tale of a rigid two-joint arc with no foot control.

The lower joint must bend the way a real walker's does, a reverse or digitigrade
knee. The common failure is the lower segment rotating the wrong way relative to
the upper, a knee bending inside-out, which instantly reads as broken. Fix the
sign of the knee's motion as well as its range.

### World-space angle versus relative rotation

The example angles throughout this page describe the world orientation of each
segment, how it points in the scene. A joint does not set its segment's world
angle: a joint's rotation is applied relative to its parent segment and stacks on
top of everything above it, so a segment's world orientation is the sum of its
parent's world orientation and its own local joint rotation. Mistaking one for
the other is the most common reason a foot refuses to stay flat.

Keeping the foot flat in the world is therefore not a matter of holding the
ankle at a fixed local angle. As the hip and knee rotate through the stride,
their rotations accumulate down the chain and the foot inherits all of them. To
hold the foot at a roughly constant world angle, the ankle must counter-rotate
by the negative of that accumulated hip and knee rotation, tracking it frame by
frame. That is a moving local angle. A foot pinned to a fixed local angle
visibly tips as the leg folds and extends.

Two consequences follow. The ankle needs enough range to cancel the full swing
of the joints above it: if the hip and knee together sweep a large arc, the
ankle's range must be able to absorb it, and a narrow-range ankle cannot stay
flat through the stride. The foot's track should also be thought about in the
world frame, where the foot stays flat while the shin swings back, letting the
relative ankle keyframes fall out of that goal.

## Curved interpolation

Legs carry weight, and weight means the motion is not a constant-speed slide
between poses. Author the joint tracks as
[F-curves](/testing/asset-generation/voxel-binaries/#f-curves) rather than linear
interpolation. Linear keys read as weightless, mechanical flailing however
correct the poses are.

How much easing depends on the machine. The AT-AT walks largely smoothly, with
gentle acceleration and deceleration at each key (`ease-in-out`) giving a slow,
ponderous roll. The AT-TE's front and rear legs are about 80% smooth and then
accelerate hard into the foot-plant, an `ease-in` on the final descent that gives
the satisfying thump of a heavy foot landing, while its middle legs stay smooth.

A heavy walker typically eases most of its motion and reserves a sharp `ease-in`
for the moment of contact. Match the curve to the weight you want the viewer to
feel.

## Authoring method

The joints are driven by keyframed angles, but the goal is a specific foot path:
planted flat during stance, a lift arc during swing. Author a walk by working
backward from that path.

1. Define the foot path in the body's frame: a flat, ground-level segment moving
   straight back for stance, then a lifting arc forward for swing, with the foot
   held flat throughout.
2. At several sample times, solve the leg's joint angles that place the foot on
   that path, hip, knee, and ankle together.
3. Set those solved angles as the track keyframes, choose the easing per segment
   (smooth through the swing, a sharp `ease-in` into the plant), and phase the
   legs per the gait above.

Design the rest pose as a bent leg with a clearly folded knee. A near-straight
leg has no room to extend and fold, so the foot cannot stay planted as the body
passes over it.
