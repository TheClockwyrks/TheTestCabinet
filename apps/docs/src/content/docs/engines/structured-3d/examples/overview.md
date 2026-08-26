---
title: Overview
---

This section is a set of complete programs. Each page shows every file the build
it describes consists of, whole, so the engine's surface can be judged from
working code. Every file compiles against the types the
[APIs](/engines/structured-3d/apis/overview/) section declares.

Each build has the same shape. `index.html` is the page the build is served as,
`src/main.ts` creates the engine and boots it, `src/game.ts` exports the
`GameDefinition` the engine drives, `src/levels/` holds the level definitions it
registers, `src/actors/` holds the actor and component classes those levels
place, `assets/` holds the files the game loads, and `validation/` holds the
vitest suites a case checks the build with.

```text
index.html
src/main.ts
src/game.ts
src/levels/
src/actors/
assets/
validation/
```

The boot sequence is the same on every page as well: construct the engine,
subscribe to anything the caller wants to observe, initialize, and run.

```ts
const engine = createEngine({ canvas, width, height, game });
await engine.initialize();
await engine.run();
```

## Pages

| Page | Shows |
| --- | --- |
| [A Minimal Game](/engines/structured-3d/examples/a-minimal-game/) | The smallest complete build: a page, a boot module, one level with one game mode, and an actor that moves itself by the frame's delta. |
| [Pawns and Controllers](/engines/structured-3d/examples/pawns-and-controllers/) | A game mode that adds a player, a pawn possessed by a player controller reading registered actions, and the same pawn driven by an AI controller. |
| [Worlds and Transitions](/engines/structured-3d/examples/worlds-and-transitions/) | Two levels, a `world.open` request honored at the end of the frame, the options it carries into the incoming mode, and a value kept on the game instance across it. |
| [Game Mode and Scoring](/engines/structured-3d/examples/game-mode-and-scoring/) | A subclassed game state and player state, a score kept on them, and a match moved through `waiting`, `playing`, and `over`. |
| [Collision and Events](/engines/structured-3d/examples/collision-and-events/) | Colliders on channels with blocking and overlapping responses, a game applying its own response from `hit`, and a pickup consumed on `overlap:begin`. |
| [Audio and Assets](/engines/structured-3d/examples/audio-and-assets/) | Loading a mesh and a produced audio file in a level's `load`, defining a synthesized cue, playing both while the match runs, and surfacing a failed load. |
| [Diagnostics and Overlay](/engines/structured-3d/examples/diagnostics-and-overlay/) | Registering instance-level and world-level sources and what the overlay draws from them while the game runs. |
| [Validating a Game](/engines/structured-3d/examples/validating-a-game/) | A vitest suite that imports the build's own game definition, poses scenarios through the debug surface its `initialize` returns, steps it with `engine.advance`, and checks the world, the events, and the pixels. |
| [Scripted Clocks](/engines/structured-3d/examples/scripted-clocks/) | One scenario stepped under a constant, a repeating sequence, and a seeded jitter clock. |
