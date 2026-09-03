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
  width: 1280,
  height: 720,
  game,
  layout: "dual-stick",
});
```

The [catalogue](/engines/simple-3d/apis/input/) holds five layouts: the two
four-way pads, `dpad-4` and `dpad-4-two-buttons`, and the three stick layouts,
`single-stick`, `dual-stick`, and `dual-stick-two-buttons`. A pad names `up`,
`down`, `left`, and `right`; a stick names `move-up`, `move-down`, `move-left`,
and `move-right`, and a second stick adds the four `look-` directions. Every
layout ends with `confirm`, `back`, `pause`, and `mute`.

## Registering the vocabulary

Register one action per name in `initialize`, giving the `KeyboardEvent.code`
values that drive it. `api.input.layout()` reports the layout the engine was
created with, so a key table indexed by action name registers the whole
vocabulary in one pass.

A stick's deflection reaches its four directional actions as magnitudes in
`0..1`, so a stick layout's directional actions are registered `"analog"`,
which is what lets `value` report the deflection rather than quantizing it to
`1`. A held key bound to the same action gives full deflection.

```ts
import type { InitApi } from "@test-cabinet/simple-3d";

const KEYS: Record<string, string[]> = {
  "move-up": ["KeyW"],
  "move-down": ["KeyS"],
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

const STICK = /^(move|look)-/;

function registerActions(api: InitApi): void {
  for (const action of api.input.layout()?.actions ?? []) {
    api.input.register(action, {
      keys: KEYS[action] ?? [],
      kind: STICK.test(action) ? "analog" : "digital",
    });
  }
}
```

Register anything the design needs beyond the layout's vocabulary the same way.
An action is digital by default and reports `0` or `1`; declare it analog where
the game is written to use a partial magnitude.

```ts
api.input.register("zoom-in", { keys: ["Equal"] });
api.input.register("zoom-out", { keys: ["Minus"] });
api.input.register("throttle", { keys: ["ShiftLeft", "ShiftRight"], kind: "analog" });
```

Every registration belongs in `initialize`, which the engine runs to completion
before the first frame. The full vocabulary is therefore live by the time the
first `update` reads it.

## Reading held input

`api.input.value(name)` is the held read. Scale it by the frame's delta time,
and take a signed axis as the difference between the two directions so pressing
both cancels out. On a stick layout the difference is the stick's signed
deflection along that axis, in `-1..1`, and a key gives `-1`, `0`, or `1` on
the same axis.

```ts
import type { UpdateApi } from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

function update(state: DeepReadonly<Walk>, api: UpdateApi, dt: number): Walk {
  const strafe = api.input.value("move-right") - api.input.value("move-left");
  const advance = api.input.value("move-up") - api.input.value("move-down");
  const turn = api.input.value("look-right") - api.input.value("look-left");

  const yaw = state.player.yaw - turn * TURN_RATE * dt;
  const dx = Math.cos(yaw) * strafe - Math.sin(yaw) * advance;
  const dz = Math.sin(yaw) * strafe + Math.cos(yaw) * advance;
  const x = state.player.x + dx * WALK_SPEED * dt;
  const z = state.player.z - dz * WALK_SPEED * dt;
  return { ...state, player: { ...state.player, x, z, yaw } };
}
```

The player above walks along the ground plane, facing `-Z` at a yaw of zero
and turning about `+Y`, which is the engine's coordinate convention. A
half-deflected stick walks at half speed, because the axis is multiplied
through rather than quantized.

## Reading presses

`api.input.pressed(name)` is the edge read, and it is true once per press
however long the key is held. Use it for anything that happens a single time:
confirming a menu entry, pausing, dropping a load, toggling mute.

```ts
function update(state: DeepReadonly<Yard>, api: UpdateApi, dt: number): Yard {
  const paused = api.input.pressed("pause") ? !state.paused : state.paused;
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

  if (paused) return { ...state, paused };
  const released = api.input.pressed("confirm") ? release(state) : state;
  return step({ ...released, paused }, dt);
}
```

Read a given action's edge in one place per frame. The first read consumes it,
so a menu layer and a gameplay layer both polling `confirm` in one frame split a
single press between them.

## Where reads belong

Read actions inside `update`. Edges are armed as input arrives and the frame
loop closes the input frame after the render, so a read taken during `update` is
the input for the frame being simulated.

`render` receives the scene, the camera, the screen layer, the frame counter,
the viewport, and the view, which keeps a frame's response to the player decided
entirely by `update`. A value the drawing depends on is computed in `update` and
carried in the state it returns.

A game that wants a key the engine has no action for registers an action for it.
Everything the game reads then comes from one registry, and a validator drives
that action by name with no keystroke to synthesize. The pointer is the one
input outside the registry: it arrives in logical stage coordinates, and the
[camera page](/engines/simple-3d/usage/the-camera-and-pointer/) shows how
`update` turns it into a pick in the world.
