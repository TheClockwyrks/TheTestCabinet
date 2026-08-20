---
title: The Gameplay Framework
---

The engine supplies the object model a game is built out of. A game instance
holds what outlives a level, a world holds one running level, a game mode holds
the rules of the match inside it, actors are the things in that world, and
controllers drive the actors they possess. A build writes its game as subclasses
of these classes, and the engine constructs them, ticks them, renders them, and
tears them down in a fixed order.

## The game instance

The game instance is constructed once, before the start level opens, and shut
down from `engine.destroy`. It is the one framework object that outlives a level
transition, so a value that must survive travel lives on the instance.

The instance declares what belongs to the whole game: the action bindings, the
cue definitions, the assets it loads and holds, and the diagnostic sources the
overlay reads across every level. It is told when each world opens and when each
world is closing, which is where a game carries a running total from one level
into the next.

## The world

A world is one running level. A level is a description naming a game mode, a set
of actors to declare, and an optional load step; opening it builds the world,
and closing it destroys everything the world held.

The world owns the live objects: the actors, the controllers, the camera, the
collision world, the timers, and the world-scoped diagnostic sources. It is also
the object a game looks things up through, with `actors`, `byTag`, `ofType`,
`find`, `controllers`, and `players`. `world.open` requests the next level, and
the request is deferred to the end of the frame so a tick never observes a
half-built world.

## The game mode

The [game mode](/engines/structured-2d/apis/game-mode/) is the rules of a match.
It is the only object that decides how a match starts, how it scores, and how it
ends: it adds the players and the bots, chooses the classes their controllers,
player states, and pawns are built from, respawns a pawn through `restart` and
`spawnPoint`, moves the match through its phases with `setPhase`, and opens the
next level when the match is decided.

The mode is constructed with the options `world.open` was given and begins play
after every declared actor has begun play, so it sees a fully built world. It
ticks after every actor has ticked and after collision has been reported, so it
decides the match from a settled world rather than from a world half way through
its frame.

## The game state and the player states

The game state carries the match figures every object may read: the phase, the
elapsed match time, and the player states. It is built from the mode's
`gameStateClass` when the world is built, and a game subclasses it to add the
figures its own match keeps.

A player state is one participant's durable record, built for a player and a bot
alike, carrying the index, the name, and the score. It belongs to the
participant rather than to the pawn, so it survives every respawn its controller
performs. A game subclasses it to add per-participant figures such as lives or
ammunition.

## Actors, pawns, and components

An actor is a thing in the world. It carries a transform, a set of tags, and the
components it is assembled from, and it begins play, ticks, and ends play with
the world. Every actor a level declares exists before any of their `beginPlay`
runs, so an actor finds its peers there.

A pawn is an actor a controller may drive. Possession is a link between the two:
the pawn holds the controller that possesses it and is notified when possession
changes, and the controller decides what the pawn does each frame.

A component is one piece of an actor: an appearance, a collider, a camera
target, or behavior of its own. It is attached to exactly one actor for its
lifetime, carries an offset from that actor's transform, and ticks after its
actor each frame. Assembling an actor out of components is how a game reuses one
behavior across unrelated actors.

## Controllers

A controller is the will behind a pawn. A player controller reads the game's
registered actions through its input reader and writes the result to the pawn it
possesses; an AI controller runs its own behavior and writes to its pawn the
same way. Both are added by the game mode, both carry a player state, and both
tick before any actor ticks, so a pawn's own tick observes the input its
controller already applied.

Input reaches the simulation through a player controller and nowhere else. A
player pawn and a computer-driven pawn are therefore the same class driven by
two different controllers, and a validator drives a pawn by possessing it with a
controller of its own.

## Controllers live beside the actor list

A controller carries its pawn and its player state alone, and the world keeps it
in a list of its own, so the actor list stays a list of things in the world. The
separation is what gives possession its meaning: the pawn is the body in the
world, the controller is the will driving it, and either one can be replaced
while the other continues.

It is also what makes a match's participants outlast their bodies. A pawn is
destroyed and respawned as often as the match calls for it, while the controller
and its player state persist for the length of the world.

## What each role owns

| Role | Owns | Lifetime |
| --- | --- | --- |
| Game instance | Action bindings, cue definitions, game-wide assets, instance diagnostic sources | Constructed before the start level opens, shut down from `engine.destroy` |
| World | Actors, controllers, the camera, the collision world, timers, world diagnostic sources | One open level, from the level opening to the level closing |
| Game mode | The rules of the match: players, bots, respawns, and the phase | Built with the world, ends play with the world |
| Game state | The match figures: phase, elapsed match time, the player states | Built with the world, ends with the world |
| Player state | One participant's index, name, score, and the figures a game adds | From `addPlayer` or `addBot` until the world closes |
| Actor | Its transform, its tags, and its components | From `spawn` until `destroy` or the world closes |
| Pawn | The same, plus the link to the controller possessing it | The same as any actor |
| Controller | The pawn it possesses, its player state, and a player controller's input reader | From `addPlayer` or `addBot` until the world closes |
| Component | Its offset from its actor and the one behavior or appearance it supplies | From `attach` until `detach` or its actor ends play |

## Match phases

A match runs through three phases: `"waiting"` while it is being set up,
`"playing"` while it runs, and `"over"` once it is decided. A mode holds
`"waiting"` when it begins play.

`setPhase` is the only way the phase changes. It sets the phase on the mode,
writes it onto the game state, and emits `match:phase` carrying the new phase
and the previous one; setting the phase the mode already holds emits nothing.
The match clock follows from it, since `elapsed` accumulates only while the
phase is `"playing"`.

The phases are what the rest of the game reads to decide whether it is running.
A mode's `tick` gates its scoring on the phase, an actor gates its behavior on
it, and the debug overlay and the host interface both report it.

## Building inside the framework

A build fills the roles above: a game mode for each level's rules, actors and
pawns for the things in the world, components for the pieces they are assembled
from, and controllers for the wills that drive them. The engine constructs each
of them, ticks them in a fixed order, renders them, and ends their play, so a
build writes the behavior and the framework supplies the lifecycle.
