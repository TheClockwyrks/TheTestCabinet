# Input

A game registers its actions once, from `InitApi.input` inside the game
instance's `initialize`, and reads them through a player controller. The engine
owns the keyboard and the pointer: each action resolves to a single number, and
the pointer resolves to a position in the engine's logical coordinates, so the
game asks what the player is doing rather than reading events.

```ts
// In the instance's initialize:
api.input.register(name: string, binding: ActionBinding): void;
api.input.layout(): TouchLayout | null;

// In a player controller's tick, through this.input:
input.value(name: string): number;
input.pressed(name: string): boolean;
input.pointer(): PointerSnapshot;
input.pointerPressed(): boolean;
input.pointerReleased(): boolean;
input.pointerSamples(): PointerSample[];
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
override initialize(api: InitApi): null {
  api.input.register("move-forward", { keys: ["KeyW", "ArrowUp"], kind: "analog" });
  api.input.register("move-back", { keys: ["KeyS", "ArrowDown"], kind: "analog" });
  api.input.register("confirm", { keys: ["Enter", "Space"] });
  return null;
}
```

`kind` defaults to `"digital"`. Re-registering a name replaces its binding
wholesale, returns the action to rest, and keeps its position in the
registration order. Any name is accepted.

Registration belongs to the instance's `initialize`, which runs before the start
level opens, so the vocabulary is complete before the first frame reads it. The
bindings live on the engine and survive every level transition.

## Reading actions

Reading happens only through `PlayerController.input`, in the controller's tick.
Controllers tick before any actor, so what a controller writes onto its pawn is
what the pawn's own tick applies this frame. See `controllers.md`.

| Member | Result | Semantics |
| --- | --- | --- |
| `value(name)` | `number` | The action's resolved magnitude. A `"digital"` action reports `0` or `1`, with every non-zero magnitude quantized to `1`. An `"analog"` action reports the magnitude as given, and a held key gives it full deflection. An unregistered name reports `0`. |
| `pressed(name)` | `boolean` | `true` exactly once per armed edge per player controller, and the call consumes that controller's copy. An unregistered name reports `false`. |

`value` is for things that happen while a key is held, and `pressed` is for
things that happen once per press:

```ts
override tick(): void {
  const pawn = this.pawn;
  if (!(pawn instanceof Rover)) return;

  // Held: applied every frame it is down.
  pawn.drive(
    this.input.value("move-forward") - this.input.value("move-back"),
    this.input.value("move-right") - this.input.value("move-left"),
  );

  // Edge: fires once per press, however long the key is held.
  if (this.input.pressed("confirm")) pawn.boost();
}
```

An edge is armed whenever a change takes the resolved value from `0` to
non-zero, whatever the source. Pressing a second key bound to an already-held
action is not a new press, and a key event whose `repeat` flag is set arms
nothing.

Each player controller consumes edges independently. An edge armed on an action
is `pressed` exactly once for each controller that asks, so two controllers
bound to one action each see the press, and within one controller the first read
consumes it — read each action's edge in one place per controller.

The engine closes the input frame after the frame renders, discarding every edge
left unconsumed. A press is therefore news for exactly one frame. A paused world
still renders and still closes its input frame.

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

The engine tracks one logical pointer in the logical design coordinates handed
to `createEngine`: each event's client position is taken relative to the
surface's origin, multiplied by the device pixel ratio, and passed through the
inverse viewport map.

**The pointer stays 2D and logical.** Mapping it into the scene is
`world.camera.ray(point)`, the picking ray through the logical point, typically
composed with `world.collision.raycast`; see `camera.md` and `collision.md`. A
point inside a letterbox bar maps outside `0..width` or `0..height`, still
yields a ray, and treating it as a miss is the game's choice.

| Member | Result | Semantics |
| --- | --- | --- |
| `pointer()` | `PointerSnapshot` | The most recent position and whether the pointer is held, as a fresh copy. Before the first pointer event the position is `(0, 0)` and `down` is `false`. |
| `pointerPressed()` | `boolean` | `true` exactly once per press edge per player controller, and the call consumes that controller's copy. |
| `pointerReleased()` | `boolean` | `true` exactly once per release edge per player controller, and the call consumes that controller's copy. |
| `pointerSamples()` | `PointerSample[]` | Every sample delivered since the input frame last closed, in arrival order, as a fresh copy. Reading does not consume the list. |

Position is one engine-global pointer, while press and release edges are
consumed per controller, exactly as an action's edges are. The snapshot is what
aiming and hovering read; the sample list is what direct manipulation reads,
since a sweep that crossed several targets between two frames arrives as the
ordered positions it visited rather than as the last one alone.

`pointerSamples()` lists at most 1024 samples per frame; a burst past that bound
still moves the snapshot and the edges, and the samples past it are not listed.
When the input frame closes, the sample list empties and unconsumed edges are
discarded.

## Pointer events

The engine attaches its `pointerdown`, `pointermove`, `pointerup`, and
`pointercancel` listeners to the same event target its key listeners go on. Each
listener reads `clientX`, `clientY`, and `isPrimary`, and leaves the event
otherwise untouched. A non-primary pointer — the second touch of a multi-touch
gesture — is ignored.

The client position is mapped to the field against the origin the surface's
`origin()` reports. Dispatching a pointer-shaped event at the target drives the
pointer exactly as a player's does; over a surface with no `origin`, the origin
is `(0, 0)` and a dispatched event's client position is read as CSS pixels from
the canvas's top-left corner.

A `pointerdown` while the pointer is already held, or a `pointerup` while it is
not, moves the pointer without arming an edge, so the listed samples alternate
`down` and `up` strictly. A `pointercancel` ends a hold as a release at the last
known position. While the viewport is degenerate (a `scale` of `0`), a `down` or
`move` has no place on the field and is dropped; a release still ends the hold
at the last known position.

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
const engine = createEngine({ canvas, width: 640, height: 360, game, layout: "stick-move" });
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

A stick's deflection on an axis drives the two opposed actions of that axis as
magnitudes; the look pad and the wheel do the same. The layout is a vocabulary
contract rather than a widget: it draws nothing and registers nothing, so stick
and pad actions are the ones a game registers `"analog"`, and a held key still
gives an analog action full deflection.

A game built with a layout registers that layout's action names, so the scheme
and the bindings agree. A key table indexed by action name registers the whole
vocabulary in one pass:

```ts
export class Rally extends GameInstance<null> {
  override initialize(api: InitApi): null {
    for (const action of api.input.layout()?.actions ?? []) {
      api.input.register(action, {
        keys: KEYS[action] ?? [],
        kind: ANALOG.has(action) ? "analog" : "digital",
      });
    }
    return null;
  }
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

## The overlay toggle key

The backtick key (`Backquote`) toggles the debug overlay. It is engine chrome
handled by a listener the engine owns rather than a registered action, so the
action registry stays exactly the vocabulary the build bound. Leave that key
free of bindings.

## Errors

| Condition | Result |
| --- | --- |
| `EngineOptions.layout` names a layout outside `TOUCH_LAYOUTS` | `createEngine` throws, naming every valid layout |
