---
title: Actions
---

A build declares its actions once at start-up and reads them inside `update`.
Every question about the player goes through the registry, and the build
installs no key listener of its own.

## Selecting a layout

Pass the touch layout the case asks for to `createEngine`, so it is selected
before anything is registered and every action it names is tagged with it.

```ts
const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  layout: "dual-vertical",
});
```

## Registering the vocabulary

Register one action per name with the `KeyboardEvent.code` values that drive it.
Driving a whole vocabulary from a key table keeps the layout and the bindings in
one place.

```ts
import { TOUCH_LAYOUTS, createEngine } from "@test-cabinet/simple-2d";

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

for (const action of TOUCH_LAYOUTS["dual-vertical"].actions) {
  engine.input.register(action, { keys: KEYS[action] ?? [] });
}
```

Register anything the design needs beyond the layout's vocabulary the same way,
and give an action a partial magnitude only where the game is written to use
one.

```ts
engine.input.register("boost", { keys: ["ShiftLeft", "ShiftRight"] });
engine.input.register("steer", { keys: ["KeyA", "KeyD"], kind: "analog" });
```

Register every action before the first frame runs.

## Reading held input

`value` is the held read. Scale it by the frame's delta time, and take a signed
axis as the difference between the two directions so pressing both cancels out.

```ts
function update(dt: number): void {
  const p1 = engine.input.value("p1-down") - engine.input.value("p1-up");
  left.cy = clamp(left.cy + p1 * PADDLE_SPEED * dt, PADDLE_MIN, PADDLE_MAX);

  const p2 = engine.input.value("p2-down") - engine.input.value("p2-up");
  right.cy = clamp(right.cy + p2 * PADDLE_SPEED * dt, PADDLE_MIN, PADDLE_MAX);
}
```

## Reading presses

`pressed` is the edge read, and it is true once per press however long the key
is held. Use it for anything that happens a single time: confirming a menu
entry, pausing, firing a shot.

```ts
function update(dt: number): void {
  if (engine.input.pressed("pause")) togglePause();
  if (engine.input.pressed("mute")) {
    engine.audio.setMuted(!engine.audio.muted());
  }

  if (paused) return;
  if (engine.input.pressed("confirm")) serve();
  advance(dt);
}
```

Read a given action's edge in one place per frame. The first read consumes it,
so a menu layer and a gameplay layer both polling `confirm` in one frame split a
single press between them.

## Where reads belong

Read actions inside `update`. Edges are armed as input arrives and discarded
once the frame ends, so a read from a timer or a DOM handler sees whatever the
last frame left behind rather than the input for the frame being simulated.

A build that wants a key the engine has no action for registers an action for it
instead of listening for the key. Everything the game reads then comes from one
place, and a driver can drive it without synthesizing a keystroke.
