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
import { createEngine } from "@test-cabinet/simple-2d";

const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  layout: "dual-vertical",
});
```

## Registering the vocabulary

Register one action per name in `initialize`, giving the `KeyboardEvent.code`
values that drive it. `api.input.layout()` reports the layout the engine was
created with, so a key table indexed by action name registers the whole
vocabulary in one pass.

```ts
import type { InitApi } from "@test-cabinet/simple-2d";

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

function registerActions(api: InitApi): void {
  for (const action of api.input.layout()?.actions ?? []) {
    api.input.register(action, { keys: KEYS[action] ?? [] });
  }
}
```

Register anything the design needs beyond the layout's vocabulary the same way.
An action is digital by default and reports `0` or `1`; declare it analog where
the game is written to use a partial magnitude.

```ts
api.input.register("boost", { keys: ["ShiftLeft", "ShiftRight"] });
api.input.register("steer", { keys: ["KeyA", "KeyD"], kind: "analog" });
```

Every registration belongs in `initialize`, which the engine runs to completion
before the first frame. The full vocabulary is therefore live by the time the
first `update` reads it.

## Reading held input

`api.input.value(name)` is the held read. Scale it by the frame's delta time,
and take a signed axis as the difference between the two directions so pressing
both cancels out.

```ts
import type { UpdateApi } from "@test-cabinet/simple-2d";

function update(state: Match, api: UpdateApi, dt: number): void {
  const p1 = api.input.value("p1-down") - api.input.value("p1-up");
  state.left.cy = clamp(state.left.cy + p1 * PADDLE_SPEED * dt, MIN_Y, MAX_Y);

  const p2 = api.input.value("p2-down") - api.input.value("p2-up");
  state.right.cy = clamp(state.right.cy + p2 * PADDLE_SPEED * dt, MIN_Y, MAX_Y);
}
```

## Reading presses

`api.input.pressed(name)` is the edge read, and it is true once per press
however long the key is held. Use it for anything that happens a single time:
confirming a menu entry, pausing, firing a shot, toggling mute.

```ts
function update(state: Match, api: UpdateApi, dt: number): void {
  if (api.input.pressed("pause")) state.paused = !state.paused;
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

  if (state.paused) return;
  if (api.input.pressed("confirm")) serve(state);
  step(state, dt);
}
```

Read a given action's edge in one place per frame. The first read consumes it,
so a menu layer and a gameplay layer both polling `confirm` in one frame split a
single press between them.

## Where reads belong

Read actions inside `update`. Edges are armed as input arrives and the frame
loop closes the input frame after the render, so a read taken during `update` is
the input for the frame being simulated.

`render` receives a context, the frame counter, and the viewport, which keeps a
frame's response to the player decided entirely by `update`. A value the drawing
depends on is computed in `update` and stored in the state.

A game that wants a key the engine has no action for registers an action for it.
Everything the game reads then comes from one registry, and a validator drives
that action by name with no keystroke to synthesize.
