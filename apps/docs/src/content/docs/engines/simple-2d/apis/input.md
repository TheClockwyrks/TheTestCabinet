---
title: Input
---

A game declares its actions once, from
[`InitApi.input`](/engines/simple-2d/apis/game/), and reads them every frame
from `UpdateApi.input`. The engine owns the keyboard and resolves each action to
a single number, so the game asks what an action is doing rather than which key
is down.

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
| `layout()` | The layout selected by `EngineOptions.layout`, as a fresh copy the caller owns, or `null` when the engine was built without one. |

The layout is chosen at construction through
[`EngineOptions.layout`](/engines/simple-2d/apis/engine/) and holds for the
engine's lifetime, so every registration is attributed against the same
vocabulary.

## Reading

```ts
readonly input: {
  value(name: string): number;
  pressed(name: string): boolean;
};
```

| Member | Result | Semantics |
| --- | --- | --- |
| `value(name)` | `number` | The action's resolved magnitude. A `"digital"` action reports `0` or `1`, with every non-zero magnitude quantized to `1`. An `"analog"` action reports the magnitude as given, and a held key gives it full deflection. An unregistered name reports `0`. |
| `pressed(name)` | `boolean` | `true` exactly once per armed edge, which the call consumes. An unregistered name reports `false`. |

An edge is armed whenever a change takes the resolved value from `0` to
non-zero, whatever the source. A key event whose `repeat` flag is set arms
nothing.

The engine closes the input frame after the game has rendered, discarding every
edge left unconsumed. A press is therefore news for exactly one frame.

## Key events

The engine attaches its `keydown` and `keyup` listeners to the event target
[`EngineOptions.surface`](/engines/simple-2d/apis/engine/) supplies, and to the
canvas's owning document when the engine was built without a surface. Each
listener reads `KeyboardEvent.code` and `KeyboardEvent.repeat` and leaves the
event otherwise untouched.

Dispatching a `KeyboardEvent`-shaped event at that target drives an action
exactly as a player's key does. That is the seam a test uses to hold a key, tap
it, and release it, over a surface with no document behind it.

## The touch-layout catalogue

```ts
const TOUCH_LAYOUTS: Readonly<Record<string, TouchLayout>>;
```

`TOUCH_LAYOUTS` is exported from the package root and is frozen through its
entries and their `actions` arrays. The menu actions are `["confirm", "back",
"pause", "mute"]`, appended to every entry's own vocabulary in that order.

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
| `register` with a `kind` outside `ActionKind` | `Error` naming the value |

## Exports

`ActionKind`, `ActionBinding`, `RegisteredAction`, and `TouchLayout` are
exported as types from `@test-cabinet/simple-2d`, and `TOUCH_LAYOUTS` is
exported as a value.
