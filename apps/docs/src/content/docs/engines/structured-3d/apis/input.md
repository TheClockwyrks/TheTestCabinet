---
title: Input
---

A game registers its actions once, from
[`InitApi.input`](/engines/structured-3d/apis/game-instance/), and reads them
through a player controller. The engine owns the keyboard and the pointer: each
action resolves to a single number, and the pointer resolves to a position in
the engine's logical coordinates, so the game asks what the player is doing
rather than reading events.

## Types

```ts
type ActionKind = "digital" | "analog";

interface ActionBinding {
  keys: string[];
  kind?: ActionKind;
}

interface RegisteredAction {
  name: string;
  keys: string[];
  kind: ActionKind;
  layout: string | null;
}

interface TouchLayout {
  name: string;
  actions: string[];
}
```

| Field | Meaning |
| --- | --- |
| `ActionBinding.keys` | The `KeyboardEvent.code` values that drive the action. |
| `ActionBinding.kind` | How a magnitude reaching the action is reported. Defaults to `"digital"`. |
| `RegisteredAction.name` | The name the action was registered under. |
| `RegisteredAction.keys` | The bound codes, as a copy. |
| `RegisteredAction.kind` | The resolved kind, always present. |
| `RegisteredAction.layout` | The touch layout the action belongs to, or `null` when the selected layout's vocabulary omits the name. |
| `TouchLayout.actions` | The layout's own vocabulary followed by the four menu actions. |

A `RegisteredAction` is the resolved form of a registration: the binding with
its defaults filled in and its layout provenance attached.

## Registration

```ts
readonly input: {
  register(name: string, binding: ActionBinding): void;
  layout(): TouchLayout | null;
};
```

| Member | Semantics |
| --- | --- |
| `register(name, binding)` | Registers or re-registers `name`. `binding.keys` is copied, `binding.kind` defaults to `"digital"`, and `layout` resolves to the selected layout's name when that layout's vocabulary contains `name` and to `null` otherwise. Re-registering replaces the binding wholesale, returns the action to rest, and keeps its position in the registration order. Any name is accepted. |
| `layout()` | The layout selected by `EngineOptions.layout`, or `null` when the engine was built without one. |

The layout is chosen at construction through
[`EngineOptions.layout`](/engines/structured-3d/apis/engine/) and holds for the
engine's lifetime, so every registration is attributed against the same
vocabulary.

Registration belongs to the game instance's `initialize`, which runs before the
start level opens, so the vocabulary is complete before the first frame reads
it. The bindings live on the engine and survive every level transition.

## Reading

```ts
class PlayerController extends Controller {
  readonly index: number;
  readonly input: InputReader;
}

interface InputReader {
  value(name: string): number;
  pressed(name: string): boolean;
  pointer(): PointerSnapshot;
  pointerPressed(): boolean;
  pointerReleased(): boolean;
  pointerSamples(): PointerSample[];
}
```

[`PlayerController.input`](/engines/structured-3d/apis/controllers/) is the one
place a game reads an action. A controller reads its actions on its own tick and
writes the result onto the pawn it possesses, and every controller ticks before
any actor, so a pawn's own tick observes the input its controller already
applied. [Possession](/engines/structured-3d/concepts/possession/) covers the
relationship in full.

| Member | Result | Semantics |
| --- | --- | --- |
| `value(name)` | `number` | The action's resolved magnitude. A `"digital"` action reports `0` or `1`, with every non-zero magnitude quantized to `1`. An `"analog"` action reports the magnitude as given, and a held key gives it full deflection. An unregistered name reports `0`. |
| `pressed(name)` | `boolean` | `true` exactly once per armed edge per player controller, and the call consumes that controller's copy. An unregistered name reports `false`. |

An edge is armed whenever a change takes the resolved value from `0` to
non-zero, whatever the source. A key event whose `repeat` flag is set arms
nothing.

Each player controller consumes edges independently. An edge armed on an action
is `pressed` exactly once for each controller that asks, so two controllers
bound to one action each see the press, and within one controller the first read
consumes it.

The engine closes the input frame after the frame renders, discarding every edge
left unconsumed. A press is therefore news for exactly one frame. A paused world
still renders and still closes its input frame.

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

The engine tracks one logical pointer in the logical design coordinates handed
to `createEngine`: each event's client position is taken relative to the
surface's origin, multiplied by the device pixel ratio, and passed through the
inverse [viewport map](/engines/structured-3d/apis/camera/). The pointer is 2D
and logical; mapping it into the scene is
[`camera.ray(point)`](/engines/structured-3d/apis/camera/), the picking ray
through the logical point, typically composed with
[`world.collision.raycast`](/engines/structured-3d/apis/collision/). A point
inside a letterbox bar maps outside `0..width` or `0..height`, still yields a
ray, and treating it as a miss is the game's choice.

