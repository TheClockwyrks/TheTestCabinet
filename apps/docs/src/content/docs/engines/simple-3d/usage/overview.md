---
title: Overview
---

This section states how a build writes its code against Simple 3D: the shape of
a build, the worked examples, and the idioms the engine expects. Every example
here is game-side code.

The engine ships its own documentation inside its package. Seeding copies that
directory into the run workspace at `engine/`, and the rendered prompt names the
engine and points the build at it, so a model builds against the same contract
this section states.

## The division

The build supplies one [`Game<S, D>`](/engines/simple-3d/apis/game/). Its
`initialize` declares the action bindings, cue definitions, assets, and
diagnostic sources the game needs and returns the state beside the debug
surface, as `[state, debug]`; its `update` returns the next state from the
current one and the frame's delta; its `render` updates the scene from the
state, poses the camera, and draws the HUD on the screen layer in logical
coordinates.

The engine owns everything around that: the frame loop and the clock behind its
delta time, the canvas fit, keyboard and pointer listening and edge detection,
the audio graph and its unlock, asset resolution, the renderer, the scene
object and the camera it renders through, the screen layer and its compositing,
the recorder, and the overlay.

The state is the only channel between the three functions. The engine holds it
as a value: each frame it hands the current state to `update` as a read-only
view, keeps what `update` returns, and hands that to `render`. The state carries
the simulation alone; the objects a game places in the scene live on the render
side, keyed by the ids the state carries. A build
reaches for its own module-level variables for constants and for that render
cache.

## Pages

| Page                                                                       | Covers                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Creating the Engine](/engines/simple-3d/usage/creating-the-engine/)       | The design size, the options `createEngine` takes, `three` as a peer dependency, the screen canvas, the projection, shadows, sizing the canvas from CSS, choosing a clock, and teardown.                   |
| [The Game Loop](/engines/simple-3d/usage/the-game-loop/)                   | Writing `initialize`, `update`, and `render`, booting the engine, integrating against delta time, pausing, and ending a run.                                                                               |
| [The Scene](/engines/simple-3d/usage/the-scene/)                           | Building objects once and updating them from the state each frame, the render cache, adding and removing objects as the state changes, models and `cloneModel`, lights, shadows, and the scene background. |
| [The Camera and Pointer](/engines/simple-3d/usage/the-camera-and-pointer/) | Posing an orbit camera from the state, picking a world object from the pointer with `view().ray`, projecting a world point for a label, and the letterbox rule.                                            |
| [The Screen Layer](/engines/simple-3d/usage/the-screen-layer/)             | Drawing the HUD in logical coordinates on the cleared screen layer, composited over the 3D picture.                                                                                                        |
| [Actions](/engines/simple-3d/usage/actions/)                               | Registering actions, reading held values and edges, and selecting a touch layout.                                                                                                                          |
| [Audio and Assets](/engines/simple-3d/usage/audio-and-assets/)             | Defining and loading cues, playing them from `update`, positional playback, and loading images, textures, models, and audio under the asset root.                                                          |
| [Diagnostics](/engines/simple-3d/usage/diagnostics/)                       | Registering overlay sources and choosing what a case's checks can read.                                                                                                                                    |
| [Debug Surface](/engines/simple-3d/usage/debug/)                           | Declaring the surface type, writing its poses and readings over the state, exposing it from `initialize`, and driving it through `engine.apply` and `engine.state`.                                        |
