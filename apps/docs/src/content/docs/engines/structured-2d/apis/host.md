---
title: Host Interface
---

The host interface is exported from `@test-cabinet/structured-2d/host`, a module
that depends only on the shared contract types. It is importable for its
constants and types alone, without pulling in the engine.

The interface is a read-mostly view of a running build, published on the game's
own window. It lets a post-run check confirm that a built page booted and is
running frames, and it lets a person inspect a running build from a devtools
console. A build is driven by constructing an engine directly, so the interface
carries observation, the overlay switch, and the two render switches alone.

## Constants

| Export | Type | Value |
| --- | --- | --- |
| `HOST_HANDLE` | `string` | `"__tcabEngine"` |
| `HOST_VERSION` | `number` | `1` |

`HOST_HANDLE` is the `window` property the interface is installed on. The engine
package is the single source of it, so a reader imports the constant rather than
hard-coding the name. An engine manifest declares no handle, because a validator
constructs the engine itself and holds its state, events, and drawing context as
live values.

`HOST_VERSION` is bumped whenever a member's shape or meaning changes. A reader
takes it first, and can then report that a build predates the member it wants.

## `EngineHost`

```ts
interface EngineHost {
  version: number;
  frame(): FrameInfo;
  diagnostics(): Record<string, unknown>;
  world(): WorldSnapshot;
  setOverlay(enabled: boolean): void;
  setRenderMode(mode: RenderMode): void;
  setCollisionOverlay(enabled: boolean): void;
}
```

| Member | Result |
| --- | --- |
| `version` | `HOST_VERSION` at the time the page was built. |
| `frame` | The [frame](/engines/structured-2d/apis/engine/) counter, the accumulated simulated time, and the delta the most recent frame was stepped by. |
| `diagnostics` | The build's registered [diagnostic](/engines/structured-2d/apis/diagnostics/) sources, evaluated at the moment of the call, independent of whether the overlay is visible. |
| `world` | A snapshot of the world currently open. |
| `setOverlay` | Shows or hides the debug overlay without touching the toggle key. |
| `setRenderMode` | Sets the [render mode](/engines/structured-2d/apis/rendering/) the pipeline draws in. |
| `setCollisionOverlay` | Shows or hides the collision overlay, independent of the render mode. |

`frame` is what a post-run check reads: a handle that is present and a counter
that has advanced between two reads is a page that booted, opened its start
level, and is running frames.

`createEngine` installs the handle, so a build that constructs an engine
publishes one. The handle appears at construction, before any game code runs,
and the frame counter stays at zero until initialization resolves and the loop
starts.

## `WorldSnapshot`

```ts
interface WorldSnapshot {
  level: string;
  phase: MatchPhase;
  time: number;
  actors: number;
  players: readonly { index: number; name: string; score: number }[];
}
```

| Field | Reports |
| --- | --- |
| `level` | The name the open world was opened under. |
| `phase` | The match phase the game mode holds. |
| `time` | Seconds of simulated time the open world has been stepped by. |
| `actors` | How many live actors the world holds. |
| `players` | One entry per player state, in index order, carrying its index, its name, and its score. |

Every value crosses a page evaluation as plain data that survives structured
cloning. `diagnostics` reduces each source's value through a JSON round trip,
and `world` reports counts and names rather than the live objects, so a reader
holds a description of the match rather than a reference into the running
engine.

## Ports

`installHost` draws on the narrow slice of each subsystem it calls, declared
structurally rather than as the concrete classes.

```ts
interface FramePort {
  info(): FrameInfo;
}

interface DiagnosticsPort {
  read(): Record<string, unknown>;
  setEnabled(enabled: boolean): void;
}

interface WorldPort {
  snapshot(): WorldSnapshot;
}

interface RendererPort {
  setMode(mode: RenderMode): void;
  setCollisionOverlay(enabled: boolean): void;
}

interface HostPorts {
  /** The object the handle is written to; the game's `window` in a browser. */
  target: Record<string, unknown>;
  frame: FramePort;
  diagnostics: DiagnosticsPort;
  world: WorldPort;
  renderer: RendererPort;
}
```

## `installHost`

```ts
function installHost(ports: HostPorts): () => void;
```

Builds the `EngineHost` over `ports`, writes it to `ports.target[HOST_HANDLE]`,
and returns the function that removes it again.

Installing over an existing handle replaces it. A page that tears one engine
down and builds another ends up published by the engine that is actually
running.

The returned uninstaller deletes the handle only while the installed host is
still the one it published. Teardown tends to create the replacement first and
dispose of the superseded engine afterwards, so destroying a superseded engine
leaves its replacement in place.
