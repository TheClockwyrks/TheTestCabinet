---
title: Input and Audio
---

Input reaches the engine through the event target the harness owns, and audio
leaves it through the event broadcaster. Both are engine surfaces, so a check
drives a build and reads it back without the build exposing anything of its own.

## Driving actions

The engine attaches its `keydown` and `keyup` listeners to the event target
`SurfaceMetrics.events()` returns, reading `code` and `repeat` off each event.
Dispatching a keyboard-shaped event at that target drives an action exactly as a
player's key does.

```ts
import { KEYS } from "../src/constants";

function keyEvent(type: "keydown" | "keyup", code: string): Event {
  return Object.assign(new Event(type), { code, repeat: false });
}

export function hold(h: Harness, action: string): void {
  for (const code of KEYS[action]) {
    h.keys.dispatchEvent(keyEvent("keydown", code));
  }
}

export function release(h: Harness, action: string): void {
  for (const code of KEYS[action]) {
    h.keys.dispatchEvent(keyEvent("keyup", code));
  }
}
```

A check drives by action name, and `constants.ts` resolves the name to the codes
the case fixed for it. The names and the codes are the case's, so a build that
bound an action to a different key is caught by the check that expected the
action to respond.

A held key gives an analog action full deflection, so the movement and look
actions a 3D layout registers `"analog"` for its sticks are driven from a suite
the same way: a hold reads as magnitude `1` on the action for as long as it
lasts.

## Holds and taps

A key stays down until a `keyup` arrives, so a hold is a press, some frames, and
a release.

```ts
const start = h.snapshot().player.z;

hold(h, "move-forward");
await h.engine.advance(36);
release(h, "move-forward");

expect(h.snapshot().player.z).toBeLessThan(start);
```

An edge is armed when an action's value goes from zero to non-zero, and the
engine discards every edge the frame left unconsumed. A tap is therefore a
press, exactly one frame, and a release.

```ts
export async function tap(h: Harness, action: string): Promise<void> {
  hold(h, action);
  await h.engine.advance(1);
  release(h, action);
}
```

Reading the action's magnitude and reading its press are separate, so a build
that watches either one sees what a player would have caused.

## Driving the pointer

The engine attaches its pointer listeners to the same target, reading
`clientX`, `clientY`, and `isPrimary` off each event. Over a surface with no
`origin`, a dispatched event's client position is read as CSS pixels from the
canvas's top-left corner, and a suite that pins the surface to the stage's own
size at a ratio of `1` dispatches logical coordinates directly.

```ts
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): Event {
  return Object.assign(new Event(type), { clientX: x, clientY: y, isPrimary: true });
}

export async function drag(h: Harness, path: Point[]): Promise<void> {
  const [first, ...rest] = path;
  h.keys.dispatchEvent(pointerEvent("pointerdown", first.x, first.y));
  for (const point of rest) {
    h.keys.dispatchEvent(pointerEvent("pointermove", point.x, point.y));
  }
  const last = path[path.length - 1];
  h.keys.dispatchEvent(pointerEvent("pointerup", last.x, last.y));
  await h.engine.advance(1);
}
```

Every event dispatched before the frame advances lands in that frame's sample
list in order, so a sweep across several targets is delivered as the positions
it visited. A check that needs the press and the release seen on separate
frames advances between the dispatches instead.

The pointer is logical 2D, in 3D as in 2D. A build that picks into the scene
maps the position through [`pointerRay`](/engines/simple-3d/apis/viewport/), so
a check aims a click by projecting the target's world position into logical
coordinates with `projectPoint` and dispatching there — the inverse of the
build's own picking.

## Cues

The engine broadcasts `cue:played` for every cue a game plays.
`engine.events.on` returns the function that removes the handler, so a check
collects the cues of one window by subscribing before the act and unsubscribing
after it.

```ts
const cues: string[] = [];
const off = h.engine.events.on("cue:played", ({ cue }) => cues.push(cue));

const { player } = h.snapshot();
h.setBall({ x: player.x, y: 1, z: player.z - 4, vx: 0, vy: 0, vz: 10 });
await h.engine.advance(10);
off();

expect(cues).toContain("deflect");
```

Because the event names the cue, a build that fires its scoring blip on every
wall bounce fails rather than passing on a count. The payload also carries the
simulated time the cue played at and the gain it played at, which places the cue
in the run and distinguishes a muted play from an audible one.

The engine reports every play regardless of the unlock state, so a cue check
needs no gesture. Unlocking affects audibility, which a suite running in process
has nothing to observe.

A loop is checked the same way. `cue:looped` is broadcast once when a cue starts
looping and `cue:stopped` once when it ends, so a check that a thruster hum
starts with the key and ends with its release subscribes to both and asserts the
order, or reads the bus directly through `looping`.

## Other engine events

`asset:loaded`, `asset:failed`, and `audio:unlocked` are subscribed to the same
way. Asset events are most useful around
[`engine.initialize`](/engines/simple-3d/apis/engine/), where a subscription
taken before the call observes the whole of the game's loading.

```ts
const loaded: string[] = [];
engine.events.on("asset:loaded", ({ path }) => loaded.push(path));

await engine.initialize();

expect(loaded).toContain("meshes/ball.glb");
```
