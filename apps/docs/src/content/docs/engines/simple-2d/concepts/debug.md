---
title: Debug Surface
---

The debug surface is the object a game is driven through from code. A caller
poses a situation through it, advances the engine an exact number of frames, and
reads the outcome back, with no keyboard and no waiting on real time. It is the
seam through which a build is examined from outside, so every game the engine
runs is expected to carry one.

## Part of what initialize builds

`initialize` returns its state and its debug surface together, as the pair
`[state, debug]`, and the engine returns the second element unchanged from
`engine.debug`. The surface therefore has the same lifetime and the same origin
as the state: it is built in the one place the state is built, it closes over
that same value, and it is in place before the first frame runs.

Carrying the surface in the return value is what makes its presence a property
of the pair rather than of a call the game might omit or misplace. There is no
moment at which the engine holds a state with no surface beside it, no second
surface that could replace the first, and every caller that reads `engine.debug`
holds the one object the game returned. A return that is anything but a
two-element array rejects `initialize` outright, naming the pair.

## The shape is the game's

The engine holds the surface and reads no member of it. Its operations, their
signatures, and the vocabulary they use are declared by the game, as the `D` type
parameter of `Game<S, D>`, and `createEngine` infers both `S` and `D` from the
game it is handed. A game with nothing to offer declares `Game<State, null>` and
returns `[state, null]`; `D` defaults to `unknown`.

This is what lets a test case specify the surface in its own terms. The case's
instrumentation spec fixes the operations a build must offer, the build declares
and implements them, and a validator reaches them through `engine.debug` with a
type of its own written from the same spec. The engine carries the surface
between the two without knowing what it holds.

## Arrangement, never outcome

A surface arranges the world; it does not decide what happens next. Every control
operation is a pose of the state the game's own `update` runs from on the next
frame, so the collision, the serve, or the spawn a scenario is about is computed
by the same code play exercises. A scenario posed through the surface and the
same scenario reached by playing leave the game in one state, which is the
property that makes a check through the surface a check of the game.

Readings report what the game holds at the instant they are called, and hand back
copies where a reference into the live state would let a caller move the
simulation without going through an operation.

## What the engine keeps for itself

The surface carries nothing about driving a browser game rather than about the
game itself, because those parts belong to the engine and are reached through it.
The [frame](/engines/simple-2d/concepts/frame/) and its clock step the
simulation, so the surface has no `step` or `advance`. Registered
[actions](/engines/simple-2d/concepts/input/) are driven directly, so it has no
key presses. The [overlay](/engines/simple-2d/concepts/diagnostics/) is the
engine's panel and toggle, so it draws nothing. What remains on the surface is
exactly the part of driving the game that only the game can supply.

The overlay and the surface face opposite directions: a diagnostic source names a
value for a human watching the panel, and the surface names the operations and
readings a caller drives from code.

## Inert in play

Nothing on the surface runs until something calls it. A build ships it in every
bundle, and a player never reaches it: the engine publishes nothing on the page,
so the surface is reachable only by whoever holds the engine, which in a validator
is the suite that constructed it.

The idioms for writing one are at [Usage](/engines/simple-2d/usage/debug/), and
the exact declarations are at the [game](/engines/simple-2d/apis/game/) and
[engine](/engines/simple-2d/apis/engine/) APIs.
