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
import type { Harness } from "./harness";

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

An event whose `repeat` flag is set arms nothing, so the helpers state it as
`false` and a check drives a sustained action by leaving the key down rather
than by repeating the press. A held key gives an `"analog"` action full
deflection, so a stick layout's directional actions are driven from the
keyboard the same way.

## Driving the pointer

The engine attaches its pointer listeners to the same target, reading
`clientX`, `clientY`, and `isPrimary` off each event. Over a surface with no
`origin`, a dispatched event's client position is read as CSS pixels from the
canvas's top-left corner, and a suite that pins the surface to the stage's own
size at a ratio of `1` dispatches logical coordinates directly.

```ts
import type { Vec2 } from "@test-cabinet/structured-3d";

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): Event {
  return Object.assign(new Event(type), { clientX: x, clientY: y, isPrimary: true });
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

A build picks in the world by turning the pointer into a ray through
`camera.logicalToRay` and casting it, so a check that is about a pick
dispatches the logical point an actor projects to. `world.camera.worldToLogical`
gives that point for the actor's world position, and the check clicks there.

```ts
const target = world.byTag(TAGS.target)[0];
const at = world.camera.worldToLogical(target.transform.position);
await drag(h, [{ x: at.x, y: at.y }]);

expect(target.hasTag(TAGS.selected)).toBe(true);
```

## Holds and taps

A key stays down until a `keyup` arrives, so a hold is a press, some frames, and
a release. A helper that holds an action across a number of frames keeps the
three steps in one place.

```ts
export async function holdFor(
  h: Harness,
  action: string,
  frames: number,
): Promise<void> {
  hold(h, action);
  await h.engine.advance(frames);
  release(h, action);
}
```

```ts
const paddle = world.byTag(TAGS.paddleP1)[0];
const before = paddle.transform.position.y;

await holdFor(h, "p1-up", 36);

expect(paddle.transform.position.y).toBeGreaterThan(before);
```

The world is `+Y` up, so an action that raises a paddle raises its
`position.y`. An edge is armed when an action's value goes from zero to
non-zero, and the engine closes the input frame after the frame renders,
discarding every edge left unconsumed. A tap is therefore a press, exactly one
frame, and a release.

```ts
export async function tap(h: Harness, action: string): Promise<void> {
  await holdFor(h, action, 1);
}
```

## Stating what the player did

A check drives by action name, and `constants.ts` resolves the name to the codes
the case fixed for it. The names and the codes are the case's, so a check states
what the player did and the build's binding is what answers for it. A build that
bound an action to a different key is caught by the check that expected the
action to respond.

The same holds on the reading side. `value(name)` reports `0` or `1` for a
digital action and the magnitude as given for an analog one, and `pressed(name)`
reports the edge, so a claim about a sustained push and a claim about a single
press are separate claims stated in the same vocabulary.

## Edges and the controllers that consume them

Input reaches the simulation through `PlayerController.input` alone. Each player
controller consumes edges independently: an edge is `pressed` exactly once for
each controller that asks, so two controllers bound to one action each see the
press, and the call consumes that controller's copy.

A check that wants to read an action directly adds a controller of its own
through `world.mode.addPlayer` and reads that one, so the build's controllers
keep their own copy of every edge. Reading
`world.players()[0].input.pressed("confirm")` consumes the copy the build's own
controller was going to read.

```ts
const observer = world.mode.addPlayer({ name: "observer", pawn: null });

hold(h, "pause");
await engine.advance(1);

expect(observer.input.pressed("pause")).toBe(true);
expect(world.paused).toBe(true);
release(h, "pause");
```

A press held across several frames arms one edge, so a check that expects two
distinct presses releases between them.

## Cues

The engine broadcasts `cue:played` for every cue a game plays.
`engine.events.on` returns the function that removes the handler, so a check
collects the cues of one window by subscribing before the act and unsubscribing
after it.

```ts
import { BALL_R, CUES, P1_X } from "../../src/constants";

const cues: string[] = [];
const off = engine.events.on("cue:played", ({ cue }) => cues.push(cue));

engine.debug.setBallPosition(
  P1_X + BALL_R,
  paddle.transform.position.y,
  paddle.transform.position.z,
);
engine.debug.setBallVelocity(-20, 0, 0);
await engine.advance(10);
off();

expect(cues).toContain(CUES.paddleHit);
```

Because the event names the cue, a build that fires its scoring blip on every
wall bounce fails rather than passing on a count. The payload also carries the
simulated time the cue played at and the gain it played at, which places the cue
in the run and distinguishes a muted play from an audible one: a play on a muted
bus reports `gain: 0`, and a play on an unmuted bus reports the spec's gain for
a synthesized cue and `1` for a file-backed one, before any distance
attenuation.

A positional cue carries `at`, the world point the build played it from, as a
copy, and an unpositioned cue carries `at: null`. A claim that a sound came from
where it should have is stated as a distance from the actor it belongs to, so a
build that positions every cue at the origin fails while a build that positions
it at the paddle passes at every step size.

```ts
import { VEC3_ZERO, distance, type Vec3 } from "@test-cabinet/structured-3d";

const played: { cue: string; at: Vec3 | null }[] = [];
const off = engine.events.on("cue:played", ({ cue, at }) => played.push({ cue, at }));

engine.debug.setBallVelocity(-20, 0, 0);
await engine.advance(10);
off();

const at = played.filter((p) => p.cue === CUES.paddleHit).map((p) => p.at);
expect(at).toHaveLength(1);
expect(at[0]).not.toBeNull();
expect(distance(at[0] ?? VEC3_ZERO, paddle.transform.position)).toBeLessThan(BALL_R * 2);
```

A cue name carries one source, and playing a cue that was never declared throws,
naming the cue. The engine reports every play regardless of the unlock state, so
a cue check needs no gesture. Unlocking affects audibility, which is outside
what a check asserts on, and so does the panner: the listener
and the attenuation belong to the audio context, and the event carries the
point the build supplied.

A loop is checked the same way. `cue:looped` is broadcast once when a cue starts
looping, carrying `at` as `cue:played` does, and `cue:stopped` once when it
ends, so a check that a thruster hum starts with the key and ends with its
release subscribes to both and asserts the order, or reads the bus directly
through `world.audio.looping`. `place` moves a running loop and emits nothing,
so a claim that a loop followed its actor is a claim about the build's tick
rather than about an event.

## Other engine events

`asset:loaded`, `asset:failed`, and `audio:unlocked` are subscribed to the same
way. Asset events are most useful around
`engine.initialize`, where a subscription
taken before the call observes the instance's own loading and the start level's
`load` together, models and textures alongside images and audio.

```ts
const loaded: string[] = [];
engine.events.on("asset:loaded", ({ path }) => loaded.push(path));

await engine.initialize();

expect(loaded).toContain("models/paddle.glb");
```
