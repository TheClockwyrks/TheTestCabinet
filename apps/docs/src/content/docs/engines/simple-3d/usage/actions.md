---
title: Actions
---

A game declares its actions once in `initialize` and reads them inside `update`.
Every question about the player goes through the registry, so a validator drives
the game by action name and the build holds one description of its own controls.

## Selecting a layout

Pass the touch layout the case asks for to `createEngine`. It is selected before
any registration happens, so every action the layout names is tagged with it.

```ts
import { createEngine } from "@test-cabinet/simple-3d";

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  layout: "stick-look",
});
```

## Registering the vocabulary

Register one action per name in `initialize`, giving the `KeyboardEvent.code`
values that drive it. `api.input.layout()` reports the layout the engine was
created with, so a key table indexed by action name registers the whole
vocabulary in one pass.

```ts
import type { InitApi } from "@test-cabinet/simple-3d";

const KEYS: Record<string, string[]> = {
  "move-forward": ["KeyW"],
  "move-back": ["KeyS"],
  "move-left": ["KeyA"],
  "move-right": ["KeyD"],
  "look-up": ["ArrowUp"],
  "look-down": ["ArrowDown"],
  "look-left": ["ArrowLeft"],
  "look-right": ["ArrowRight"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

const ANALOG = new Set([
  "move-forward", "move-back", "move-left", "move-right",
  "look-up", "look-down", "look-left", "look-right",
]);

function registerActions(api: InitApi): void {
  for (const action of api.input.layout()?.actions ?? []) {
    api.input.register(action, {
      keys: KEYS[action] ?? [],
      kind: ANALOG.has(action) ? "analog" : "digital",
    });
  }
}
```

An action is digital by default and reports `0` or `1`; declare it analog where
the game is written to use a partial magnitude. A stick's deflection on an axis
drives the two opposed actions of that axis as magnitudes, and the look pad and
the wheel do the same, so the stick and pad actions are the ones a game
declares analog — a held key still gives an analog action full deflection, so
the same code serves both keyboard and touch.

Register anything the design needs beyond the layout's vocabulary the same way.

```ts
api.input.register("boost", { keys: ["ShiftLeft", "ShiftRight"] });
api.input.register("jump", { keys: ["Space"] });
```

Every registration belongs in `initialize`, which the engine runs to completion
before the first frame. The full vocabulary is therefore live by the time the
first `update` reads it.

## Reading held input

`api.input.value(name)` is the held read. Scale it by the frame's delta time,
and take a signed axis as the difference between the two directions so pressing
both cancels out.

```ts
import {
  quatFromAxisAngle,
  rotateVec3,
  vec3Add,
  vec3Cross,
  vec3Scale,
} from "@test-cabinet/simple-3d";
import type { UpdateApi } from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

function update(state: DeepReadonly<Walk>, api: UpdateApi, dt: number): Walk {
  const ahead = api.input.value("move-forward") - api.input.value("move-back");
  const side = api.input.value("move-right") - api.input.value("move-left");
  const yaw = state.heading +
    (api.input.value("look-left") - api.input.value("look-right")) * TURN_RATE * dt;

  const forward = rotateVec3(quatFromAxisAngle(UP, yaw), FORWARD);
  const right = vec3Cross(forward, UP);
  const step = vec3Add(vec3Scale(forward, ahead), vec3Scale(right, side));
  return {
    ...state,
    heading: yaw,
    position: vec3Add(state.position, vec3Scale(step, WALK_SPEED * dt)),
  };
}
```

## Reading presses

`api.input.pressed(name)` is the edge read, and it is true once per press
however long the key is held. Use it for anything that happens a single time:
confirming a menu entry, pausing, firing a shot, toggling mute.

```ts
function update(state: DeepReadonly<Match>, api: UpdateApi, dt: number): Match {
  const paused = api.input.pressed("pause") ? !state.paused : state.paused;
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

  if (paused) return { ...state, paused };
  const served = api.input.pressed("confirm") ? serve(state) : state;
  return step({ ...served, paused }, dt);
}
```

Read a given action's edge in one place per frame. The first read consumes it,
so a menu layer and a gameplay layer both polling `confirm` in one frame split a
single press between them.

## Where reads belong

Read actions inside `update`. Edges are armed as input arrives and the frame
loop closes the input frame after the render, so a read taken during `update` is
the input for the frame being simulated.

`render` receives the scene context, the frame counter, and the viewport, which
keeps a frame's response to the player decided entirely by `update`. A value
the drawing depends on is computed in `update` and carried in the state it
returns.

A game that wants a key the engine has no action for registers an action for it.
Everything the game reads then comes from one registry, and a validator drives
that action by name with no keystroke to synthesize.
