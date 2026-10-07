---
title: Debug Surface
---

The debug surface is the object a game is driven through from code. A caller
poses a situation through it, advances the engine an exact number of frames, and
reads the outcome back, with no keyboard and no waiting on real time. It is the
seam through which a build is examined from outside, so every game the engine
runs is expected to carry one.

## What initialize returns

The game instance's `initialize` returns its debug surface, and the engine
returns that value unchanged from `engine.debug`. The surface therefore has the
same origin as the instance's own setup: it is built in the one place the
instance prepares itself, and it is in place before the start level opens and
before the first frame runs.

Carrying the surface in the return value makes its presence a property of
initialization. Every caller that reads `engine.debug` holds the one object the
game returned. An `initialize` that returns `undefined` rejects
`engine.initialize`, naming the surface, and a game with nothing to offer
returns `null`.

## The shape is the game's

The engine holds the surface and reads no member of it. Its operations, their
signatures, and the vocabulary they use are declared by the game, as the `D`
type parameter of `GameInstance<D>`, and `createEngine` infers `D` from the
instance class of the definition it is handed. A game with nothing to offer is a
`GameInstance<null>`; `D` defaults to `unknown`.

This is what lets a test case specify the surface in its own terms. The case's
instrumentation spec fixes the operations a build must offer, the build declares
and implements them, and a validator reaches them through `engine.debug` with a
type of its own written from the same spec. The engine carries the surface
between the two without knowing what it holds.

## Written as poses and readings

The game's state lives in the framework objects the engine owns: the instance,
the open world, its game mode and game state, and its actors. The instance holds
`engine`, and `engine.world` follows every level transition, so an operation
reads `this.engine.world` at the moment it is called and acts on the world that
is open then. The surface holds no state of its own.

- A pose takes only its own arguments and returns nothing:
  `startMatch(mode: Mode): void`,
  `setBallPosition(x: number, y: number, z: number): void`.
  A caller drives it as `engine.debug.startMatch("versus")`.
- A reading takes no arguments and returns plain data: `snapshot(): Snapshot`.
  A caller drives it as `engine.debug.snapshot()`.

Plain properties such as `version` stay plain properties.

A pose arranges the world through the same systems play uses: it spawns actors,
moves transforms, drives the game mode through its phases, and possesses pawns,
and it leaves the outcome to the frames that follow. The collision, the serve,
or the spawn a
scenario is about is then computed by the same controllers, actors, and game
mode play exercises, so a scenario posed through the surface and the same
scenario reached by playing leave the world in one state. That property is what
makes a check through the surface a check of the game.

A reading reports the world as it stands at the call, as counts, names, and
figures a caller compares rather than as references into the running engine or
three objects out of the scene.

## What the engine keeps for itself

Driving a browser game belongs to the engine and is reached through it. The
frame and its clock step the simulation, registered actions are driven
directly, the overlay is the engine's panel and toggle, the render mode and the
collision overlay are switches on `engine.renderer`, the scene the pipeline
maintains is read as `engine.scene`, and the camera is read as `world.camera`.
The surface carries the part of driving the game that only the game can
supply.

The overlay and the surface name different things: a diagnostic source names one
value, of the types the panel draws, and the surface names the operations and
readings a caller drives from code.

## Inert in play

Nothing on the surface runs until something calls it. A build ships it in every
bundle, and a player never reaches it: the engine publishes nothing on the page,
so the surface is reachable only by whoever holds the engine, which in a
validator is the suite that constructed it.

The idioms for writing one are at [Usage](/engines/structured-3d/usage/debug/),
and the exact declarations are at the
[game instance](/engines/structured-3d/apis/game-instance/) and
[engine](/engines/structured-3d/apis/engine/) APIs.
