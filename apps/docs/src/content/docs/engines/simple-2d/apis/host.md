---
title: Host Interface
---

The host interface is exported from `@test-cabinet/simple-2d/host`, a module
that depends only on the shared contract types. It is importable for its types
alone, without pulling in the DOM-bound engine.

The interface is a read-mostly view of a running build, published on the game's
own window. It lets a post-run check confirm that a built page booted and is
running frames, and it lets a person inspect a running build from a devtools
console. A build is driven by constructing an engine directly, so the interface
carries observation and the overlay switch alone.

## Constants

| Export | Type | Value |
| --- | --- | --- |
| `HOST_HANDLE` | `string` | `"__tcabEngine"` |
| `HOST_VERSION` | `number` | `2` |

`HOST_HANDLE` is the `window` property the interface is installed on. It matches
the `handle` field of `engines/simple-2d/engine.toml`; the two are one contract,
and a reader looks the handle up from the engine catalogue rather than
hard-coding it.

`HOST_VERSION` is bumped whenever a member's shape or meaning changes. A reader
takes it first, and can then report that a build predates the member it wants.

## `EngineHost`

```ts
interface EngineHost {
  version: number;
  frame(): FrameInfo;
  diagnostics(): Record<string, unknown>;
  setOverlay(enabled: boolean): void;
}
```

| Member | Result |
| --- | --- |
| `version` | `HOST_VERSION` at the time the page was built. |
| `frame` | The [frame](/engines/simple-2d/apis/game/) counter, the accumulated simulated time, and the delta the most recent frame was stepped by. |
| `diagnostics` | The build's registered [diagnostic](/engines/simple-2d/apis/diagnostics/) sources, evaluated at the moment of the call, independent of whether the overlay is visible. |
| `setOverlay` | Shows or hides the debug overlay without touching the toggle key. The argument is coerced to a boolean. |

`frame` is what a post-run check reads: a handle that is present and a counter
that has advanced between two reads is a page that booted, built its state, and
is running frames.

Values cross into a page evaluation as plain data that survives structured
cloning, and `diagnostics` reduces each source's value through a JSON round trip
so that a plain value crosses unchanged, one that cannot be encoded degrades to
its string form, and one with no JSON representation reads as `null`.

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

interface HostPorts {
  /** The object the handle is written to; the game's `window` in a browser. */
  target: Record<string, unknown>;
  frame: FramePort;
  diagnostics: DiagnosticsPort;
}
```

## `installHost`

```ts
function installHost(ports: HostPorts): () => void;
```

Builds the `EngineHost` over `ports`, writes it to `ports.target[HOST_HANDLE]`,
and returns the function that removes it again.

Installing over an existing handle replaces it. A page that tears one engine
down and builds another, as a level transition or a reload does, ends up
published by the engine that is actually running.

The returned uninstaller deletes the handle only while the installed host is
still the one it published. Teardown tends to create the replacement first and
dispose of the superseded engine afterwards, so destroying a superseded engine
leaves its replacement in place.
