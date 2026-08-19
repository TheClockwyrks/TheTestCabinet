---
title: Overview
---

This section states how a build writes its code against Simple 2D: the shape of
a build, the worked examples, and the idioms the engine expects. Every example
here is game-side code.

The engine ships its own documentation inside its package. Seeding copies that
directory into the run workspace at `engine/`, and the rendered prompt names the
engine and points the build at it, so a model builds against the same contract
this section states. These pages are the developer-facing statement of it.

## The division

The build supplies `update(dt)`, `render(ctx)`, its action registrations, its
cue definitions, and its diagnostic sources. It writes its own simulation and
its own drawing, in logical coordinates.

The engine owns everything around that: the frame loop and its delta time, the
canvas fit, keyboard listening and edge detection, the audio graph and its
unlock, asset resolution, and the overlay.

## Pages

| Page | Covers |
| --- | --- |
| [Creating the Engine](/engines/simple-2d/usage/creating-the-engine/) | The canvas, the design size, the background and layout options, and where the call goes. |
| [The Game Loop](/engines/simple-2d/usage/the-game-loop/) | Writing `update(dt)` and `render(ctx)`, integrating against delta time, and stopping. |
| [Drawing](/engines/simple-2d/usage/drawing/) | Drawing in logical coordinates, the cleared frame, and mapping a pointer position back. |
| [Actions](/engines/simple-2d/usage/actions/) | Registering actions, reading held values and edges, and selecting a touch layout. |
| [Audio and Assets](/engines/simple-2d/usage/audio-and-assets/) | Defining and playing cues, muting, and loading assets under the asset root. |
| [Diagnostics](/engines/simple-2d/usage/diagnostics/) | Registering overlay sources and choosing what a case's checks can read. |
