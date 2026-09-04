---
title: Rendering
---

The engine owns rendering. A game states what should be on screen by attaching
render components to its actors, and the pipeline collects them, orders them,
and draws them once per frame in two passes: a three scene rendered through the
camera, and a screen layer drawn over it. A build writes simulation and leaves
the picture to engine code.

## The picture is a property of the world

A mesh, a loaded model, a light, or a line of HUD text reaches the screen by
being attached to an actor as a component that carries its own geometry,
material, light spec, or string. Reading the world therefore answers what is
drawn: the render components on the live actors are the picture. A case checks
that a ball is on screen by finding the ball's mesh component, in the same
object model it reads the ball's position from.

Because the picture is data, changing it is writing a field. A game hides a
paddle by clearing its visibility, fades it by lowering its opacity, and moves
it by moving its actor, and every one of those is readable back afterwards. The
three objects the pipeline builds from those fields are readable too, off
`engine.scene`, so a check that wants the placed mesh rather than its
declaration reads the scene the pipeline maintains.

## Two passes, two spaces

A render component draws in one of two spaces, fixed by its class. A world
component is a mesh, a model, a light, or a game-built three subtree, and the
pipeline gives it one three object in the scene, places that object at the
component's world transform every frame, and renders the scene through the
camera. A screen component is a sprite, a shape, a text, or a direct draw, and
the pipeline draws it on the screen layer in logical units, through the
viewport alone.

The two passes make one picture. Each frame the engine clears the canvas to the
background color, or to transparency when the game gave none, renders every
enabled, visible world component's object through the camera, then clears the
screen layer and draws every enabled, visible screen component in order over
it. A component that stops being visible leaves the picture at once, and a
destroyed actor leaves it before it leaves the world, because the pipeline
reads both switches on every frame. The collision overlay draws over the
finished world pass, and the diagnostics overlay draws last on the screen
layer in device pixels, so it holds its size and its place whatever the camera
is doing.

## Assignment is the change signal

The scene is retained between frames: the object the pipeline built for a mesh
component on one frame is the object it places on the next. Placement,
visibility, and opacity are read fresh every frame, so moving an actor or
fading a component costs nothing beyond the write. The object itself is rebuilt
when the component's `geometry`, `material`, or `light` field is assigned a new
value.

Assignment is the signal the pipeline watches. A game that changes a mesh's
color builds a new material spec, or mutates the old one, and assigns it to the
field; the pipeline sees the new value on the next sync and rebuilds the
object. The declaration on the component and the object in the scene therefore
agree at every frame boundary, which is what lets a check read either one.

## Render modes belong to the pipeline

The pipeline draws in one of four modes: the full shaded picture, every mesh as
its edges in one flat color, every material's base color and map with the
lights ignored, or every surface colored by its world-space normal. The engine
draws every component, so it can draw every component all four ways, and a
build has all four modes without implementing any of them.

That makes the mode a fixed axis a reviewer and a validator both have.
Switching a build to wireframe shows the geometry it placed, switching it to
unlit shows the colors and maps it declared with no lighting rig in the way,
and switching it to normals shows how its surfaces face, whatever drawing
decisions the build made.

In the world pass the mode substitutes materials at draw time. Everything in
the scene is a three object with a material, an `Object3DComponent`'s subtree
and a loaded model included, so the substitution reaches the direct path as
well as the declarative components. On the screen layer, wireframe draws
outlines alone, unlit draws fills and images at full opacity with tints
dropped, and the other modes draw the full picture.

The collision overlay is a second switch of the same kind, independent of the
mode. It draws every enabled collider's shape as a wireframe in the world pass,
after the scene and with depth testing off, in a color per response, so what
the engine tests for collision is visible through whatever the game drew in
front of it.

## Sampling is one option

The fit scales every image the screen pass draws, so how an image's pixels are
spread over device pixels is a property of the whole screen layer rather than
of one sprite. The engine takes it as one option, `imageSmoothing`, and applies
it to every image it draws on the screen layer each frame: bilinear resampling
by default, nearest-neighbor sampling for a game whose HUD art is pixel art. A
build states its art style once, and every sprite and every direct draw follow
it. A material's map in the world pass is sampled by three under the texture's
own filtering.

## Layering and the two sorts

Depth is a number on a component rather than a position in a draw function,
and each pass reads it its own way. In the world pass, `layer` is the object's
render order: three draws the opaque objects and then the transparent ones,
orders each set by render order, and depth testing decides which surface is
seen where two overlap. In the screen pass, the pipeline sorts by layer
ascending, then by the owning actor's spawn order, then by attachment order
within that actor, so a component's depth follows it however the actor was
created and whatever else was spawned that frame.

The screen sort is stable, so a redraw with no change reproduces the previous
order exactly. A frame is a function of the world and the camera alone, which
is what lets a validator read a screen-layer pixel back and assert on it, and
what lets two runs of the same scenario produce the same recording.

## Screen space

A readout, a menu, and an overlay hold their place on the canvas while the
camera moves through the world. A render component states that with its space:
a `screen` component draws through the viewport alone, in logical units from
the top-left of the design field, and the camera's position, rotation, and
projection leave it where it is. Its composed transform is read as a 2D
placement, `position.x` and `position.y`, the quaternion's yaw about `+Z`, and
`scale.x` and `scale.y`.

The screen layer is a second canvas the engine owns, sized to the same backing
store as the stage canvas and composited over the 3D picture at the end of
every frame. Every screen component draws over every world component, so a HUD
is a layer above the world rather than a second pipeline, and a screen
component is read back from the world like any other.

## Drawing directly

Each pass has a direct path. A case whose subject is 2D drawing attaches a draw
component and implements its draw method; the engine calls it in its place in
the screen pass's layer order, with the context already carrying the viewport
transform, so it draws in logical units and sits among the declarative
components rather than over them. A case whose subject is the scene itself
attaches an `Object3DComponent` around three objects the game built; the
pipeline places the subtree's root at the component's world transform and the
game mutates the subtree directly.

The two paths meet the modes differently. Render modes belong to the
declarative pipeline, so a draw component reads the mode from the drawing API
and supplies its own. An `Object3DComponent`'s subtree is made of three
materials the pipeline can substitute, so the world-pass modes reach it with
nothing for the game to implement.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

The separation gives a build one place to look for each. A paused world runs no
tick and still renders, so a pause holds a live picture on screen. A validator
that steps the simulation and then reads the scene knows the scene came from
the state the ticks left behind, and a case that asserts on a cue knows the cue
came from a tick.

The [camera](/engines/structured-3d/concepts/camera-and-viewport/) is updated at
the head of the pipeline, so the view a frame draws through is the view the
simulation ended that frame in.
