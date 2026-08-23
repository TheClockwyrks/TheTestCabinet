# Input

A game declares its actions once, from `InitApi.input` inside `initialize`, and
reads them every frame from `UpdateApi.input` inside `update`. The engine owns
the keyboard and resolves each action to a single number, so the game asks what
an action is doing rather than which key is down.

```ts
// In initialize:
api.input.register(name: string, binding: ActionBinding): void;
api.input.layout(): TouchLayout | null;

// In update:
api.input.value(name: string): number;
api.input.pressed(name: string): boolean;
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
  api.input.register("thrust", { keys: ["ArrowUp", "KeyW"] });
  api.input.register("fire", { keys: ["Space"] });
  api.input.register("steer", { keys: ["ArrowLeft", "ArrowRight"], kind: "analog" });
  return [{ /* ... */ }, null];
}
```

`kind` defaults to `"digital"`. Re-registering a name replaces its binding
wholesale, returns the action to rest, and keeps its position in the
registration order. Any name is accepted.

## Reading actions

| Member | Result | Semantics |
| --- | --- | --- |
| `value(name)` | `number` | The action's resolved magnitude. A `"digital"` action reports `0` or `1`. An `"analog"` action reports the magnitude as given, and a held key gives it full deflection. An unregistered name reports `0`. |
| `pressed(name)` | `boolean` | `true` exactly once per armed edge, which the call consumes. An unregistered name reports `false`. |

`value` is for things that happen while a key is held, and `pressed` is for
things that happen once per press:

```ts
update(state, api, dt) {
  // Held: applied every frame it is down.
  const dir = api.input.value("right") - api.input.value("left");
  state.x += dir * SPEED * dt;

  // Edge: fires once per press, however long the key is held.
  if (api.input.pressed("fire")) state.bullets.push(spawn(state));
}
```

An edge is armed whenever a change takes the resolved value from `0` to
non-zero, whatever the source. Pressing a second key bound to an already-held
action is not a new press, and a key event whose `repeat` flag is set arms
nothing.

The engine closes the input frame after the game has rendered, discarding every
edge left unconsumed. A press is therefore news for exactly one frame, so read
each edge in the `update` that follows it.

## Key events

The engine attaches its `keydown` and `keyup` listeners to the event target the
`surface` option supplies, and to the canvas's owning document when the engine
was built without a surface. Each listener reads `KeyboardEvent.code` and
`KeyboardEvent.repeat` and leaves the event otherwise untouched.

Dispatching a `KeyboardEvent`-shaped event at that target drives an action
exactly as a player's key does.

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
const engine = createEngine({ canvas, width: 640, height: 360, game, layout: "dpad-4" });
```

| Layout | Controls | Own vocabulary |
| --- | --- | --- |
| `dual-vertical` | Two vertical sliders, one per side | `p1-up`, `p1-down`, `p2-up`, `p2-down` |
| `single-vertical` | One vertical slider | `up`, `down` |
| `dpad-4` | A four-way pad | `up`, `down`, `left`, `right` |
| `dpad-4-two-buttons` | A four-way pad and two action buttons | `up`, `down`, `left`, `right`, `a`, `b` |

The menu actions `["confirm", "back", "pause", "mute"]` are appended to every
entry's own vocabulary in that order, so
`TOUCH_LAYOUTS["single-vertical"].actions` is `["up", "down", "confirm", "back",
"pause", "mute"]`.

A game built with a layout registers that layout's action names, so the scheme
and the bindings agree:

```ts
initialize(api) {
  const layout = api.input.layout();
  for (const name of layout?.actions ?? []) {
    api.input.register(name, { keys: KEYS_FOR[name] ?? [] });
  }
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
