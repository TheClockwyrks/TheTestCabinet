---
title: Overview
---

The Simple family provides the services a game needs around its own code and
leaves the game itself to the model. It ships two engines, `simple-2d` and
`simple-3d`, which differ in their spatial model, asset kinds, and touch layouts.

Simple owns the frame loop and the delta time it hands the game, the input action
registry and its bindings, the audio bus, the asset loader, and the debug overlay.
The game owns its simulation and its drawing. A game receives a drawing surface
each frame and renders itself.

Simple is written entirely in TypeScript and is imported as an ordinary
dependency.

## What a game supplies

A game written against Simple supplies its own update and its own rendering. The
engine calls both as part of the frame, passing the update the delta time it
computed and the rendering whatever surface the engine's dimensionality provides.

Simple provides no collision detection, no physics, and no gameplay framework, so
a case that measures those measures them directly.

## What validation gains

Every surface Simple owns is driven through the engine's host interface rather
than through code the model wrote. A driver replaces the clock, drives registered
actions, reads the audio and asset logs, and inspects the registered diagnostic
sources.

The case's own scenario setup remains the game's, so a case still declares the
control operations its checks need to arrange a situation.

## Where it fits

Simple suits a case whose difficulty is the simulation and the presentation.
Carom-class games write their own collision response and draw their own playfield,
and Simple removes the surrounding work that a case never intended to measure.
