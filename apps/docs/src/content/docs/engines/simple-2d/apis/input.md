---
title: Input
---

The action registry is reached as `engine.input`, an `InputRegistry`. The engine
constructs it over the canvas's owning document and attaches its key listeners
immediately, so the registry is live before the first registration. The class is
exported from `@test-cabinet/simple-2d` as a type only, since the engine
constructs the registry.

```ts
class InputRegistry {
  register(name: string, binding: ActionBinding): void;
  useLayout(name: string): void;
  layout(): TouchLayout | null;
  actions(): RegisteredAction[];
  value(name: string): number;
  pressed(name: string): boolean;
  setAction(name: string, value: number): void;
  pressAction(name: string): void;
  endFrame(): void;
  detach(): void;
}
```

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
| `ActionBinding.kind` | How the action is interpreted. Defaults to `"digital"`. |
| `RegisteredAction.kind` | The resolved kind, always present. |
| `RegisteredAction.layout` | The touch layout the action belongs to, or `null` for an action registered beyond the selected layout's vocabulary or with no layout selected. |
| `TouchLayout.actions` | The layout's own vocabulary followed by the four menu actions. |

## Registration

| Member | Semantics |
| --- | --- |
| `register(name, binding)` | Registers or re-registers `name`. `binding.keys` is copied, `binding.kind` defaults to `"digital"`, and `layout` resolves to the selected layout's name when that layout's vocabulary contains `name` and to `null` otherwise. Re-registering replaces the binding wholesale, resets the action to rest, and keeps its position in `actions()`. Any name is accepted. |
| `useLayout(name)` | Selects a catalogue layout, which from then on tags registrations of its vocabulary actions. Throws for a name outside `TOUCH_LAYOUTS`, with every valid layout named in the message. |
| `layout()` | The selected layout as a fresh copy the caller owns, or `null` when none was selected. |
| `actions()` | Every registered action with its defaults resolved, in registration order, as copies. |

## Reading

| Member | Result | Semantics |
| --- | --- | --- |
| `value(name)` | `number` | `1` while any bound key is down, otherwise the value last given to `setAction`. A `"digital"` action reports `0` or `1`, with every non-zero magnitude quantized to `1`. An unregistered name reports `0`. |
| `pressed(name)` | `boolean` | `true` exactly once per armed edge, which the call consumes. An unregistered name reports `false`. |

An edge is armed whenever a change takes the resolved value from `0` to
non-zero, whatever the source. A key event whose `repeat` flag is set arms
nothing.

## Driving and lifecycle

| Member | Semantics |
| --- | --- |
| `setAction(name, value)` | Sets the action's driven magnitude, taking the same path a key does, so crossing from rest into motion arms the edge. Ignored for an unregistered name. |
| `pressAction(name)` | Arms the action's edge and leaves its magnitude untouched. Ignored for an unregistered name. |
| `endFrame()` | Discards every edge left unconsumed. The frame loop calls it once per frame, after the game has rendered. |
| `detach()` | Removes the key listeners. Idempotent, and called by `Engine.destroy`. |

## The touch-layout catalogue

```ts
const TOUCH_LAYOUTS: Readonly<Record<string, TouchLayout>>;
```

`TOUCH_LAYOUTS` is exported from the package root and is frozen through its
entries and their `actions` arrays. The menu actions are `["confirm", "back",
"pause", "mute"]`, appended to every entry's own vocabulary in that order; they
live in the engine's internal `MENU_ACTIONS` constant rather than in an export.

| Layout | Controls | Own vocabulary |
| --- | --- | --- |
| `dual-vertical` | Two vertical sliders, one per side | `p1-up`, `p1-down`, `p2-up`, `p2-down` |
| `single-vertical` | One vertical slider | `up`, `down` |
| `dpad-4` | A four-way pad | `up`, `down`, `left`, `right` |
| `dpad-4-two-buttons` | A four-way pad and two action buttons | `up`, `down`, `left`, `right`, `a`, `b` |

Each entry's `actions` is the vocabulary above followed by the four menu
actions, so `TOUCH_LAYOUTS["single-vertical"].actions` is `["up", "down",
"confirm", "back", "pause", "mute"]`.

`EngineOptions.layout` selects a layout at construction, which is equivalent to
calling `useLayout` before any registration and throws on the same condition.
