---
title: Overview
---

This section is a set of complete programs. Each page shows every file the build
it describes consists of, whole, so the engine's surface can be judged from
working code. Every file compiles against the types the
[APIs](/engines/simple-3d/apis/overview/) section declares.

Each build has the same shape. `index.html` is the page the build is served as,
`src/main.ts` creates the engine and boots it, `src/game.ts` exports the
`Game<S, D>` the engine drives, `assets/` holds the files the game loads, and
`tests/` holds the vitest suites a case checks the build with.

```
index.html
src/main.ts
src/game.ts
assets/
tests/
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
| [A Minimal Game](/engines/simple-3d/examples/a-minimal-game/) | The smallest complete build: a page, a boot module, and a game that slides a box across a lit floor and reflects it at both ends. |
| [Input and Actions](/engines/simple-3d/examples/input-and-actions/) | Registering a touch layout's vocabulary, driving a rover from held analog axes and a button edge, and driving the same code from a key and from a test. |
| [Audio and Assets](/engines/simple-3d/examples/audio-and-assets/) | Loading a mesh and a produced audio file during initialization, playing a synthesized cue and a file-backed cue, and surfacing a failed load. |
| [Diagnostics and Overlay](/engines/simple-3d/examples/diagnostics-and-overlay/) | Registering overlay sources during initialization and reading them back while the game runs. |
| [Validating a Game](/engines/simple-3d/examples/validating-a-game/) | A vitest suite that imports the build's own game, steps it with `engine.advance`, and checks the simulation, the recorded draw calls, and a projected point. |
| [Scripted Clocks](/engines/simple-3d/examples/scripted-clocks/) | One scenario stepped under a constant, a repeating sequence, and a seeded jitter clock. |
