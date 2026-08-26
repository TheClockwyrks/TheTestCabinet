# Input

A game declares its actions once, from `InitApi.input` inside `initialize`, and
reads them every frame from `UpdateApi.input` inside `update`. The engine owns
the keyboard and the pointer: each action resolves to a single number, and the
pointer resolves to a position in the game's own logical coordinates, so the
game asks what the player is doing rather than reading events.

```ts
// In initialize:
api.input.register(name: string, binding: ActionBinding): void;
api.input.layout(): TouchLayout | null;

// In update:
api.input.value(name: string): number;
api.input.pressed(name: string): boolean;
api.input.pointer(): PointerSnapshot;
api.input.pointerPressed(): boolean;
api.input.pointerReleased(): boolean;
api.input.pointerSamples(): PointerSample[];
```

## Registering actions

```ts
type ActionKind = "digital" | "analog";

interface ActionBinding {
  keys: string[];
  kind?: ActionKind;
}
```

`keys` are `KeyboardEvent.code` values rather than `key` values, so a binding is
layout-independent: `KeyW` is the same physical key on QWERTY and AZERTY.

```ts
initialize(api) {
  api.input.register("move-forward", { keys: ["KeyW"], kind: "analog" });
  api.input.register("move-back", { keys: ["KeyS"], kind: "analog" });
  api.input.register("jump", { keys: ["Space"] });
  return [{ /* ... */ }, null];
}
```

`kind` defaults to `"digital"`. Re-registering a name replaces its binding
wholesale, returns the action to rest, and keeps its position in the
registration order. Any name is accepted.

Declare an action analog where the game is written to use a partial magnitude:
a stick's deflection on an axis drives the two opposed actions of that axis as
magnitudes, and a held key still gives an analog action full deflection, so the
same code serves keyboard and touch.

## Reading actions

| Member | Result | Semantics |
| --- | --- | --- |
| `value(name)` | `number` | The action's resolved magnitude. A `"digital"` action reports `0` or `1`, with every non-zero magnitude quantized to `1`. An `"analog"` action reports the magnitude as given, and a held key gives it full deflection. An unregistered name reports `0`. |
| `pressed(name)` | `boolean` | `true` exactly once per armed edge, which the call consumes. An unregistered name reports `false`. |

`value` is for things that happen while a key is held, and `pressed` is for
things that happen once per press. Take a signed axis as the difference between
the two directions, so pressing both cancels out:

```ts
update(state, api, dt) {
  const ahead = api.input.value("move-forward") - api.input.value("move-back");
  const side = api.input.value("move-right") - api.input.value("move-left");
  const step = vec3Add(
    vec3Scale(state.forward, ahead),
    vec3Scale(state.right, side),
  );

  const jumped = api.input.pressed("jump") && state.grounded;

  return {
    ...state,
    position: vec3Add(state.position, vec3Scale(step, SPEED * dt)),
    vy: jumped ? JUMP : state.vy - GRAVITY * dt,
  };
}
```

An edge is armed whenever a change takes the resolved value from `0` to
non-zero, whatever the source. Pressing a second key bound to an already-held
action is not a new press, and a key event whose `repeat` flag is set arms
nothing.

The engine closes the input frame after the game has rendered, discarding every
edge left unconsumed. A press is therefore news for exactly one frame, so read
each edge in the `update` that follows it, and read a given action's edge in one
place per frame: the first read consumes it, so a menu layer and a gameplay
layer both polling `confirm` split a single press between them.

## Key events

The engine attaches its `keydown` and `keyup` listeners to the event target the
`surface` option supplies, and to the canvas's owning document when the engine
was built without a surface. Each listener reads `KeyboardEvent.code` and
`KeyboardEvent.repeat` and leaves the event otherwise untouched.

Dispatching a `KeyboardEvent`-shaped event at that target drives an action
exactly as a player's key does. That is the seam a check uses to hold a key, tap
it, and release it, over a surface with no document behind it.

## The pointer

```ts
type PointerSampleType = "down" | "move" | "up";

interface PointerSample {
  readonly type: PointerSampleType;
  readonly x: number;
  readonly y: number;
}

interface PointerSnapshot {
  x: number;
  y: number;
  down: boolean;
}
```

The engine tracks one logical pointer in the game's logical coordinates: each
event's client position is taken relative to the surface's origin, multiplied by
the device pixel ratio, and passed through the inverse viewport map, so the
position `update` reads is on the same axes the HUD draws on. A point inside a
letterbox bar maps outside `0..width` or `0..height`, and a game clamps it or
treats it as a miss.

| Member | Result | Semantics |
| --- | --- | --- |
| `pointer()` | `PointerSnapshot` | The most recent position and whether the pointer is held, as a fresh copy. Before the first pointer event the position is `(0, 0)` and `down` is `false`. |
| `pointerPressed()` | `boolean` | `true` exactly once per press edge, which the call consumes. |
| `pointerReleased()` | `boolean` | `true` exactly once per release edge, which the call consumes. |
| `pointerSamples()` | `PointerSample[]` | Every sample delivered since the input frame last closed, in arrival order, as a fresh copy. Reading does not consume the list. |

