---
title: Overview
---

This section states how a build writes its code against Simple 3D: the shape of
a build, the worked examples, and the idioms the engine expects. Every example
here is game-side code.

The engine ships its own documentation inside its package. Seeding copies that
directory into the run workspace at `engine/`, and the rendered prompt names the
engine and points the build at it, so a model builds against the same contract
this section states. These pages are the developer-facing statement of it.

## The division

The build supplies one [`Game<S, D>`](/engines/simple-3d/apis/game/). Its
`initialize` declares the action bindings, cue definitions, assets, and
diagnostic sources the game needs and returns the state beside the debug
surface, as `[state, debug]`; its `update` returns the next state from the
current one and the frame's delta; its `render` draws the state through the
scene context, in world units for the scene and logical coordinates for the
HUD.

The engine owns everything around that: the frame loop and the clock behind its
delta time, the canvas fit, the renderer behind the scene context, keyboard
listening and edge detection, the audio graph and its unlock, asset resolution,
and the overlay.

The state is the only channel between the three functions. The engine holds it
as a value: each frame it hands the current state to `update` as a read-only
view, keeps what `update` returns, and hands that to `render`. A build reaches
for its own module-level variables only for constants.

## Pages

| Page | Covers |
| --- | --- |
| [Creating the Engine](/engines/simple-3d/usage/creating-the-engine/) | The design size, the options `createEngine` takes, sizing the canvas from CSS, choosing a clock, and teardown. |
| [The Game Loop](/engines/simple-3d/usage/the-game-loop/) | Writing `initialize`, `update`, and `render`, booting the engine, integrating against delta time, pausing, and ending a run. |
| [Drawing](/engines/simple-3d/usage/drawing/) | Drawing through the scene context: the camera and lights, meshes and procedural geometry in world space, the HUD, and picking with the pointer. |
| [Actions](/engines/simple-3d/usage/actions/) | Registering actions, reading held values and edges, and selecting a touch layout. |
| [Audio and Assets](/engines/simple-3d/usage/audio-and-assets/) | Defining and loading cues, playing them from `update`, and loading meshes, textures, and materials under the asset root. |
| [Diagnostics](/engines/simple-3d/usage/diagnostics/) | Registering overlay sources and choosing what a case's checks can read. |
| [Debug Surface](/engines/simple-3d/usage/debug/) | Declaring the surface type, writing its poses and readings over the state, exposing it from `initialize`, and driving it through `engine.apply` and `engine.state`. |
