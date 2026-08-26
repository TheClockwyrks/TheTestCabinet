---
title: Worlds
---

The engine owns one world at a time. A level describes what that world should
contain, and opening the level builds it. Everything a match is made of lives
inside the world the level produced.

## A level is a description, a world is the instance

A level is inert data: the game mode class that will run it, the actors it
places with their transforms and tags, and a load step for the assets and cues
it needs. Nothing in a level is live, so the same level opens as many times as a
game asks and each opening starts from the same description.

A world is the live object built from that description. It holds the constructed
game mode, the constructed actors, and the timers and collision queries the
frame reads. A game reaches the world through the engine and, from inside the
framework, through the `world` every actor, component, controller, and game mode
carries.

Levels are registered by name on the game definition, and the definition also
names the level the engine opens when it initializes. A name is the whole
identity a level has, which is what lets a game travel by naming a destination
and what lets a validator assert on where the game currently is.

## One world is open at a time

Exactly one world exists between the moment initialization resolves and the
moment the engine is destroyed. Opening another level closes the current world
first, so a game never holds two live worlds and an actor never has to ask which
one it belongs to.

The single open world is what makes the framework's object graph unambiguous.
The actor list is the list of things in the world, the controller list is the
list of things driving them, and the game state is the match those actors are
playing.

## What a world owns

A world owns the
[game mode](/engines/structured-3d/concepts/gameplay-framework/) that decides
the match and the game state that records it, including every player state the
mode created. It owns every actor and every component attached to them, and
every controller, player and AI alike.

It also owns the systems those objects read: the camera, the collision world,
the timers scheduled against simulated world time, and the diagnostic sources
registered for this world alone. Each of these is built when the world opens and
released when it closes.

Ownership is what makes the lifetime rule simple. A thing scoped to one match
belongs to the world and is rebuilt with it; a thing scoped to the whole game
belongs to the game instance and outlives every transition.

## A transition is deferred to the end of the frame

A request to open another level is recorded rather than performed. The engine
honors it after the frame's ticks and collision pass have finished and before
the frame renders.

Deferring it is what keeps a tick reading a whole world. An actor that decides
to travel returns from its own tick into a world that still holds its peers,
every remaining actor ticks against the same world, and the game mode sees the
settled result of the frame that requested the travel.

Performing it before the render is what keeps the picture honest. The frame that
requested the transition draws the incoming world, so no frame ever draws a
world that is half torn down or half built.

One request per frame is honored, and a later request in the same frame replaces
an earlier one. Two systems that both decide to travel in a single frame
therefore produce a single transition to the destination decided last.

## A transition is asynchronous

The incoming level loads its assets before its world is built, and loading is
asynchronous, so the transition is too. The loop runs no frame while a
transition is in flight, and the canvas keeps the last frame it drew.

Holding the last frame is what gives a build a stable picture across the gap. A
game that wants a loading screen draws one from a source it controls.

An explicit advance awaits the transition before running the next frame, so a
scripted sequence of frames crosses a level boundary without the caller
coordinating anything.

## What survives and what is rebuilt

The game instance is the one framework object that crosses a transition. Its
fields survive with it, and so does everything registered against the engine
rather than the world: the action bindings, the cue definitions, the assets the
instance holds, the instance's diagnostic sources, and every subscription made
on the engine's events.

The world and everything it owns is rebuilt. The game mode, the game state, the
player states, every actor and component, every controller, the camera, the
world's timers, and the world's diagnostic sources all end play and are
constructed again from the incoming level's description.

The frame counter and the accumulated simulated time belong to the loop, so they
carry across. The world's own elapsed time belongs to the world, so it restarts
at zero.

The split decides where a value belongs. A score that must survive travel lives
on the instance; a score scoped to one match lives on the game state.

## Pausing is a property of the world

A pause suspends the world's simulation. The controllers, the actors, their
components, the timers, the collision pass, and the game mode all stand still,
and the world keeps rendering, so a pause screen draws over the world it
suspended.

An actor may opt into ticking while its world is paused. That is what drives a
pause menu: the menu is an ordinary actor that reads its action through a player
controller, and it runs in a world where nothing else does.

The match phase is a separate idea, recorded on the game state and owned by the
game mode. A paused world may hold a match in any phase, and a match that has
ended runs in a world that is still simulating. Keeping the two apart is what
lets a game pause a match in progress and resume it exactly where it stood.