The snapshot is what aiming and hovering read. The sample list is what direct
manipulation reads: a sweep that crossed several targets between two frames
arrives as the ordered positions it visited rather than as the last one alone,
so a game that reacts to the path the pointer traveled resolves each sample on
its own.

```ts
update(state, api, dt) {
  let next = state;
  for (const sample of api.input.pointerSamples()) {
    next = resolvePointer(next, sample);
  }
  return step(next, dt);
}
```

`pointerSamples()` lists at most 1024 samples per frame; a burst past that bound
still moves the snapshot and the edges, and the samples past it are not listed.
The input frame closes after the game has rendered: the sample list empties and
unconsumed edges are discarded.

The pointer stays 2D. Carrying a position into the world is the game's own
arithmetic, and `pointerRay` is the convention — it turns the camera and a
logical point into a world-space ray, which the game intersects with a ground
plane, a sphere, or a `Box3` over `mesh.bounds`. See `viewport.md`.

## Pointer events

The engine attaches its `pointerdown`, `pointermove`, `pointerup`, and
`pointercancel` listeners to the same event target its key listeners go on.
Each listener reads `clientX`, `clientY`, and `isPrimary`, and leaves the event
otherwise untouched. A non-primary pointer — the second touch of a multi-touch
gesture — is ignored.

Dispatching a pointer-shaped event at that target drives the pointer exactly as
a player's does. Over a surface with no `origin`, the origin is `(0, 0)` and a
dispatched event's client position is read as CSS pixels from the canvas's
top-left corner.

A `pointerdown` while the pointer is already held, or a `pointerup` while it is
not, moves the pointer without arming an edge, so the listed samples alternate
`down` and `up` strictly. A `pointercancel` ends a hold as a release at the last
known position. While the viewport is degenerate — a `scale` of `0` — a `down`
or `move` has no place on the stage and is dropped; a release still ends the
hold at the last known position.

## Touch layouts

A touch layout is the name of a control scheme and the action vocabulary it
brings with it. Selection is declarative: it tags the actions the game registers
rather than drawing controls or registering anything.

```ts
interface TouchLayout {
  name: string;
  actions: string[];
}

const TOUCH_LAYOUTS: Readonly<Record<string, TouchLayout>>;
```

The layout is chosen at construction, through `EngineOptions.layout`, and holds
for the engine's lifetime:

```ts
const engine = createEngine({ canvas, width: 640, height: 360, game, layout: "stick-look" });
```

| Layout | Controls | Own vocabulary |
| --- | --- | --- |
| `stick-move` | One virtual stick | `move-forward`, `move-back`, `move-left`, `move-right` |
| `stick-look` | A move stick and a look pad, one per side | the `stick-move` vocabulary plus `look-up`, `look-down`, `look-left`, `look-right` |
| `stick-look-two-buttons` | The stick, the look pad, and two action buttons | the `stick-look` vocabulary plus `a`, `b` |
| `wheel-pedals` | A steering wheel and two pedals | `steer-left`, `steer-right`, `throttle`, `brake` |

The menu actions `["confirm", "back", "pause", "mute"]` are appended to every
entry's own vocabulary in that order, so `TOUCH_LAYOUTS["stick-move"].actions`
is `["move-forward", "move-back", "move-left", "move-right", "confirm", "back",
"pause", "mute"]`.

A game built with a layout registers that layout's action names, so the scheme
and the bindings agree, and registers anything the design needs beyond that
vocabulary the same way:

```ts
initialize(api) {
  for (const name of api.input.layout()?.actions ?? []) {
    api.input.register(name, {
      keys: KEYS[name] ?? [],
      kind: ANALOG.has(name) ? "analog" : "digital",
    });
  }
  api.input.register("boost", { keys: ["ShiftLeft", "ShiftRight"] });
  return [{ /* ... */ }, null];
}
```

`api.input.layout()` returns a fresh copy the caller owns, or `null` when the
engine was built without one.

## `RegisteredAction`

```ts
interface RegisteredAction {
  name: string;
  keys: string[];
  kind: ActionKind;
  layout: string | null;
}
```

The resolved form of a registration: the binding with its defaults filled in and
its layout provenance attached. `layout` is the selected layout's name when that
layout's vocabulary contains the action name, and `null` otherwise.

## Errors

| Condition | Result |
| --- | --- |
| `EngineOptions.layout` names a layout outside `TOUCH_LAYOUTS` | `createEngine` throws, naming every valid layout |
| `register` with a `kind` outside `ActionKind` | `Error` naming the value |

## The overlay toggle key

The backtick key (`Backquote`) toggles the debug overlay. It is engine chrome
handled by a listener the engine owns rather than a registered action, so the
action registry stays exactly the vocabulary the build bound.
