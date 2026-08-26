---
title: Rendering
---

The engine owns rendering. A game states what should be on screen by attaching
render components to its actors, and the pipeline collects them, orders them,
and draws them once per frame. A build writes simulation and leaves the picture
to engine code.

## The picture is a property of the world

A mesh, a shape, or a line of text reaches the screen by being attached to an
actor as a component that carries its own mesh, material, or string. Reading
the world therefore answers what is drawn: the render components on the live
actors are the picture. A case checks that a ship is on screen by finding the
ship's mesh component, in the same object model it reads the ship's position
from.

Because the picture is data, changing it is writing a field. A game hides a
door by clearing its visibility, fades it by lowering its opacity, and moves it
by moving its actor, and every one of those is readable back afterwards. A pose
is the same kind of data: a mesh component's clip and clip time pose the mesh
as a pure function of the two fields, the game advances the time in its own
tick, and a validator asserts a pose by reading the fields back.

## The whole picture, every frame

Each frame the engine clears the canvas to the background color, or to
transparency when the game gave none, resets the depth state, collects every
enabled, visible render component on the live actors, and draws the collection
in order. Nothing is carried over from the previous frame, so a component that
stops being visible leaves the picture at once, and a destroyed actor leaves it
before it leaves the world. The collision overlay draws over the finished
picture, and the diagnostics overlay draws last on its own 2D surface above the
canvas, in device pixels, so it holds its size and its place whatever the
camera is doing.

## Lights are world content

Lighting is stated the same way the rest of the picture is: a light is a
component on an actor. It moves with its actor, it is collected while it is
enabled and its actor alive, and it is rebuilt with the world like everything
else, so reading the world also answers what lit the frame. An ambient light
lights every surface evenly, a directional light shines along its component's
orientation, and a point light shines from its component's position and falls
off with distance.

Each frame the pipeline snapshots the enabled lights into the renderer state
the scene context holds, which is the state a recording carries, so a recording
states what lit it. A world holding no enabled light component is lit by the
engine's default rig of one ambient and one directional light, and the rig
withdraws on any frame the world holds one.

## Render modes belong to the pipeline

The pipeline draws in one of four modes: the full lit picture, triangle edges
alone, base colors and textures at full brightness, or every pixel colored by
its surface normal. The engine draws every component, so it can draw every
component all four ways, and a build has all four modes without implementing
any of them.

That makes the mode a fixed axis a reviewer and a validator both have.
Switching a build to wireframe shows the geometry it placed, and switching it
to normals shows how it oriented that geometry, whatever drawing decisions the
build made.

The collision overlay is a second switch of the same kind, independent of the
mode. It draws every enabled collider's shape as wireframe outlines over the
finished picture, in a color per response and after a depth clear so nothing
the game drew hides it, and what the engine tests for collision is visible
beside what the game drew.

## Layers clear the depth buffer

Depth between components is a number on a component rather than a position in a
draw function. The pipeline sorts by layer ascending, then by the owning
actor's spawn order, then by attachment order within that actor, so a
component's layer follows it however the actor was created and whatever else
was spawned that frame.

The depth buffer is cleared before each layer draws, so a later layer draws
over an earlier one however near the earlier one's geometry sits. That is the
HUD idiom: the scene sits on layer zero and a billboard text score on layer
one, and the score is never hidden inside the scene's geometry. Within a layer
the depth buffer orders the fragments, so issue order does not decide what is
in front; components below full opacity draw after the layer's opaque ones,
farthest from the camera first, which is what correct blending needs.

The sort is stable, so a redraw with no change reproduces the previous order
exactly. A frame is a function of the world alone, which is what lets a
validator read a pixel back and assert on it, and what lets two runs of the
same scenario produce the same picture.

## Drawing directly

A case whose subject is the drawing itself attaches a draw component and
implements its draw method. The engine calls it in its place in the layer
order, handing it the scene context with the frame's camera, lights, and mode
already in force, so it issues draw calls in world units and sits among the
declarative components rather than over them.

This path is what a case uses to measure drawing code the model wrote: whether
it draws the right figure, in the right place. The render mode is renderer
state the scene context holds, so a draw component's calls are drawn under the
mode in force without the component implementing anything; the mode stays
readable from the drawing API for a component that draws differently per mode.
The camera, the lights, and the mode belong to the pipeline, so a draw
component draws under them rather than setting them.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

The separation gives a build one place to look for each. A paused world runs no
tick and still renders, so a pause holds a live picture on screen. A validator
that steps the simulation and then reads the recording knows the picture came
from the state the ticks left behind, and a case that asserts on a cue knows
the cue came from a tick.

The [camera](/engines/structured-3d/concepts/camera-and-viewport/) is updated
at the head of the pipeline, so the view a frame draws through is the view the
simulation ended that frame in.
