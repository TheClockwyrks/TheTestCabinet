---
title: Host Interface
---

The host interface is exported from `@test-cabinet/simple-2d/host`, a module
that depends only on the shared contract types and the schedule validator. It is
importable for its types alone, by a validation script or a driver, without
pulling in the DOM-bound engine.

The types these operations exchange are specified with their subsystems:
[frame](/engines/simple-2d/apis/frame/),
[input](/engines/simple-2d/apis/input/),
[audio](/engines/simple-2d/apis/audio/),
[assets](/engines/simple-2d/apis/assets/), and
[diagnostics](/engines/simple-2d/apis/diagnostics/).

## Constants

| Export | Type | Value |
| --- | --- | --- |
| `HOST_HANDLE` | `string` | `"__tcabEngine"` |
| `HOST_VERSION` | `number` | `1` |

`HOST_HANDLE` is the `window` property the interface is installed on. It matches
the `handle` field of `engines/simple-2d/engine.toml`; the two are one contract,
and a driver looks the handle up from the engine catalogue rather than
hard-coding it.

`HOST_VERSION` is bumped whenever an operation's shape or meaning changes.

## `EngineHost`

The operations a driver may perform on a running engine.

```ts
interface EngineHost {
  version: number;
  setClock(mode: ClockMode): void;
  setSchedule(schedule: Schedule): void;
  advance(steps: number): void;
  frame(): FrameInfo;
  actions(): RegisteredAction[];
  setAction(name: string, value: number): void;
  pressAction(name: string): void;
  layout(): TouchLayout | null;
  audioLog(): CueEvent[];
  audioState(): AudioState;
  assetLog(): AssetEvent[];
  diagnostics(): Record<string, unknown>;
  setOverlay(enabled: boolean): void;
}
```

| Member | Result |
| --- | --- |
| `version` | `HOST_VERSION` at the time the page was built. |
| `setClock` | Hands the frame clock to the driver (`"manual"`) or back to the wall clock (`"auto"`). |
| `setSchedule` | Installs the delta pattern the manual clock steps on, restarting it at the pattern's first step. |
| `advance` | Runs exactly `steps` frames off the current schedule, synchronously. |
| `frame` | The frame counter, the accumulated simulated time, and the delta the most recent frame was stepped by. |
| `actions` | Every action the build registered, in registration order, with its resolved bindings, kind, and layout. |
| `setAction` | Drives the action's magnitude directly, on the same path a bound key takes, so crossing from rest into motion also arms the action's edge. |
| `pressAction` | Arms the action's edge without touching its held value. |
| `layout` | The selected touch layout and its action vocabulary, or `null` when none was selected. |
| `audioLog` | Every cue the build has played, oldest first, as a copy. |
| `audioState` | Whether the bus is muted, and whether a user gesture has unlocked it. |
| `assetLog` | Every asset the build has requested, oldest first, as a copy, with the URL each resolved to and whether it arrived. |
| `diagnostics` | The build's registered diagnostic sources, evaluated at the moment of the call, independent of whether the overlay is visible. |
| `setOverlay` | Shows or hides the debug overlay without touching the toggle key. |

Every returned value is plain data that survives structured cloning across the
browser boundary. `diagnostics` reduces each source's value through a JSON round
trip: a plain value crosses unchanged, one that cannot be encoded degrades to
its string form, and one with no JSON representation reads as `null`. A source
that throws yields its error message as its value.

## Validation

Arguments arrive as untyped JSON, so each operation validates its own before
passing it on. Every rejection throws an `Error` naming the offending value.

| Operation | Rejects |
| --- | --- |
| `setClock` | Any mode other than `"auto"` or `"manual"`. |
| `setSchedule` | A non-positive `stepMs`; a non-positive step anywhere in `stepsMs`; non-positive jitter bounds; `maxMs` below `minMs`; a non-finite `seed`; an unrecognized `kind`. An empty `stepsMs` is refused as it is installed, with a `RangeError`. |
| `advance` | A call made under the auto clock, and a step count that is not a whole, non-negative number, with a `RangeError`. |
| `setAction` | A value that is not a finite number. |
| `setOverlay` | Nothing; the argument is coerced to a boolean. |

`setAction` and `pressAction` on an unregistered name do nothing.

## Ports

`installHost` draws on the narrow slice of each subsystem it actually calls,
declared structurally rather than as the concrete classes. Everything a driver
can reach is one of the methods below.

```ts
interface FramePort {
  setClock(mode: ClockMode): void;
  setSchedule(schedule: Schedule): void;
  advance(steps: number): void;
  info(): FrameInfo;
}

interface InputPort {
  actions(): RegisteredAction[];
  setAction(name: string, value: number): void;
  pressAction(name: string): void;
  layout(): TouchLayout | null;
}

interface AudioPort {
  log(): CueEvent[];
  state(): AudioState;
}

interface AssetPort {
  log(): AssetEvent[];
}

interface DiagnosticsPort {
  read(): Record<string, unknown>;
  setEnabled(enabled: boolean): void;
}

interface HostPorts {
  /** The object the handle is written to; the game's `window` in a browser. */
  target: Record<string, unknown>;
  frame: FramePort;
  input: InputPort;
  audio: AudioPort;
  assets: AssetPort;
  diagnostics: DiagnosticsPort;
}
```

## `installHost`

```ts
function installHost(ports: HostPorts): () => void;
```

Builds the `EngineHost` over `ports`, writes it to `ports.target[HOST_HANDLE]`,
and returns the function that removes it again.

Installing over an existing handle replaces it. The returned uninstaller deletes
the handle only while the installed host is still the one it published, so
destroying a superseded engine leaves its replacement in place.
