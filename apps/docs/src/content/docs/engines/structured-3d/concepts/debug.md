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

Carrying the surface in the return value is what makes its presence a property
of initialization rather than of a call the game might omit or misplace. There
is no moment at which the engine holds an initialized instance with no surface
beside it, no second surface that could replace the first, and every caller that
reads `engine.debug` holds the one object the game returned. An `initialize`
that returns `undefined` rejects `engine.initialize` outright, naming the
surface, and a game with nothing to offer returns `null`.

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
  `startMatch(mode: Mode): void`, `placeBall(patch: Partial<Transform>): void`.
  A caller drives it as `engine.debug.startMatch("versus")`.
- A reading takes no arguments and returns plain data: `snapshot(): Snapshot`.
  A caller drives it as `engine.debug.snapshot()`.

Plain properties such as `version` stay plain properties.

A pose arranges the world; it does not decide what happens next. It works
through the same systems play uses: it spawns actors, writes positions and
orientations onto transforms, drives the game mode through its phases, and
possesses pawns, and it leaves the outcome to the frames that follow. The
collision, the serve, or the spawn a scenario is about is then computed by the
same controllers, actors, and game mode play exercises, so a scenario posed
through the surface and the same scenario reached by playing leave the world in
one state. That property is what makes a check through the surface a check of
the game.

A reading reports the world as it stands at the call, as counts, names, and
figures a caller compares rather than as references into the running engine.

## What the engine keeps for itself

The surface carries nothing about driving a browser game rather than about the
game itself, because those parts belong to the engine and are reached through
it. The [frame](/engines/structured-3d/concepts/frame/) and its clock step the
simulation, so the surface has no `step` or `advance`. Registered
[actions](/engines/structured-3d/concepts/input/) are driven directly, so it
has no key presses. The [overlay](/engines/structured-3d/concepts/diagnostics/)
is the engine's panel and toggle, so it draws nothing, and the render mode and
the collision overlay are switches on `engine.renderer`, so it flips neither.
What remains on the surface is exactly the part of driving the game that only
the game can supply.

The overlay and the surface face opposite directions: a diagnostic source names
a value for a human watching the panel, and the surface names the operations and
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
