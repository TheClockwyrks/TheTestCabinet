---
title: The Host Interface
---

The host interface is a small handle a built page publishes on its own window.
It exists so a finished build can be confirmed to have booted, and so a person
opening that build can read the frame counter, the registered diagnostics, and
the state of the match from a console.

## Installed by createEngine

`createEngine` installs the handle, so a build that constructs an engine at all
publishes one. A post-run check opens the built page, reads the handle, and
takes a live engine reporting frames as evidence that the page loaded, wired its
canvas, and reached the frame loop.

The handle appears at construction, before any game code runs. The frame counter
it reports stays at zero until initialization resolves and the loop starts, so
the counter separates a page that built an engine from a page that also got its
game running.

## The world snapshot

The engine owns the object model a game builds its match out of, so the handle
reports that model rather than leaving a reader to guess at it. One call returns
the name of the level currently open, the match phase, the simulated time the
world has been stepped by, how many live actors it holds, and one entry per
player state carrying its index, name, and score.

That is what a person opening a build reads to see which level is open and how
the match stands. It is also what a check reads to confirm that a transition
landed on the level it expected and that the match reached the phase the
specification calls for.

The snapshot is a description, reported as counts and names. Every value the
handle returns crosses a page evaluation as plain data that survives structured
cloning, so a reader holds figures it can compare rather than a reference into
the running engine.

## The render switches

The engine owns [rendering](/engines/structured-2d/concepts/rendering/), and the
pipeline draws in one of four modes with a collision overlay that is independent
of them. Both switches are on the handle, so a reviewer inspects the build as it
shipped from a console. One flips the pipeline into wireframe, unlit, or
silhouette; the other draws every enabled collider's shape over the finished
picture.

The debug overlay has its own switch beside them, which shows and hides the
overlay without touching the toggle key.

## The handle and the version

The interface is published as a single property of the game's own window, named
by the handle. The engine's manifest declares the same handle, and the two are
one contract: a reader takes the name from the engine catalogue and binds to
whatever the catalogue says.

The interface carries an integer version, bumped whenever its shape or meaning
changes. A reader checks the version first, and can then report that a build
predates what it expects.

## Where validators do their work

A test case's [validators](/engines/structured-2d/validators/overview/) run in
process. They import the engine and the build's own game definition, construct
the engine themselves over a canvas they own and a clock they script, and step
it with `engine.advance`, so they hold the world, its actors, and its events as
values in the same process that produced them. The host interface takes no part
in a validator's work.

## Installation and teardown

Installing over an existing handle replaces it. A page that tears one engine
down and builds another ends up publishing the engine that is actually running.

`engine.destroy()` removes the handle while it still belongs to the engine being
destroyed. Teardown tends to create the replacement first and dispose of the
superseded engine afterwards, so a superseded engine's destruction leaves its
replacement published.
