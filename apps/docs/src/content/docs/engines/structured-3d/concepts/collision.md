---
title: Collision
---

The engine draws one line through collision: detection belongs to the engine and
response belongs to the game. The engine decides which colliders are touching
and describes how they are touching. What that means for the game, whether a
ball bounces, a body stops, or a pickup disappears, is the game's own code.

## The engine reports and the game responds

The pairs a build found are engine bookkeeping. The engine owns them, so a check
reads them off engine code rather than off whatever the build invented, and a
validator asserts on the pairs and the manifolds the engine reported by
subscribing to the engine's events.

The response is the game's design. A bounce angle, a knockback, a score, a
death: those are the behaviors a specification describes and a reviewer watches,
so the build writes them and a check measures them through the world they leave
behind.

A blocking pair is therefore a report. The actor that must stop or reverse does
so in its own code, from the manifold the report carried.

## Channels and responses

A collider carries a shape and a channel. The channel is a name for what the
collider is, and the game owns the vocabulary: a ball, a wall, a pawn, a
pickup, a trigger volume, a line of sight. Two colliders on the same actor sit
on different channels when they mean different things.

Alongside the channel a collider declares its responses: for each channel it
cares about, whether a collider on that channel is ignored, overlapped, or
blocked. A channel the collider says nothing about is ignored, so a game
enumerates the pairs it wants and everything else stays silent.

Resolution reads both declarations. Each collider answers for the other's
channel, and the pair takes the stronger of the two answers, ordered ignore
below overlap below block. One side is enough to establish a response, so a wall
that blocks everything is written once and every mover inherits the block
without naming the wall.

The result is a filter the game controls in one vocabulary. A pair the filter
resolves to ignore is never tested, so the pass covers the pairs the game named
and stays silent everywhere else.

## Shapes are volumetric and oriented

A collider's shape is a box, a sphere, or a capsule, centered on its
component's world transform and oriented by that transform's rotation. A box is
therefore an oriented box, and a capsule's axis rotates with the actor that
carries it, so a collider turns with the geometry it stands in for.

The same shape type describes a drawn primitive and a collider's volume, so a
build that draws a shape and collides on it states one value twice rather than
maintaining two vocabularies. The collision overlay draws the collider's shape
at its transform, which is how a mismatch between the two is seen.

## The manifold

A blocking pair is reported with the manifold that separates it: a unit normal,
the depth the shapes penetrate along that normal, and a point on the shared
boundary. Multiplying the normal by the depth gives the smallest translation
that pulls the two shapes apart.

The manifold is oriented by the reported order of the pair. The engine reports
the actor with the lower `id` first and orients the normal from the first
collider toward the second, so the same two actors produce the same report
whichever of them moved into the other. A game that must know which side it is
on compares against the first actor and flips the sign.

That is enough to write any of the usual responses. Pushing out along the normal
by the depth is a stop; reflecting velocity about the normal is a bounce;
reading the normal alone and discarding the depth is a surface test for a jump.

## When the pass runs

The pass runs once per [frame](/engines/structured-3d/concepts/frame/), after
every controller, actor, and component has ticked and after the frame's timers
have fired. Every position the frame produced is therefore final when the pass
reads it, and a pair created by this frame's movement is reported in this frame
rather than the next.

The game mode ticks after the pass. A mode that ends a match on a goal, counts a
hit, or restarts a pawn is reading a world where this frame's collisions have
already been reported and the game's handlers have already responded to them.
The mode decides the match from a settled world.

A paused world runs no pass, so a pause menu produces no collision events and no
overlap edges. Actors destroyed during the frame take no part in the pass, and
they leave the world after it, so a handler never sees a half-removed world.

## Overlaps and hits

An overlapping pair is an edge report. The engine emits a begin on the first
frame it finds the pair and an end on the first frame it stops finding it, and
the end also arrives when either actor is destroyed or the world closes. A game
that opens a door, starts a timer, or grants a powerup wants exactly those two
moments, and it is spared tracking membership itself.

A blocking pair is a per-frame report. The engine emits a hit on every frame the
shapes intersect, each with the manifold as it stands that frame. A body resting
against a wall is still penetrating it the following frame, so the game applies
its stop again and the body stays out.

The two report forms suit the two jobs. An overlap answers "did this happen",
which is a question about a moment. A block answers "where are these two now",
which is a question the game answers again every frame it holds.

## Queries

Events describe the pairs the engine found. A game also asks questions the pass
would never raise: what is under this point, what is inside this radius, what
does this actor see along this line.

Those are queries, run on demand from a tick against the colliders as they
stand. A shape query reports what a shape would touch if it were placed
somewhere, a ray reports the nearest thing along a direction, and a full ray
reports everything along it in order of distance. Each takes the same channel
and response filter a collider carries, so a query is aimed with the vocabulary
the game already wrote, and it takes a list of actors to leave out so a query
from an actor skips itself. A shape query places its shape with identity
orientation; an oriented test is run by giving an actor a collider.

The ray query is also how the pointer reaches the scene. The pointer is a 2D
logical position, the camera turns it into a ray, and a raycast on a picking
channel answers what sits under it, so a click resolves through the same filter
vocabulary every other collision question uses.

Queries return their answers to the caller and the pass raises the events. A
game therefore chooses per question whether it wants to be told or wants to ask,
and both read the same colliders.
