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
action registry and its bindings, the audio bus, the asset loader, the debug
overlay, and the host interface a validator drives. The game supplies its update
and its rendering, receives the real elapsed time for each frame, and integrates
against it.

## What dimensionality changes

The spatial model is 3D, so the drawing surface the engine hands a game, the
asset kinds it resolves, and the touch layouts it offers all differ from the 2D
engine. A game targets one engine or the other from the start, and a case
declares whichever suits it.

## Where it fits

Simple 3D suits a 3D case whose difficulty is the simulation and the
presentation, and which wants the surrounding work provided rather than
measured.
