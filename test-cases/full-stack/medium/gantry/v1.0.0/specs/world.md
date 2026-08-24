# Gantry — The world and the anatomy of a site

This file defines the world frame, the build lattice, and the pieces a site is
made of: the envelope, the anchors, the obstacles, the loads, and the pads. The
fixed sites themselves are listed in `specs/sites.md`, in these terms.

## The world frame

The world is measured in units on a right-handed frame: `x` and `z` are
horizontal, `y` is up, and the ground is the plane `y = 0`, drawn as the yard
floor. A position is written `(x, y, z)`. A yaw is a rotation about the vertical
axis in degrees, and a positive yaw turns `+x` toward `+z`. Gravity pulls along
`-y` at `GRAVITY` (`10`) units per second squared, so a mass `m` weighs
`m * GRAVITY` force units.

Every rate in this specification is per second and every duration is in
seconds. During a run they are integrated on the fixed tick
`specs/overview.md` states; a tick covers `1 / TICK_HZ` seconds.

## The lattice

Structure is built between lattice nodes: the points whose coordinates are all
integer multiples of `LATTICE_PITCH` (`2`). A lattice node is a position, not an
object; it comes into being on screen when something ends there. Members run
between two lattice nodes, and parts occupy lattice nodes, as
`specs/structure.md` states.

## The envelope

Each site fixes a build envelope: an axis-aligned box, stated as inclusive
coordinate ranges on each axis. Every lattice node used by the structure lies
inside the envelope, so the envelope bounds where the crane may be built. It
bounds nothing at run time: once the tape runs, the arm swings wherever its
geometry takes it, envelope or not.

## Anchors

Each site fixes its anchor nodes: lattice nodes on the ground where the
structure is fixed to the earth. An anchor is the one kind of support the
structure has. Members attach to anchor nodes like any other node, and in the
solve an anchor node is held immovable, as `specs/statics.md` states. Anchors
support any force without limit; what fails under load is the structure, never
the ground.

## Obstacles

An obstacle is a fixed axis-aligned box, stated as a minimum corner and a size
per axis. Obstacles block building and moving alike:

- The editor refuses a member whose segment passes through an obstacle
  (`specs/structure.md`).
- During a run, a member sweeping through an obstacle or a load carried into
  one ends the run, as `specs/statics.md` states.

An obstacle's top face is solid ground for a load: a pad may sit on top of an
obstacle, which is how a site asks for a lift onto a platform.

## Loads

A load is a rigid box the crane must move. Each site lists its loads, and each
load carries a class, a mass, a starting pose, and a target pose.

A class fixes the load's dimensions, as width by height by depth (`x` by `y` by
`z` at yaw `0`), and names the produced model that draws it
(`specs/assets.md`):

| Class | Dimensions | Reads as |
| --- | --- | --- |
| `crate` | `2 x 2 x 2` | a packing crate |
| `container` | `4 x 2 x 2` | a shipping container |
| `drum` | `2 x 3 x 2` | an upright storage drum |

Every load pose in this specification is the pose of the load's lift point: the
center of its top face. A load resting on the ground therefore has its lift
point at `y` equal to its class height, and one resting on an obstacle's top at
that top's height plus its class height. The load's box extends half its width
and half its depth horizontally from the lift point, rotated by its yaw, and its
full height below it.

A load begins each run at rest at its starting pose, in state `waiting`. It is
`attached` while it hangs from the hook, `placed` once it has been set down on
its pad, and `lost` if it is dropped or destroyed, which ends the run
(`specs/rigging.md`, `specs/statics.md`). A placed load sits at exactly its
target pose for the rest of the run and is solid to nothing; loads and the
structure never collide with loads.

## Pads

A load's target pose is drawn as its pad: a marked footprint on the ground or
on an obstacle's top, showing the class outline at the target yaw. The pad is a
marking rather than a body; setting the load down on it is judged by the
release rules in `specs/rigging.md`.

## The life of a site

A site is played in three phases, and the player moves between them freely
until a run clears the site.

1. Build. The player edits the structure inside the envelope against the
   site's budget (`specs/structure.md`).
2. Program. The player edits the instruction tape (`specs/program.md`).
3. Run. The tape plays out under the simulation from a fixed starting posture
   (`specs/program.md`, `specs/statics.md`). A run ends cleared, with every
   load placed, or failed, with a cause; either way the structure and the tape
   remain as authored, ready to edit and run again.

Clearing a site records its score, the crane's cost and the run's time, and
unlocks the next site, as `specs/ui.md` states.
