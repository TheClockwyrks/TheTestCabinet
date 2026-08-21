---
title: Simple 3D
---

Simple 3D (slug `simple-3d`) is the 3D engine of the Simple family. It provides
the same services around a game that [Simple 2D](/engines/simple-2d/overview/)
does and leaves the simulation and the drawing to the game, in a 3D spatial
model.

The engine is designed and awaiting implementation, so it is outside the set a
run may select. Its documentation arrives with its runtime, in the same four
sections its sibling uses.

## What the family fixes

Simple 3D owns the frame loop and the delta time it hands the game, the input
action registry and its bindings, the audio bus, the asset loader, and the debug
overlay. The game supplies its update and its rendering, receives the real
elapsed time for each frame, and integrates against it.

## What dimensionality changes

The spatial model is 3D, so the drawing surface the engine hands a game, the
asset kinds it resolves, and the touch layouts it offers all differ from the 2D
engine. A game targets one engine or the other from the start, and a case
declares whichever suits it.

## Draw-command recording

The engine records the drawing commands its renderer issues, armed and disarmed
by whoever owns the engine exactly as its
[2D sibling](/engines/simple-2d/concepts/recording/) is. What comes back is the
same per-frame format: every frame carries the counter, the simulated time, the
renderer state it inherited, and the operations it issued, so a frame is drawn
from itself alone.

That guarantee is what a reviewer's player depends on, so a recording taken from
a 3D build seeks and scrubs the same way a 2D one does, and a validator emits it
as a review item's media by the same route.

## Where it fits

Simple 3D suits a 3D case whose difficulty is the simulation and the
presentation, and which wants the surrounding work provided rather than
measured.
