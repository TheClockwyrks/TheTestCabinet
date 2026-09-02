---
title: Overview
---

This section states how a build writes its code against Structured 3D: the shape
of a build, the worked examples, and the idioms the engine expects. Every
example here is game-side code.

The engine ships its own documentation inside its package. Seeding copies that
directory into the run workspace at `engine/`, and the rendered prompt names the
engine and points the build at it, so a model builds against the same contract
this section states.

## The division

The build supplies a
[`GameDefinition`](/engines/structured-3d/apis/game-instance/): a game instance
class, a level registry, and the level the engine opens first. A level names the
game mode to run and the actors placed in it. The engine builds a world from
that description and drives it.

Opening a level awaits the level's `load`, then constructs the game mode, the
game state, and the declared actors. Every declared actor's `beginPlay` runs in
spawn order once all of them exist, and the game mode's `beginPlay` runs last.
Each frame the engine ticks the controllers, then the actors and their
components, then the timers, then the collision pass, then the game mode, and
renders the result: the world pass through the camera, and the screen layer over
it.

The game instance is the one framework object that outlives a level transition,
so a value that must survive travel lives there and a value scoped to one match
lives on the game state. The instance's `initialize` is where the action
bindings, the cue definitions, the instance's assets, and its diagnostic sources
are declared, and it returns the debug surface a caller drives the build through.

## Pages

| Page | Covers |
| --- | --- |
| [Creating the Engine](/engines/structured-3d/usage/creating-the-engine/) | The design size, the options `createEngine` takes, the peer dependency on `three`, the screen layer, sizing the canvas from CSS, choosing a clock, booting, and teardown. |
| [Levels and Worlds](/engines/structured-3d/usage/levels-and-worlds/) | Registering levels, placing actors with 3D transforms, loading what a level needs, opening one from play, and what crosses a transition. |
| [Game Modes](/engines/structured-3d/usage/game-modes/) | Writing a mode's rules, moving the match through its phases, adding players and bots, and carrying figures on the game state. |
| [Actors and Components](/engines/structured-3d/usage/actors-and-components/) | Writing an actor, attaching components, moving and turning with the math helpers, mounting a component on an offset, tagging, finding peers, and destroying. |
| [Controllers and Pawns](/engines/structured-3d/usage/controllers-and-pawns/) | Reading a dual-stick layout in a player controller, driving a pawn with a move and a look intent, and running the same pawn from an AI controller. |
| [Rendering](/engines/structured-3d/usage/rendering/) | Attaching mesh and light components, ordering them by layer, the render modes, the screen layer, and drawing directly. |
| [Models and Animation](/engines/structured-3d/usage/models-and-animation/) | Loading a glTF model, placing it with a `ModelComponent`, playing its clips, and driving a named node. |
| [Collision](/engines/structured-3d/usage/collision/) | Declaring volumetric colliders, channels and responses, applying a response from the engine's events, and the queries and raycasts. |
| [Audio and Assets](/engines/structured-3d/usage/audio-and-assets/) | Defining and loading cues, playing them from a tick with and without a position, and loading images, textures, and models under the asset root. |
| [Diagnostics](/engines/structured-3d/usage/diagnostics/) | Registering instance and world sources and choosing what a case's checks can read. |
| [Debug Surface](/engines/structured-3d/usage/debug/) | Declaring the surface type, writing its poses and readings as methods over the live world, returning it from `initialize`, and driving it through `engine.debug`. |
