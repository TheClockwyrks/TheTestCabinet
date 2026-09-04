---
title: Input
---

The engine owns the keyboard and the pointer. A game registers its named
actions and the keys that drive them while it initializes, then asks by name
what each action is doing while it runs; the pointer it reads as a position
already in the engine's logical coordinates. Key and pointer events are handled
inside the engine.

Named actions have three consequences. An action is driven by a key or by a
touch control and the game reads one number either way, so a build is
examinable by delivering input at the same seam a player uses. The bindings are
data the engine holds rather than logic spread through event handlers, so one
place resolves what a build bound. And edge detection happens once, in the
engine, in place of being re-derived in every game.

## Named actions

An action is a name carrying a binding: the physical keys that drive it and the
kind it reports. The registered actions are the whole input vocabulary a build
speaks, and every question the game asks about the player it asks by name.

The names belong to the game. A touch layout brings a vocabulary the engine
recognizes, and a registration under any other name is equally ordinary, which
is what lets a design name the actions it actually has.

Registering happens during the game instance's initialization, so the vocabulary
is complete before the first frame reads it. The registry belongs to the engine
rather than to a world, so the bindings a game declares once hold across every
level transition. Registering a name a second time replaces its binding
wholesale and returns the action to rest, keeping its position in the
registration order.

## Bindings name physical keys

A binding names `KeyboardEvent.code` values rather than `key` values, so it is
independent of the keyboard layout the player types on. `KeyW` is the same
physical key on QWERTY and on AZERTY, so the WASD cluster sits in the same place
for every player.

The engine listens for those events on the event target the game's surface
supplies, and on the canvas's owning document when the game supplies no surface.
Every key a player presses reaches the actions along that one path, so a caller
that dispatches key events into a target of its own drives the game exactly as
the player does. A validator supplies its own target and holds, taps, and
releases keys over a canvas with no document behind it.

Several keys may drive one action, and one key may drive several actions. An
action bound to several keys stays held until the last of them is released, and
a key bound to several actions raises all of them together.

## Digital and analog

The kind an action is registered with is a promise about how the game reads it.
A digital action reports a plain on or off, and any magnitude reaching it is
quantized to full deflection. An analog action reports a continuous magnitude,
which is what a touch slider or a steering axis produces; a held key gives an
analog action full deflection, since a key has one position.

Declaring the kind up front is what lets the engine decide what a keyboard
binding means for a given action, so the game reads one number whichever source
moved it and a partial magnitude lands only on the actions written to receive
one.

## Reading through a controller

A player controller is the seam between the input registry and the simulation.
It holds the reader, asks the actions what they are doing on its own tick, and
writes the result onto the pawn it possesses. An actor therefore moves because
something drove it, and the same pawn class is driven by a player, by an AI
controller, or by a controller a validator substitutes.
[Possession](/engines/structured-2d/concepts/possession/) covers how a magnitude
reaches a pawn.

## Edges last one frame

A press is the moment an action's resolved value crosses from rest into motion,
whichever source moved it. Because every source funnels through one place, a
press means one thing: an operating system auto-repeat is a continuation of the
hold, and pressing a second key bound to an already-held action leaves the
action held.

Each player controller carries its own copy of an armed edge, and reading
consumes that controller's copy alone. Two controllers bound to one action each
see the press, so a local two-player build gives both players the same
vocabulary, and one controller reading an edge leaves the other's intact. Within
a controller the first read takes the press, which is what makes an edge safe to
poll from more than one place.

The engine closes the input frame after the frame has rendered, discarding every
edge left unconsumed. A press is news for exactly one frame, so an edge armed
during a frame nothing polled stays in that frame rather than surfacing later,
out of order with the input that caused it. A paused world still renders and
still closes its input frame, so a pause holds the simulation still while input
keeps moving at its ordinary rate.

## The pointer

The pointer is the one input whose meaning depends on where the picture is: a
click is a claim about a position on the stage, and the stage sits letterboxed
and scaled inside whatever element the page gave the canvas. The engine owns
that conversion for the same reason it owns the canvas fit — every pointer game
otherwise re-derives it, usually forgetting the device pixel ratio or the bars —
so the position a controller reads is in the logical coordinates the camera
projects into, and a game that needs a world position maps it through the
camera.

A controller reads the pointer two ways, and they serve different designs. The
snapshot answers "where is the pointer now, and is it held", which is what
aiming and hovering need. The sample list holds every position delivered since
the last frame closed, in arrival order, which is what direct manipulation
needs: a game that reacts to the path the pointer traveled resolves each sample
on its own rather than seeing only where the sweep ended.

Press and release edges follow the same rules as action edges: armed by the
transition, carried per player controller, consumed by that controller's first
read, and discarded when the frame closes. The snapshot and the edges follow
the primary pointer, so a mouse and a touch drive the game the same way, and a
multi-touch gesture's second finger reaches the game through the contacts and
the samples alone.

## Touch layouts

A touch layout is a vocabulary contract rather than a widget. Naming
`dual-vertical` states that the control scheme is two vertical sliders and that
the actions in play are the four the scheme drives. Selection is declarative: it
names the vocabulary, and the game registers each action with its own binding.

A layout is selected when the engine is created, so every registration the game
makes happens under it. An action whose name is in the selected layout's
vocabulary is recorded as belonging to that layout, and every other action is
recorded as the game's own.

The catalogue is closed. A name outside it fails at construction, because a
silent fallback to a default would let a run be configured for one control
scheme and executed under another, leaving the run record describing a run that
never happened. Adding a layout is a deliberate change to the engine and a new
engine version.

## The menu vocabulary

Every layout carries `confirm`, `back`, `pause`, and `mute` on top of its own
vocabulary. These four are about the shell around the game rather than the game
itself, and they exist in every build however it is played, so a game binds
`pause` once and gets it under whichever layout is live.

Holding them in one place keeps the two halves of a vocabulary apart: the
catalogue entry describes the control scheme, and the menu vocabulary describes
the shell that surrounds it.

## Engine chrome stays out of the actions

The key that toggles the debug overlay is handled by a listener the engine owns,
outside the registered actions. The actions are the game's vocabulary exactly,
and the overlay toggle reaches the engine whatever the game bound.
