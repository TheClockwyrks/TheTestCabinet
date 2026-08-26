---
title: Actors and Components
---

A world is a list of actors, and an actor is a transform with components
attached. Those two objects carry everything a game puts in the world, and the
engine owns their lifecycle: it constructs them, gives them a world, begins
their play, ticks them in a fixed order, and ends their play when they leave.
The surface both objects expose is specified under
[actors](/engines/structured-3d/apis/actors/) and
[components](/engines/structured-3d/apis/components/).

## What an actor is

An actor is one thing in the world: a ship, a ball, an obstacle, a spawn
marker, a score readout. It carries an id unique within the world, a transform,
a set of tags, and the components attached to it.

The transform is the actor's own position, orientation, and scale, in world
units, composing scale, then rotation, then translation. It is a plain mutable
record, so movement is an assignment to `transform.position` or its fields
rather than a call the engine mediates. The rotation is a quaternion, built
with `quatFromAxisAngle` when a readable rotation is wanted, and the scale is
per axis, defaulting to one on each.

World units are the game's own, in a right-handed space with +Y up; the
[camera](/engines/structured-3d/concepts/camera-and-viewport/) page states the
world's conventions once. The camera's frustum projects world points into the
logical design field, and the viewport fits that field to the canvas, so an
actor never states a device coordinate.

## Composition

An actor gets its appearance and its collision shape by attaching components. A
mesh, a shape, a text readout, a light, a collider, and a camera target are
each a component, and any actor can hold any combination of them, including
several of the same kind.

Composition reserves the subclass for behavior: how the actor moves and what it
decides. What it looks like, what lights it, and what it collides with are the
components it assembles.

An actor holds a reference to each component it attached, so reading and writing
a component is a field access. Finding a component by type is available for the
cases where the reference was not kept.

## The offset transform

A component carries its own transform relative to its actor's, defaulting to the
identity. A component that leaves the offset alone sits exactly on its actor and
moves with it.

The world transform of a component is the actor's transform composed with the
offset: the offset's position is scaled and rotated into the actor's frame and
then translated by the actor's position, the two rotations compose, and the two
scales multiply per axis. That composed transform is what the pipeline draws
through and what a collider's shape is tested in, and it is handed out as a
snapshot the caller owns rather than a live object.

The offset is what puts a turret on the side of a hull, a label above a
character, and a hit box that is smaller than the mesh it belongs to. Moving
the actor moves all of them together, and moving one offset moves that piece
alone.

## The lifecycle contract

Actors and components share one lifecycle: construct, attach, begin play, tick,
end play. Each stage has an ordering guarantee, and a build relies on them
rather than on the order it happened to write its code in.

Construction runs with no world. A constructor attaches components and sets
default values; anything that reads the world runs later. The world reference is
assigned after the constructor returns and before begin play, so every method
that runs after construction can use it.

Begin play runs once the object is part of the world. Every actor a level
declares exists before any of their begin play calls run, and those calls run in
spawn order, so an actor looks up its peers there without depending on the order
the level listed them. The game mode begins play after every declared actor has.

Tick runs once per frame with the frame's delta in seconds. Controllers tick
first, then each live actor in spawn order, and immediately after each actor its
enabled components in attachment order. Collision is reported after every actor
has moved, and the game mode ticks last, from a settled world.

End play runs once, and it names its reason: the object was destroyed, or the
world it belonged to closed. Components end play before their actor, so a
component can still read the actor it is leaving.

## Spawn is immediate and destroy is deferred

Spawning an actor completes inside the call. The world constructs the actor,
applies the spec, attaches it, and runs begin play for the actor and its
components before the call returns. The caller therefore holds a live, fully
initialized actor it can configure and store, and the new actor first ticks on
the following frame, so it never joins a tick pass already in progress.

Destroying an actor marks it and defers its removal to the end of the frame. The
actor stops ticking, drawing, and colliding immediately, so nothing that runs
later in the frame acts on it, but the world's list stays stable for the rest of
the pass. A tick never observes a half-removed world, and an event handler that
destroys an actor during collision does not invalidate the iteration underneath
it.

At the end of the frame the marked actors end play in reverse spawn order, each
actor's components before the actor itself, and then leave the world. A
destroyed pawn is released by its controller first, and the game mode is told
afterwards, so a mode decides whether to respawn from a world where the pawn is
already gone.

## Ticking, and ticking while paused

An actor's tick can be switched off. A disabled actor and all of its components
skip their tick while remaining in the world, visible, and collidable, which is
how a spent object stays on screen without costing per-frame work. A component
can be disabled on its own, which drops its tick, its drawing, and its
participation in collision together.

Pausing a world suspends the controller ticks, the actor and component ticks,
the timers, the collision pass, and the game mode's tick. The world still
renders, and its input frame still closes, so an edge is consumed exactly once
whether the world is paused or running.

An actor can opt into ticking while paused. Such an actor ticks together with
its components, which is what lets a pause menu, a transition effect, or a
countdown to resume drive itself out of the same frame loop that the paused
simulation is sitting out.

## Tags

A tag is a string an actor carries, and the world indexes actors by it. Tags are
added and removed at any point in an actor's life, declared on a level's actor
specs, and supplied when spawning.

Tags are how a case names things. A case fixes its tag vocabulary in its own
constants module, a build applies those tags to whatever classes it wrote, and a
validator finds the actors it needs by tag without knowing a single class name.
Looking up by class is available for a build's own code, where the class is in
scope.

Lookups by tag and by type return the matching live actors in spawn order, as a
copy the caller owns, so iterating one while the world changes underneath is
safe.
