---
title: Possession
---

A player's intent reaches the world along one chain. A key event reaches the
engine's binding table, the table resolves a named action to a magnitude, a
player controller reads that magnitude, and the controller writes to the pawn it
possesses. The engine owns every link up to the read, and the game owns the last
one.

Routing intent this way has two consequences. The thing that decides what a pawn
does each frame is a controller rather than a keyboard, so the same pawn class
serves a player and a computer opponent. And a controller is a substitutable
object, so anything that can construct one can drive a pawn along the path play
uses.

## The chain from key to pawn

The engine attaches its `keydown` and `keyup` listeners to the event target the
surface supplies, and to the canvas's owning document when the engine was built
without a surface. Each event carries a `KeyboardEvent.code`, and the binding
table raises every action bound to that code. An action resolves to a single
number: `0` or `1` for a digital action, and the magnitude as given for an
analog one.

A player controller reads that number by name in its tick and writes the result
onto the pawn it holds. Controllers tick before any actor, so the pawn's own
tick observes the intent already written for the frame and moves on it. A pawn
therefore reads a plain field rather than the keyboard, and the same field can
be written by anything.

## Actions are the whole vocabulary

The binding table is declared once, while the game instance initializes, and it
survives every level transition. The names belong to the game, and a touch
layout brings a vocabulary the engine recognizes on top of the game's own names.
Every question about the player is asked by name, so one place resolves what a
build bound, and a magnitude arriving from a key reads the same as one arriving
from a touch control.

## Input enters through a player controller

`PlayerController.input` is the only reader in the engine. Reading an action
requires holding a player controller, which means the objects in a world reach
the keyboard through the controller that possesses them and through nothing
else.

That single seam is what makes a pawn's behavior independent of its driver. A
pawn exposes the movement it can perform and applies whatever intent it was
given; deciding that intent belongs one level up, in the controller.

## One pawn class, two drivers

A game mode names the player controller class it builds through
`playerControllerClass` and hands an `AIController` class to `addBot`, and both
possess a pawn of the mode's `pawnClass`. The player controller derives its
drive from the action reader; the AI controller derives the same drive from the
world it can see, through `world.find`, `world.byTag`, and the collision
queries. The pawn is one class either way.

A check drives a pawn by substituting a controller: it possesses the pawn with a
controller of its own and steps the engine, and the pawn moves exactly as it
does in play. Delivering key events at the engine's event target exercises the
whole chain instead, from the binding table down. Both paths reach the pawn
through possession.

## Edges are consumed per controller

An edge is armed when an action's resolved value crosses from rest into motion,
whichever source moved it. A key event whose `repeat` flag is set arms nothing,
so an auto-repeat is a continuation of the hold.

Each player controller holds its own copy of an armed edge. `pressed` is `true`
exactly once per armed edge per controller and the call consumes that
controller's copy, so two controllers bound to one action each see the press
while a second read inside one controller sees nothing.

The engine closes the input frame after the frame renders and discards every
edge left unconsumed. A press is news for exactly one frame, so an edge armed
during a frame no controller polled stays in that frame rather than surfacing
later, out of order with the input that caused it.

## The possession lifecycle

A controller enters the world through the game mode. `addPlayer` builds the
player state, the player controller, and the pawn, and possesses; `addBot` does
the same for an AI controller. Both run inside the mode's `beginPlay`, after
every actor the level declares has begun play.

`possess` releases whatever the controller held, takes the new pawn, notifies it
through `possessedBy`, and emits `possession:changed`. Possessing a pawn another
controller already holds releases that controller first, so possession is
exclusive in both directions. `unpossess` clears the held pawn, notifies it
through `unpossessed`, and emits the same event with a `null` pawn. A released
pawn stays in the world, alive and ticking, with nothing writing its intent.

Possession ends with the world. Each controller's `endPlay("level-closed")` runs
in reverse order of addition, before the actors end play, and the incoming level
builds fresh controllers, player states, and pawns. The game instance is what
carries a value across a transition.

## When a possessed pawn dies

Destroying a pawn unpossesses it first. At the end of the frame the pawn's
components end play and then the pawn does, and the mode's
`pawnDied(controller, pawn)` runs afterwards. The controller stays in the world
and keeps ticking with `pawn` at `null`, which is why a controller's tick starts
by confirming it holds a pawn.

`pawnDied` is where a mode decides what a death means. Calling
`restart(controller)` spawns a fresh pawn at `spawnPoint(controller)` and
possesses it, either at once or after a delay scheduled with `world.after`.
A mode that ends the match instead calls `setPhase("over")` and leaves the
controller empty, and one that tracks lives reads and writes them on the
controller's player state.
