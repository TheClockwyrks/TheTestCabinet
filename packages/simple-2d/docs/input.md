# Input

A game never reads a `KeyboardEvent`. It registers named actions with the keys
that drive them, and asks the engine for a value or an edge.

```ts
engine.input.register(name: string, binding: ActionBinding): void;
engine.input.value(name: string): number;
engine.input.pressed(name: string): boolean;
engine.input.useLayout(name: string): void;
engine.input.layout(): TouchLayout | null;
engine.input.actions(): RegisteredAction[];
```

## Registering an action

```ts
interface ActionBinding {
  keys: string[];              // KeyboardEvent.code values
  kind?: "digital" | "analog"; // defaults to "digital"
}
```

`keys` are `KeyboardEvent.code` values, not `key` values, so a binding is
independent of the keyboard layout: `"KeyW"` is the same physical key on QWERTY
and AZERTY. Common codes are `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`,
`"ArrowRight"`, `"KeyW"`, `"KeyA"`, `"KeyS"`, `"KeyD"`, `"Space"`, `"Enter"`,
`"Escape"`, `"KeyP"`, `"KeyM"`, and `"Digit1"` through `"Digit9"`.

```ts
engine.input.register("p1-up", { keys: ["KeyW"] });
engine.input.register("p1-down", { keys: ["KeyS"] });
engine.input.register("confirm", { keys: ["Enter", "Space"] });
engine.input.register("pause", { keys: ["KeyP", "Escape"] });
```

Several keys may drive one action, and one key may drive several actions.
Registering the same name again replaces the binding wholesale and returns the
action to rest, keeping its position in `actions()`.

Register every action the game uses, before the first frame.

## `kind`

| Kind | `value` reports |
| --- | --- |
| `digital` | `0` or `1`. Any non-zero magnitude is quantized to `1`. |
| `analog` | A continuous magnitude. A held key still reports `1`. |

Pick `analog` for anything that is meant to be partially deflected, such as a
steering axis driven by a touch slider. Everything else is `digital`.

## Held versus edge

`value(name)` is the held read: `1` while a bound key is down, `0` otherwise.
Use it for anything continuous, and scale it by `dt`.

```ts
update(dt) {
  const dir = engine.input.value("p1-down") - engine.input.value("p1-up");
  paddle.y += dir * PADDLE_SPEED * dt;
}
```

`pressed(name)` is the edge read: `true` exactly once per press, then consumed.
Use it for anything that should happen once no matter how long the key is held.

```ts
update() {
  if (engine.input.pressed("confirm")) startGame();
  if (engine.input.pressed("mute")) engine.audio.setMuted(!engine.audio.muted());
}
```

Two properties of the edge read matter:

- It is consumed by the first call that sees it. Read a given action's edge in
  one place per frame; a menu and a gameplay layer both polling `confirm` would
  otherwise both act on one press, and only one of them will.
- An unconsumed edge is discarded at the end of the frame. A press is news for
  one frame only.

An OS key repeat is not a new press, and pressing a second key already bound to a
held action is not a new press either.

Reading an action that was never registered returns `0` from `value` and `false`
from `pressed`, rather than throwing.

## Touch layouts

`useLayout(name)` selects a layout from the closed catalogue. The catalogue is
fixed, and an unknown name throws with the valid names in the message.

A layout is an action vocabulary: it names the actions the control scheme
speaks. Selecting a layout does not register anything by itself — the game still
registers each action with its keyboard binding — but an action registered
*after* `useLayout` whose name is in the vocabulary is tagged with that layout.

```ts
const engine = createEngine({ canvas, width: 640, height: 360, layout: "dual-vertical" });

// equivalently, after construction:
engine.input.useLayout("dual-vertical");

engine.input.register("p1-up", { keys: ["KeyW"] });     // tagged "dual-vertical"
engine.input.register("boost", { keys: ["ShiftLeft"] }); // tagged null
```

| Layout | Controls | Vocabulary |
| --- | --- | --- |
| `dual-vertical` | Two vertical sliders | `p1-up`, `p1-down`, `p2-up`, `p2-down` |
| `single-vertical` | One vertical slider | `up`, `down` |
| `dpad-4` | A four-way pad | `up`, `down`, `left`, `right` |
| `dpad-4-two-buttons` | Pad plus two buttons | `up`, `down`, `left`, `right`, `a`, `b` |

Every layout also carries the menu vocabulary — `confirm`, `back`, `pause`,
`mute` — on top of the actions listed above. A game binds `pause` once and gets
it whichever layout is live.

A game may register actions beyond its layout's vocabulary. Those actions have a
`layout` of `null`.

`TOUCH_LAYOUTS` exports the catalogue as data, so a game can register a whole
vocabulary in a loop:

```ts
import { TOUCH_LAYOUTS } from "@test-cabinet/simple-2d";

const KEYS: Record<string, string[]> = {
  "p1-up": ["KeyW"],
  "p1-down": ["KeyS"],
  "p2-up": ["ArrowUp"],
  "p2-down": ["ArrowDown"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

for (const action of TOUCH_LAYOUTS["dual-vertical"]!.actions) {
  engine.input.register(action, { keys: KEYS[action] ?? [] });
}
```

`layout()` reports the selected layout as `{ name, actions }`, or `null` when
none was selected.

## Reading the registrations back

`actions()` returns every registered action in registration order, with defaults
resolved:

```ts
interface RegisteredAction {
  name: string;
  keys: string[];
  kind: "digital" | "analog";
  layout: string | null;
}
```

It is a copy, so mutating it changes nothing.
