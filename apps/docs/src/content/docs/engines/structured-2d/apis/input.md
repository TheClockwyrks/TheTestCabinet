---
title: Input
---

A game registers its actions once, from
[`InitApi.input`](/engines/structured-2d/apis/game-instance/), and reads them
through a player controller. The engine owns the keyboard and resolves each
action to a single number, so the game asks what an action is doing rather than
which key is down.

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
[`EngineOptions.layout`](/engines/structured-2d/apis/engine/) and holds for the
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
}
```

[`PlayerController.input`](/engines/structured-2d/apis/controllers/) is the one
place a game reads an action. A controller reads its actions on its own tick and
writes the result onto the pawn it possesses, and every controller ticks before
any actor, so a pawn's own tick observes the input its controller already
applied. [Possession](/engines/structured-2d/concepts/possession/) covers the
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

## Key events

The engine attaches its `keydown` and `keyup` listeners to the event target
[`EngineOptions.surface`](/engines/structured-2d/apis/engine/) supplies, and to
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
| `dual-vertical` | Two vertical sliders, one per side | `p1-up`, `p1-down`, `p2-up`, `p2-down` |
| `single-vertical` | One vertical slider | `up`, `down` |
| `dpad-4` | A four-way pad | `up`, `down`, `left`, `right` |
| `dpad-4-two-buttons` | A four-way pad and two action buttons | `up`, `down`, `left`, `right`, `a`, `b` |

Each entry's `actions` is the vocabulary above followed by the four menu
actions, so `TOUCH_LAYOUTS["single-vertical"].actions` is `["up", "down",
"confirm", "back", "pause", "mute"]`.

## Errors

| Condition | Result |
| --- | --- |
| `EngineOptions.layout` names a layout outside `TOUCH_LAYOUTS` | `createEngine` throws, naming every valid layout |

## Exports

`ActionKind`, `ActionBinding`, `RegisteredAction`, `TouchLayout`, and
`InputReader` are exported as types from `@test-cabinet/structured-2d`, and
`TOUCH_LAYOUTS` is exported as a value.
