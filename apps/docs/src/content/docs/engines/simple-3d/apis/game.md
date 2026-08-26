---
title: Game
---

A game is three functions and two types: its state, and the debug surface
returned beside it. The game is bound to the engine when the engine is created;
`initialize` runs once when the engine is initialized, and `update` and `render`
run once each per frame after that. Each function receives only the part of the
engine it is allowed to use.

## `Game`

```ts
import type { DeepReadonly } from "ts-essentials";

interface Game<S, D = unknown> {
  initialize(api: InitApi<S>): [S, D] | Promise<[S, D]>;
  update(state: DeepReadonly<S>, api: UpdateApi, dt: number): S;
  render(state: DeepReadonly<S>, api: RenderApi): void;
}
```

| Member | Called | Receives | Returns |
| --- | --- | --- | --- |
| `initialize` | Once, from [`engine.initialize`](/engines/simple-3d/apis/engine/) | `InitApi<S>` | `[state, debug]`, or a promise of it |
| `update` | Once per frame, first | The current state as `DeepReadonly<S>`, `UpdateApi`, and the frame's delta in seconds | The next state |
| `render` | Once per frame, after `update` | The state `update` returned, as `DeepReadonly<S>`, and `RenderApi` | Nothing |

`S` is the game's own state, the first element of the pair `initialize` returns.
The engine holds it by value: each frame is a transition over it, where `update`
is handed the current state as a read-only view and returns the next state, and
`render` is handed that next state as the same view. The value `update` returns
is what `render` draws, what [`engine.state`](/engines/simple-3d/apis/engine/)
reads, and what the next `update` receives.

`DeepReadonly<S>` is the `ts-essentials` type of that name, re-exported from
`@test-cabinet/simple-3d`. Every reader of the state is handed it, so `render`
cannot change the state and nothing but a transition advances it, and the
compiler is what says so. A game writes `update` as a pure function that builds
the next state from the current one, with spreads over the parts that changed:

```ts
update(state, api, dt) {
  return { ...state, ball: { ...state.ball, x: state.ball.x + state.ball.vx * dt } };
}
```

`update` returns the next state on every path. A return of `undefined` is
refused with an error naming `must return the next state`, and the engine keeps
the state it had.

`D` is the game's [debug surface](#the-debug-surface), the second element of
that pair and the value the engine returns unchanged from
[`engine.debug`](/engines/simple-3d/apis/engine/). A game with no surface
writes `Game<State, null>` and returns `[state, null]`.

## `Transition`

```ts
type Transition<S> = (state: DeepReadonly<S>) => S;
```

A change to the state made from outside a frame: the shape `update` has, minus
the frame. It is what a caller hands
[`engine.apply`](/engines/simple-3d/apis/engine/) to pose the game between
frames, and what a debug surface's poses are written as. A transition that
returns `undefined` is refused the same way an `update` is.

`initialize` may return a promise of the pair, and the engine awaits it before
running any frame. A return that is anything but a two-element array rejects
`initialize` with an error naming the pair. A game that loads assets resolves
them here and stores them in `S`, so every field of the state is present by the
time a frame can observe it and the state type declares each of them as such.

A game that ends itself creates an `AbortController` in `initialize`, keeps it
in `S`, and aborts it from `update`. Ending the game is then the game's own
state rather than an engine operation.

`dt` is seconds. Every quantity a game writes down is per second, and seconds
are what the game multiplies by.

## `InitApi`

```ts
interface InitApi<S = unknown> {
  readonly input: {
    register(name: string, binding: ActionBinding): void;
    layout(): TouchLayout | null;
  };
  readonly audio: {
    define(cue: string, spec: CueSpec): void;
    load(cue: string, path: string): Promise<void>;
  };
  readonly assets: {
    loadMesh(path: string): Promise<MeshHandle>;
    loadTexture(path: string): Promise<TextureHandle>;
    loadMaterial(path: string): Promise<MaterialHandle>;
    loadAudio(path: string): Promise<AudioBuffer>;
    load(path: string): Promise<Blob>;
    resolve(path: string): string;
  };
  readonly diagnostics: {
    register(name: string, source: (state: DeepReadonly<S>) => unknown): void;
  };
  readonly events: EngineEvents;
  viewport(): Viewport;
}
```

Everything a game declares once belongs here: its action bindings, its cue
definitions, the assets it needs, and the values it wants on the overlay.
The typed loaders, the handles they resolve to, and the asset root are
specified on the [assets page](/engines/simple-3d/apis/assets/).

`InitApi` is generic over the game's state so a
[diagnostic source](/engines/simple-3d/apis/diagnostics/) is typed against it.
A source is called with the state current at the read, because the state a
frame leaves behind is a new value rather than the object `initialize` built.

