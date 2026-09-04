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
  pointerPressed(button?: PointerButton): boolean;
  pointerReleased(button?: PointerButton): boolean;
  pointerSamples(): PointerSample[];
  pointerContacts(): PointerContact[];
  wheel(): WheelDelta;
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
type PointerDevice = "mouse" | "pen" | "touch";
type PointerButton = "primary" | "secondary" | "auxiliary" | "back" | "forward";
type PointerSampleType = "down" | "move" | "up";

interface PointerSample {
  readonly type: PointerSampleType;
  readonly x: number;
  readonly y: number;
  readonly id: number;
  readonly primary: boolean;
  readonly device: PointerDevice;
  readonly button: PointerButton | null;
  readonly buttons: readonly PointerButton[];
}

interface PointerSnapshot {
  x: number;
  y: number;
  down: boolean;
  device: PointerDevice;
  buttons: PointerButton[];
}

interface PointerContact {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly primary: boolean;
  readonly device: PointerDevice;
  readonly buttons: readonly PointerButton[];
}

interface WheelDelta {
  readonly x: number;
  readonly y: number;
}
```

| Field | Meaning |
| --- | --- |
| `id` | The pointer a sample or contact belongs to. A mouse keeps one id for the life of the page, and each touch gets its own. |
| `primary` | Whether this is the primary pointer, the one the snapshot and the edges follow. A mouse is always primary, and among touches the first one down is. |
| `device` | Which kind of device drove it. |
| `button` | The button whose state a sample reports, or `null` when the sample reports movement alone. |
| `buttons` | Every button held once the sample has been applied, in the order `PointerButton` lists them. A pen or a touch in contact holds `primary`. |
| `WheelDelta.x`, `.y` | Wheel travel over one input frame, in logical units, positive rightward and downward. |

The engine maps every pointer into the logical design coordinates handed to
`createEngine`: each event's client position is taken relative to the surface's
origin, multiplied by the device pixel ratio, and passed through the inverse
[viewport map](/engines/structured-3d/apis/camera/). A controller that needs to
know what the pointer is over turns the position into a world-space ray through
[`camera.logicalToRay`](/engines/structured-3d/apis/camera/) and casts it. A
point inside a letterbox bar maps outside `0..width` or `0..height`, and a game
clamps it or treats it as a miss.

| Member | Result | Semantics |
| --- | --- | --- |
| `pointer()` | `PointerSnapshot` | The primary pointer's most recent position, whether it is held, the device that last drove it, and the buttons it holds, as a fresh copy. Before the first pointer event the position is `(0, 0)`, `down` is `false`, `device` is `"mouse"`, and `buttons` is empty. |
| `pointerPressed(button?)` | `boolean` | `true` exactly once per press edge of `button` per player controller, and the call consumes that controller's copy. `button` defaults to `"primary"`. |
| `pointerReleased(button?)` | `boolean` | `true` exactly once per release edge of `button` per player controller, and the call consumes that controller's copy. `button` defaults to `"primary"`. |
| `pointerSamples()` | `PointerSample[]` | Every sample every pointer delivered since the input frame last closed, in arrival order, as a fresh copy. Reading does not consume the list. |
| `pointerContacts()` | `PointerContact[]` | Every pointer in contact with the surface, in the order they came into contact, as a fresh copy. |
| `wheel()` | `WheelDelta` | The wheel travel accumulated since the input frame last closed, as a fresh copy. |

The snapshot is what aiming and hovering read. The samples are what a game that
resolves each position on its own reads: a sweep that crossed several targets
between two frames arrives as the ordered positions it visited rather than as
the last one alone. A game driving one thing with one pointer keeps the samples
whose `primary` is `true`.

`pointerSamples()` lists at most 1024 samples per frame; a burst past that bound
still moves the snapshot, the contacts, and the edges, and the samples past it
are not listed. When the input frame closes, the sample list empties, the
accumulated wheel travel returns to zero, and unconsumed edges are discarded.
The contacts persist, because a pointer held across a frame boundary is still in
contact.

## Devices and buttons

A mouse, a pen, and a touch reach the game as pointers on the same reads, so a
game written against the pointer is playable with any of them. What separates
them is `device` and `buttons`, which a game reads where it wants to differ:
sizing a hit area for a fingertip, or putting a second control on the secondary
button.

A pointer is held while it holds at least one button. A touch or a pen in
contact holds `primary`, so a game that asks only about `down` or calls
`pointerPressed()` with no argument behaves identically under all three devices.

Each button carries its own press and release edges. Pressing the secondary
button while the primary is already held arms the secondary's press edge alone,
and releasing it arms the secondary's release edge while the pointer stays held.

## Multiple pointers

Every pointer the surface reports is tracked. `pointerContacts()` lists the ones
in contact, which is what a pinch, a two-finger drag, or two players on one
screen read, and every sample names the `id` it came from.

The snapshot and the edges follow the primary pointer alone, so a game built for
one pointer is unaffected by a second finger landing on the screen.

## The wheel

`wheel()` reports the travel a wheel or a trackpad scroll gesture accumulated
over the input frame, converted into logical units through the same map
positions go through. A wheel reporting its travel in lines is converted at 16
CSS pixels per line, and one reporting pages at the surface's CSS height per
page.

## Gesture ownership

The engine claims the browser's own pointer gestures on the surface as the
pointer attaches, through the surface's
[`claimGestures`](/engines/structured-3d/apis/engine/), and gives them back when it
detaches. The claim delivers a whole touch drag, a press of the secondary
button, and the wheel's travel to the game.

Each pointer is captured as it comes into contact and released as it leaves, so
a drag that travels off the canvas keeps delivering moves and its release is
seen. A surface implementing neither hook behaves the same in every other
respect.

## Pointer events

The engine attaches its `pointerdown`, `pointermove`, `pointerup`,
`pointercancel`, and `wheel` listeners to the same event target its key
listeners go on. Each pointer listener reads `clientX`, `clientY`, `pointerId`,
`pointerType`, `isPrimary`, `button`, and `buttons`; the wheel listener reads
`deltaX`, `deltaY`, and `deltaMode`. Each leaves the event otherwise untouched.
An event carrying no numeric client position is ignored, an unrecognized
`pointerType` reads as `"mouse"`, and an absent `pointerId` reads as `0`.

The client position is mapped to the stage against the origin
[`SurfaceMetrics.origin`](/engines/structured-3d/apis/engine/) reports.
Dispatching a pointer-shaped event at the target drives the pointer exactly as
a player's does; over a surface with no `origin`, the origin is `(0, 0)` and a
dispatched event's client position is read as CSS pixels from the canvas's
top-left corner.

Per pointer, `down` and `up` samples alternate strictly: a `down` is the pointer
coming into contact, and an `up` is it leaving. A button pressed or released
while the pointer stays in contact records a `move` sample naming that button. A
`pointercancel` ends a contact as a release at the last known position. While
the viewport is degenerate (a `scale` of `0`), a `down` or a `move` has no place
on the stage and is dropped; a release still ends the contact at the last known
position.

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
| `dpad-4` | A four-way pad | `up`, `down`, `left`, `right` |
| `dpad-4-two-buttons` | A four-way pad and two action buttons | `up`, `down`, `left`, `right`, `a`, `b` |
| `single-stick` | One analog stick | `move-up`, `move-down`, `move-left`, `move-right` |
| `dual-stick` | Two analog sticks | `move-up`, `move-down`, `move-left`, `move-right`, `look-up`, `look-down`, `look-left`, `look-right` |
| `dual-stick-two-buttons` | Two analog sticks and two action buttons | The `dual-stick` vocabulary followed by `a`, `b` |

Each entry's `actions` is the vocabulary above followed by the four menu
actions, so `TOUCH_LAYOUTS["single-stick"].actions` is `["move-up",
"move-down", "move-left", "move-right", "confirm", "back", "pause", "mute"]`.

A stick's deflection reaches the four directional actions of that stick as
magnitudes in `0..1`, the deflection split by direction, so a stick pushed
half-way up and to the right reports about `0.5` on `move-up` and `0.5` on
`move-right` and `0` on the other two. A game registers a stick layout's
directional actions as `"analog"` to read those magnitudes; registered
`"digital"`, any deflection reads as `1`. A held key gives the action full
deflection either way.

```ts
api.input.register("move-up", { keys: ["KeyW", "ArrowUp"], kind: "analog" });
api.input.register("move-down", { keys: ["KeyS", "ArrowDown"], kind: "analog" });
api.input.register("move-left", { keys: ["KeyA", "ArrowLeft"], kind: "analog" });
api.input.register("move-right", { keys: ["KeyD", "ArrowRight"], kind: "analog" });
```

## Errors

| Condition | Result |
| --- | --- |
| `EngineOptions.layout` names a layout outside `TOUCH_LAYOUTS` | `createEngine` throws, naming every valid layout |

## Exports

`ActionKind`, `ActionBinding`, `RegisteredAction`, `TouchLayout`,
`InputReader`, `PointerDevice`, `PointerButton`, `PointerSampleType`,
`PointerSample`, `PointerSnapshot`, `PointerContact`, and `WheelDelta` are
exported as types from `@test-cabinet/structured-3d`, and `TOUCH_LAYOUTS` is
exported as a value.