| Member | Result | Semantics |
| --- | --- | --- |
| `pointer()` | `PointerSnapshot` | The most recent position and whether the pointer is held, as a fresh copy. Before the first pointer event the position is `(0, 0)` and `down` is `false`. |
| `pointerPressed()` | `boolean` | `true` exactly once per press edge per player controller, and the call consumes that controller's copy. |
| `pointerReleased()` | `boolean` | `true` exactly once per release edge per player controller, and the call consumes that controller's copy. |
| `pointerSamples()` | `PointerSample[]` | Every sample delivered since the input frame last closed, in arrival order, as a fresh copy. Reading does not consume the list. |

The samples are what a game that resolves each position on its own reads: a
sweep that crossed several targets between two frames arrives as the ordered
positions it visited rather than as the last one alone. `pointerSamples()` lists
at most 1024 samples per frame; a burst past that bound still moves the snapshot
and the edges, and the samples past it are not listed.

The engine closes the pointer's frame with the actions': when the input frame
closes, the sample list empties and unconsumed edges are discarded.

## Pointer events

The engine attaches its `pointerdown`, `pointermove`, `pointerup`, and
`pointercancel` listeners to the same event target its key listeners go on. Each
listener reads `clientX`, `clientY`, and `isPrimary`, and leaves the event
otherwise untouched. A non-primary pointer — the second touch of a multi-touch
gesture — is ignored.

The client position is mapped to the stage against the origin
[`SurfaceMetrics.origin`](/engines/structured-3d/apis/engine/) reports.
Dispatching a pointer-shaped event at the target drives the pointer exactly as
a player's does; over a surface with no `origin`, the origin is `(0, 0)` and a
dispatched event's client position is read as CSS pixels from the canvas's
top-left corner.

A `pointerdown` while the pointer is already held, or a `pointerup` while it is
not, moves the pointer without arming an edge, so the listed samples alternate
`down` and `up` strictly. A `pointercancel` ends a hold as a release at the last
known position. While the viewport is degenerate (a `scale` of `0`), a `down`
or `move` has no place on the stage and is dropped; a release still ends the
hold at the last known position.

## Key events

The engine attaches its `keydown` and `keyup` listeners to the event target
[`EngineOptions.surface`](/engines/structured-3d/apis/engine/) supplies, and to
the canvas's owning document when the engine was built without a surface. Each
listener reads `KeyboardEvent.code` and `KeyboardEvent.repeat` and leaves the
event otherwise untouched.

Dispatching a `KeyboardEvent`-shaped event at that target drives an action
exactly as a player's key does. That is the seam a test uses to hold a key, tap
it, and release it, over a surface with no document behind it.

## The touch-layout catalogue

```ts
const TOUCH_LAYOUTS: Readonly<Record<string, TouchLayout>>;
```

`TOUCH_LAYOUTS` is exported from the package root as a read-only record. The
menu actions are `["confirm", "back", "pause", "mute"]`, appended to every
entry's own vocabulary in that order.

| Layout | Controls | Own vocabulary |
| --- | --- | --- |
| `stick-move` | One virtual stick | `move-forward`, `move-back`, `move-left`, `move-right` |
| `stick-look` | A move stick and a look pad, one per side | `move-forward`, `move-back`, `move-left`, `move-right`, `look-up`, `look-down`, `look-left`, `look-right` |
| `stick-look-two-buttons` | The stick, the look pad, and two action buttons | the `stick-look` vocabulary plus `a`, `b` |
| `wheel-pedals` | A steering wheel and two pedals | `steer-left`, `steer-right`, `throttle`, `brake` |

Each entry's `actions` is the vocabulary above followed by the four menu
actions, so `TOUCH_LAYOUTS["stick-move"].actions` is `["move-forward",
"move-back", "move-left", "move-right", "confirm", "back", "pause", "mute"]`.

A stick's deflection on an axis drives the two opposed actions of that axis as
magnitudes; the look pad and the wheel do the same. The layout is a vocabulary
contract rather than a widget: it draws nothing and registers nothing, and the
game registers each action with its own binding and kind. Stick and pad actions
are the ones a game typically registers `"analog"`, and a held key still gives
an analog action full deflection.

## Errors

| Condition | Result |
| --- | --- |
| `EngineOptions.layout` names a layout outside `TOUCH_LAYOUTS` | `createEngine` throws, naming every valid layout |

## Exports

`ActionKind`, `ActionBinding`, `RegisteredAction`, `TouchLayout`,
`InputReader`, `PointerSampleType`, `PointerSample`, and `PointerSnapshot` are
exported as types from `@test-cabinet/structured-3d`, and `TOUCH_LAYOUTS` is
exported as a value.
