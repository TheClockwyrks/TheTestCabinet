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

## Holds and taps

A key stays down until a `keyup` arrives, so a hold is a press, some frames, and
a release.

```ts
hold(h, "p1-up");
await engine.advance(36);
release(h, "p1-up");

expect(state.left.cy).toBeLessThan(FIELD_H / 2);
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

## Cues

The engine broadcasts `cue:played` for every cue a game plays.
`engine.events.on` returns the function that removes the handler, so a check
collects the cues of one window by subscribing before the act and unsubscribing
after it.

```ts
const cues: string[] = [];
const off = engine.events.on("cue:played", ({ cue }) => cues.push(cue));

setBall(state, { x: P1_X1 + BALL_R, y: state.left.cy, vx: -600, vy: 0 });
await engine.advance(10);
off();

expect(cues).toContain("paddle-hit");
```

Because the event names the cue, a build that fires its scoring blip on every
wall bounce fails rather than passing on a count. The payload also carries the
simulated time the cue played at and the gain it played at, which places the cue
in the run and distinguishes a muted play from an audible one.

The engine reports every play regardless of the unlock state, so a cue check
needs no gesture. Unlocking affects audibility, which a suite running in process
has nothing to observe.

## Other engine events

`asset:loaded`, `asset:failed`, and `audio:unlocked` are subscribed to the same
way. Asset events are most useful around
[`engine.initialize`](/engines/simple-2d/apis/engine/), where a subscription
taken before the call observes the whole of the game's loading.

```ts
const loaded: string[] = [];
engine.events.on("asset:loaded", ({ path }) => loaded.push(path));

await engine.initialize();

expect(loaded).toContain("sprites/paddles.png");
```
