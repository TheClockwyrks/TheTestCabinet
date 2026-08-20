---
title: The Host Interface
---

The host interface is a small handle a built page publishes on its own window. It
exists so a finished build can be confirmed to have booted, and so a person
opening that build can read the frame counter and the registered diagnostics from
a console.

## Installed by createEngine

`createEngine` installs the handle, so a build that constructs an engine at all
publishes one. A post-run check opens the built page, reads the handle, and takes
a live engine reporting frames as evidence that the page loaded, wired its
canvas, and reached the frame loop.

The handle appears at construction, before any game code runs. The frame counter
it reports stays at zero until initialization resolves and the loop starts, so
the counter separates a page that built an engine from a page that also got its
game running.

## Where validators do their work

A test case's [validators](/engines/simple-2d/validators/overview/) run in
process. They import the engine and the game directly, construct the engine
themselves with a scripted clock, and step it with `engine.advance`, so they hold
the state, the events, and the drawing context as values in the same process that
produced them. The host interface takes no part in a validator's work.

## The handle and the version

The interface is published as a single property of the game's own window, named
by the handle. The engine's manifest declares the same handle, and the two are
one contract: a reader takes the name from the engine catalogue and binds to
whatever the catalogue says.

The interface carries an integer version, bumped whenever its shape or meaning
changes. A reader checks the version first, and can then report that a build
predates what it expects.

## Installation and teardown

Installing over an existing handle replaces it. A page that tears one engine down
and builds another, as a level transition or a reload does, ends up publishing
the engine that is actually running.

`engine.destroy()` removes the handle while it still belongs to the engine being
destroyed. Teardown tends to create the replacement first and dispose of the
superseded engine afterwards, so a superseded engine's destruction leaves its
replacement published.
