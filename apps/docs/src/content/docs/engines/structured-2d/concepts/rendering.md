---
title: Rendering
---

The engine owns rendering. A game states what should be on screen by attaching
render components to its actors, and the pipeline collects them, orders them,
and draws them once per frame. A build writes simulation and leaves the picture
to engine code.

## The picture is a property of the world

A shape, a sprite, or a line of text reaches the screen by being attached to an
actor as a component that carries its own fill, image, or string. Reading the
world therefore answers what is drawn: the render components on the live actors
are the picture. A case checks that a ball is on screen by finding the ball's
render component, in the same object model it reads the ball's position from.

Because the picture is data, changing it is writing a field. A game hides a
paddle by clearing its visibility, fades it by lowering its opacity, and moves
it by moving its actor, and every one of those is readable back afterwards.

## The whole picture, every frame

Each frame the engine clears the canvas to the background color, or to
transparency when the game gave none, collects every enabled, visible render
component on the live actors, and draws the collection in order, clipped to
the logical field so nothing a component draws lands in the letterbox bars.
Nothing is carried over from the previous frame, so a component that stops
being visible leaves the picture at once, and a destroyed actor leaves it
before it leaves the world. The collision overlay draws over the finished
picture, inside the same clip, and the diagnostics overlay draws last in device
pixels and outside it, so it holds its size and its place whatever the camera
is doing.

## Render modes belong to the pipeline

The pipeline draws in one of four modes: the full shaded picture, outlines
alone, fills and images with tint and transparency dropped, or flat silhouettes
in layer order. The engine draws every component, so it can draw every component
all four ways, and a build has all four modes without implementing any of them.

That makes the mode a fixed axis a reviewer and a validator both have. Switching
a build to wireframe shows the geometry it placed, and switching it to
silhouette shows how it layered that geometry, whatever drawing decisions the
build made.

The collision overlay is a second switch of the same kind, independent of the
mode. It draws every enabled collider's shape over the finished picture, in a
color per response, so what the engine tests for collision is visible beside
what the game drew.

## Sampling is one option

The fit scales every image the pipeline draws, so how an image's pixels are
spread over device pixels is a property of the whole picture rather than of one
sprite. The engine takes it as one option, `imageSmoothing`, and applies it to
every image it draws each frame: bilinear resampling by default, nearest-neighbor
sampling for a game whose art is pixel art. A build states its art style once,
and every sprite and every direct draw follow it.

## Layering and the stable sort

Depth is a number on a component rather than a position in a draw function. The
pipeline sorts by layer ascending, then by the owning actor's spawn order, then
by attachment order within that actor, so a component's depth follows it however
the actor was created and whatever else was spawned that frame.

The sort is stable, so a redraw with no change reproduces the previous order
exactly. A frame is a function of the world alone, which is what lets a
validator read a pixel back and assert on it, and what lets two runs of the same
scenario produce the same picture.

## Screen space

A readout, a menu, and an overlay hold their place on the canvas while the
camera moves through the world. A render component states that with its space:
a `screen` component draws through the viewport alone, in logical units, and
the camera's position, zoom, and rotation leave it where it is. The same sort
orders both spaces, so a HUD is a layer above the field rather than a second
pipeline, and a screen component is read back from the world like any other.

## Drawing directly

A case whose subject is the drawing itself attaches a draw component and
implements its draw method. The engine calls it in its place in the layer order,
with the context already carrying the transform of the component's space, so it
draws in world units or in logical units and sits among the declarative
components rather than over them.

This path is what a case uses to measure drawing code the model wrote: whether
it draws the right figure, in the right place, and whether it honors the mode
the pipeline is in. Render modes belong to the declarative pipeline, so a draw
component reads the mode from the drawing API and supplies its own.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

The separation gives a build one place to look for each. A paused world runs no
tick and still renders, so a pause holds a live picture on screen. A validator
that steps the simulation and then reads pixels knows the pixels came from the
state the ticks left behind, and a case that asserts on a cue knows the cue came
from a tick.

The [camera](/engines/structured-2d/concepts/camera-and-viewport/) is updated at
the head of the pipeline, so the view a frame draws through is the view the
simulation ended that frame in.
