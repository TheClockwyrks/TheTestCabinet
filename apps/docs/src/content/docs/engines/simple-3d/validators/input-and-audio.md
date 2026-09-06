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

An action a stick layout registers as `"analog"` reads a held key as full
deflection, so a held key drives it to `1` exactly as it drives a digital
action, and a check written against a stick layout dispatches keys the same
way.

## Holds and taps

A key stays down until a `keyup` arrives, so a hold is a press, some frames, and
a release.

```ts
const { y } = h.snapshot().hook;

hold(h, "hoist-up");
await h.engine.advance(36);
release(h, "hoist-up");

expect(h.snapshot().hook.y).toBeGreaterThan(y);
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
import type { Vec2 } from "@clockwyrks/simple-3d";

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): Event {
  return Object.assign(new Event(type), {
    clientX: x,
    clientY: y,
    isPrimary: true,
  });
}

export async function drag(h: Harness, path: Vec2[]): Promise<void> {
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

A pointer position is a logical stage point, and the build turns it into a
world-space ray through `view().ray` to pick what lies under it. A check that
drives a pick at a world target therefore finds the stage point to dispatch
through `engine.view().project`, the inverse of the trip the build's own pick
makes, and reads the pick's outcome from the state.

```ts
const crate = h.snapshot().crates[0];
const on = h.engine.view().project({ x: crate.x, y: crate.y, z: crate.z });
expect(on.visible).toBe(true);

await drag(h, [{ x: on.x, y: on.y }]);

expect(h.snapshot().hook.x).toBeCloseTo(crate.x, 1);
expect(h.snapshot().hook.z).toBeCloseTo(crate.z, 1);
```

The view answers from the camera as it stood at the most recent render, which
is the camera the build's next `update` picks against, so a point projected
after an `advance` and dispatched before the next one lands where the build
expects it.

## Cues

The engine broadcasts `cue:played` for every cue a game plays.
`engine.events.on` returns the function that removes the handler, so a check
collects the cues of one window by subscribing before the act and unsubscribing
after it.

```ts
const cues: string[] = [];
const off = h.engine.events.on("cue:played", ({ cue }) => cues.push(cue));

const crate = h.snapshot().crates[0];
h.setHookPosition(crate.x, crate.y + 2, crate.z);
h.setHookVelocity(0, -4, 0);
await h.engine.advance(45);
off();

expect(cues).toContain("clank");
```

Because the event names the cue, a build that fires its delivery chime on every
grab fails rather than passing on a count. The payload also carries the
simulated time the cue played at and the gain it played at, which places the cue
in the run and distinguishes a muted play from an audible one.

A positional cue carries where it was placed. `cue:played` and `cue:looped`
carry `at`, the world point the build played the cue at as a copy, or `null`
for a cue played without one, so a claim that a sound comes from the hook
rather than from nowhere reads the payload.

```ts
import type { Vec3 } from "@clockwyrks/simple-3d";

const played: { cue: string; at: Vec3 | null }[] = [];
const off = h.engine.events.on("cue:played", ({ cue, at }) =>
  played.push({ cue, at }),
);

const crate = h.snapshot().crates[0];
h.setHookPosition(crate.x, crate.y + 2, crate.z);
h.setHookVelocity(0, -4, 0);
await h.engine.advance(45);
off();

const clank = played.find((event) => event.cue === "clank");
expect(clank?.at).not.toBeNull();
expect(clank?.at?.x).toBeCloseTo(crate.x, 3);
expect(clank?.at?.z).toBeCloseTo(crate.z, 3);
```

The engine reports every play regardless of the unlock state, so a cue check
needs no gesture. Unlocking affects audibility alone, which is outside what a
check asserts on, and so does the distance attenuation a positioned cue plays
under: `gain` is the gain before the panner.

A loop is checked the same way. `cue:looped` is broadcast once when a cue starts
looping and `cue:stopped` once when it ends, so a check that a motor hum starts
with the key and ends with its release subscribes to both and asserts the
order, or reads the bus directly through `looping`. A loop the build moves with
`place` carries the point it started at in `cue:looped`, and a claim about
where it moved to is a claim about the build's `update`, read from the state.

## Other engine events

`asset:loaded`, `asset:failed`, and `audio:unlocked` are subscribed to the same
way. Asset events are most useful around
[`engine.initialize`](/engines/simple-3d/apis/engine/), where a subscription
taken before the call observes the whole of the game's loading.

```ts
const loaded: string[] = [];
engine.events.on("asset:loaded", ({ path }) => loaded.push(path));

await engine.initialize();

expect(loaded).toContain("models/crane.glb");
```