## The debug surface

The debug surface is the object a game returns beside its state from
`initialize`, and the engine returns that same value from
[`engine.debug`](/engines/simple-3d/apis/engine/). The engine holds it and
nothing more: the shape is the game's own, and the engine reads no member of
it.

Because the surface arrives with the state, it is in place before any frame
runs, a caller holding the engine finds it as soon as `initialize` resolves,
and every caller that reads `engine.debug` holds the same object.

The surface holds no state of its own, because nothing holds a writable state.
Its operations are written in the shape of `update`: a pose is a
[`Transition<S>`](#transition) that takes the current state and returns the
next, and a reading takes the current state and returns what it read. A caller
drives a pose through `engine.apply` and a reading against `engine.state`.

```ts
interface RefractDebug {
  readonly version: number;
  serve(state: DeepReadonly<State>): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

engine.apply((state) => engine.debug.serve(state));
const snapshot = engine.debug.snapshot(engine.state);
```

## `UpdateApi`

```ts
interface UpdateApi {
  readonly input: {
    value(name: string): number;
    pressed(name: string): boolean;
  };
  readonly audio: {
    play(cue: string): void;
    loop(cue: string): void;
    stop(cue: string): void;
    looping(cue: string): boolean;
    setMuted(muted: boolean): void;
    muted(): boolean;
  };
  frame(): FrameInfo;
  viewport(): Viewport;
}
```

`update` reads input, plays cues, and advances the simulation. Nothing here
draws, so a simulation can be stepped and inspected with no drawing surface
involved in the result.

## `RenderApi`

```ts
interface RenderApi {
  readonly scene: SceneContext;
  frame(): FrameInfo;
  viewport(): Viewport;
}
```

`scene` is the engine-owned 3D drawing surface, cleared before every frame.
Nothing here reads input or plays a cue, so a frame's audible and observable
behavior is decided entirely by `update`.

A validator that wants the drawing operations rather than the pixels arms the
[recorder](/engines/simple-3d/apis/recording/) and asserts over the operations
the build issued.

## `SceneContext`

```ts
interface SceneContext {
  setCamera(camera: CameraState): void;
  setLights(lights: readonly LightState[]): void;
  setMode(mode: RenderMode): void;

  clearDepth(): void;

  drawMesh(mesh: MeshHandle, transform: Transform, options?: DrawMeshOptions): void;
  drawGeometry(geometry: Geometry, material: MaterialLike, transform: Transform): void;
  drawBillboard(texture: TextureHandle, position: Vec3, size: Vec2): void;
  drawLine(points: readonly Vec3[], color: Color): void;
  drawHudText(text: string, position: Vec2, options?: HudTextOptions): void;
  drawHudRect(position: Vec2, size: Vec2, color: Color): void;

  createBox(size: Vec3): Geometry;
  createSphere(radius: number): Geometry;
  createCylinder(radius: number, height: number): Geometry;
  createCapsule(radius: number, height: number): Geometry;
  createPlane(width: number, depth: number): Geometry;
  createMaterial(spec: MaterialSpec): Material;
}
```

The whole drawing vocabulary: three state setters, a depth clear, six draw
calls, and six producers. Every draw call is self-contained, naming its full
world transform or position explicitly, and no method reads anything back.

| Member | Intent |
| --- | --- |
| `setCamera` | Sets the frustum camera the scene is projected through. Retained: holds until set again. The argument is copied. |
| `setLights` | Replaces the light list wholesale. Retained. The array and its entries are copied. The renderer uses the first 64 entries. |
| `setMode` | Sets the render mode: `"standard"` is the lit default, beside `"wireframe"`, `"unlit"`, and `"normals"`. Retained. The mode governs mesh and geometry draws; billboards, lines, and HUD draws render the same under every mode. |
| `clearDepth` | Clears the depth buffer where it stands in the issue order, so draws issued after it sit over everything drawn before it however near the earlier geometry is. Not retained: every frame still opens with its own depth reset. |
| `drawMesh` | Draws a loaded glTF mesh under a world transform, with its file's own materials unless overridden. |
| `drawGeometry` | Draws a procedural geometry under a world transform with the given material. |
| `drawBillboard` | Draws a camera-facing, unlit, alpha-blended quad of `size` world units centered at `position`. |
| `drawLine` | Draws a connected world-space polyline, one device pixel wide. Fewer than two points draws nothing. |
| `drawHudText` | Draws text in logical design coordinates, composited above the 3D picture. |
| `drawHudRect` | Fills an axis-aligned rectangle in logical design coordinates, composited above the 3D picture. |
| `createBox` | A box geometry of `size` world units, centered at the local origin. |
| `createSphere` | A sphere of `radius`, centered at the local origin, tessellated at 32×16 segments. |
| `createCylinder` | A capped cylinder of `radius` and `height` on the local Y axis, centered, 32 radial segments. |
| `createCapsule` | A capsule of `radius` on the local Y axis, centered; `height` is the distance between the centers of its two hemispherical caps, so the extent along the axis is `height + 2 * radius`. 32 radial segments, each cap 8 rings. |
| `createPlane` | A `width`×`depth` plane on the local XZ plane, +Y normal, centered. |
| `createMaterial` | A material built in code from a `MaterialSpec`. |

### Retained state

The three `set*` calls are the whole renderer state: the
[camera](/engines/simple-3d/apis/viewport/), the lights, and the render mode. A
fresh engine holds the default `CameraState`, an empty light list, and
`"standard"`. A state call takes effect for every draw issued after it, within
the frame and across frames, and each frame of a
[recording](/engines/simple-3d/apis/recording/) carries the renderer state it
inherited.

With an empty light list the standard mode lights nothing: meshes render black
except emissive terms and unlit materials, so a game sets its lights before its
first draw.

There is no transform stack and no readback: each draw names its full world
transform, the scene context has no `save`/`restore` and no getters, and a game
keeps its camera in its own state and re-applies it with `setCamera`.

### Draw order

Opaque draws resolve by the depth buffer, so their issue order does not affect
the picture. The state setters and `clearDepth` divide a frame's draws into
runs, and translucent draws — a material whose `opacity` is below 1, every
billboard, every line over a translucent color — render after their own run's
opaque draws, sorted farthest-first by the distance from the run's camera to
the draw's position. A frame that sets its state once and clears no depth
mid-frame is a single run, so the common case reads as it always has:
translucent after every opaque draw. HUD draws composite last, above the 3D
picture, in issue order across the whole frame.

### Animation posing

`drawMesh` with a `clip` poses the mesh at `clipTime` seconds, sampled looping:
the time is taken modulo the clip's duration, so an accumulated game-time value
plays the loop. Omitting `clip` draws the file's rest pose. The pose is a pure
function of the arguments, which is what keeps a recorded frame drawable from
itself alone.

### Producers

The six `create*` methods are exactly the scene context's producing methods,
carried in a recording as [resources](/engines/simple-3d/apis/recording/). A
produced value is immutable: its recipe is the producing call with no further
steps, and its identity is the call that made it. Creation is cheap and
deterministic. Producers live on the scene context, which `initialize` does not
receive, so the idiomatic build creates its geometries and materials on its
first `render` and keeps them in module scope, or creates them per frame — two
uses with the same arguments share one resource entry, so per-frame creation
costs nothing in the recording.

### Non-finite numbers

A draw call carrying a non-finite number in a transform, position, size, or
point draws nothing for that call, exactly as a 2D canvas skips a non-finite
draw. The call is still recorded.

### Outside `render`

The scene context is live only while `render` runs. A call from `update`, a
stored closure, or after `destroy` throws, naming the rule.

## `DrawMeshOptions`

```ts
interface DrawMeshOptions {
  material?: MaterialLike;
  clip?: string;
  clipTime?: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `material` | The mesh's own materials | Overrides every material the file carries. |
| `clip` | — (rest pose) | The animation clip to pose from, one of `mesh.clips`. |
| `clipTime` | `0` | The clip time to sample, in seconds, looping over the clip's duration. |

## `MaterialLike`

```ts
type MaterialLike = MaterialHandle | Material | Color;
```

A [`MaterialHandle`](/engines/simple-3d/apis/assets/) is a loaded material
document; a `Material` is one built in code. A `Color` is shorthand for a
standard lit material with that base color and the `MaterialSpec` defaults.

## `MaterialSpec` and `Material`

```ts
interface MaterialSpec {
  baseColor?: Color;
  baseColorMap?: TextureHandle;
  normalMap?: TextureHandle;
  roughness?: number;
  metallic?: number;
  emissive?: Color;
  opacity?: number;
  unlit?: boolean;
}

interface Material {
  readonly spec: Readonly<MaterialSpec>;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `baseColor` | `"#ffffff"` | The base color, multiplied with `baseColorMap` where one is given. |
| `baseColorMap` | — | The base color texture. |
| `normalMap` | — | The tangent-space normal texture. |
| `roughness` | `0.8` | Surface roughness, `0`–`1`. |
| `metallic` | `0` | Metalness, `0`–`1`. |
| `emissive` | `"#000000"` | The emissive color, unaffected by lights. |
| `opacity` | `1` | `0`–`1`; below `1` the material is translucent and its draws blend. |
| `unlit` | `false` | `true` renders the base color and map without lighting. |

`Material.spec` is the spec with defaults filled in, as a frozen copy; a
`Material` is immutable and `createMaterial` copies its argument.

## `HudTextOptions`

```ts
interface HudTextOptions {
  size?: number;
  color?: Color;
  align?: "left" | "center" | "right";
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `size` | `24` | The em size in logical units. |
| `color` | `"#ffffff"` | The fill color. |
| `align` | `"left"` | Which horizontal anchor `position` names. |

`position` is the top-left of the text's em box under `"left"`, the top-center
under `"center"`, the top-right under `"right"`. The face is the engine's own
monospace face; there is no font option, so the same call letters the same in
every build and in the player. The face is Unscii 16, a public-domain 8×16
bitmap face carried in the package as glyph data rather than as a font file,
covering printable ASCII; a character outside the coverage letters as the
replacement box. `size` is the height of the 16-pixel glyph cell in logical
units, and each glyph advances half of `size`, so the engine's lettering is a
pure function of the call and the player letters it from its own copy of the
same data.

## `Geometry`

```ts
interface Geometry {
  readonly bounds: Box3;
}
```

An engine-owned, immutable procedural geometry. `bounds` is its axis-aligned
bounds in local units, which games use for their own collision arithmetic.

## `EngineEvents`

```ts
interface EngineEvents {
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

interface EngineEventMap {
  "asset:loaded": { path: string; url: string };
  "asset:failed": { path: string; url: string; reason: string };
  "cue:played": { cue: string; t: number; gain: number };
  "cue:looped": { cue: string; t: number; gain: number };
  "cue:stopped": { cue: string; t: number };
  "audio:unlocked": Record<string, never>;
}
```

`on` returns the function that removes the handler. A handler that throws is
contained: the error reaches the console and the remaining handlers still run.

Subscription is what a caller uses to observe the engine as it works, in place
of accumulating a record and reading it afterwards. Handlers are called
synchronously at the moment the event happens, so a subscriber sees the frame
the event belongs to.

## `FrameInfo`

```ts
interface FrameInfo {
  count: number;
  timeMs: number;
  lastDeltaMs: number;
}
```

| Field | Meaning |
| --- | --- |
| `count` | Frames run since the loop started. |
| `timeMs` | Accumulated simulated time in milliseconds: the sum of the deltas delivered. |
| `lastDeltaMs` | The delta the most recent frame was stepped by, in milliseconds. |

`timeMs` and `lastDeltaMs` are milliseconds; the `dt` passed to `update` is
seconds.

## Errors

| Condition | Result |
| --- | --- |
| `initialize` throws or rejects | `engine.initialize` rejects with the cause, and no frame runs |
| `update` or `render` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| `update` or `render` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
| `update` returns `undefined` under `run` | An `Error` naming `must return the next state` propagates to the host, the loop schedules the next frame, and the engine keeps the state it had |
| `update` returns `undefined` under `advance` | `advance` rejects with that `Error`, the remaining frames do not run, and the engine keeps the state it had |

A throw under `run` leaves the loop alive so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.

An `update` that returns nothing is refused rather than held, because a game
that mutated the view it was handed and returned nothing has advanced nothing
the engine will read again, and holding `undefined` would turn that one mistake
into a crash on an unrelated line of the next frame.

The scene context refuses its own misuse where it happens:

| Condition | Result |
| --- | --- |
| A scene context method called outside `render` | `Error` naming the rule |
| `drawMesh` with a `clip` not in `mesh.clips` | `Error` naming the clip and listing `mesh.clips` |
| `setMode` with a value outside `RenderMode` | `Error` naming every valid mode |
| `createBox`, `createSphere`, `createCylinder`, `createCapsule`, or `createPlane` with a dimension that is not finite and positive | `RangeError` naming the value |
| `createMaterial` with `roughness`, `metallic`, or `opacity` outside `0`–`1` or not finite | `RangeError` naming the field and value |

## Exports

`Game`, `Transition`, `DeepReadonly`, `InitApi`, `UpdateApi`, `RenderApi`,
`SceneContext`, `DrawMeshOptions`, `MaterialLike`, `MaterialSpec`, `Material`,
`Geometry`, `HudTextOptions`, `EngineEvents`, `EngineEventMap`, and `FrameInfo`
are exported as types from `@test-cabinet/simple-3d`. `DeepReadonly` is the
`ts-essentials` type, re-exported so a game names the view of its own state
without a second import; game code may equally import it from `ts-essentials`
directly.
