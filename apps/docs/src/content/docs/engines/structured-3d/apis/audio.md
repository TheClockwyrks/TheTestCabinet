---
title: Audio
---

A game declares its cues from
[`InitApi.audio`](/engines/structured-3d/apis/game-instance/) or a level's
`LoadApi.audio`, and plays them by name from
[`world.audio`](/engines/structured-3d/apis/worlds/). A cue is either
synthesized from a `CueSpec` or backed by an audio file, and both play through
the same call. A cue played with a position sounds from that point in the world,
heard from the camera.

## Declaring cues

```ts
readonly audio: {
  define(cue: string, spec: CueSpec): void;
  load(cue: string, path: string): Promise<void>;
};
```

| Member | Behavior |
| --- | --- |
| `define` | Binds `cue` to a synthesized `spec`. |
| `load` | Fetches and decodes the audio at `path` and binds the result to `cue`. Resolves once the cue is playable. |

A cue name carries one source. Declaring a name that already exists replaces
what it plays, whichever of the two declared it.

Cue definitions belong to the engine rather than the world, so they survive a
level transition. A cue declared during initialization is playable in every
level that follows.

`load` resolves `path` through the [asset
loader](/engines/structured-3d/apis/assets/), so it follows the same asset root
and the same path rules, and it emits the same `asset:loaded` and
`asset:failed` events. The audio the asset-generation tools produce is loaded
this way.

## Cues a level declares

A level declares the cues it alone needs from its `load`, which the engine
awaits before the world is built.

```ts
readonly audio: {
  load(cue: string, path: string): Promise<void>;
};
```

`LoadApi.audio` carries `load`. Synthesized cues are defined once, from the game
instance's `initialize`, where they outlive every transition.

## `CueSpec`

```ts
interface CueSpec {
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  freq: number;
  freqTo?: number;
  gain?: number;
  durationMs: number;
}
```

| Field | Unit | Default | Meaning |
| --- | --- | --- | --- |
| `wave` | — | `"sine"` | The oscillator waveform. |
| `freq` | hertz | required | The starting frequency. A loop holds it. |
| `freqTo` | hertz | `freq` | The frequency swept to linearly across the duration. A loop ignores it. |
| `gain` | `0`–`1` | `0.2` | The peak gain the envelope decays from. A loop holds it. |
| `durationMs` | milliseconds | required | How long the cue sounds. A loop ignores it. |

`durationMs` is milliseconds, and the delta time a `tick` receives is seconds.

## Playback

```ts
interface PlayOptions {
  at?: Vec3;
}

interface WorldAudio {
  play(cue: string, options?: PlayOptions): void;
  loop(cue: string, options?: PlayOptions): void;
  stop(cue: string): void;
  place(cue: string, at: Vec3): void;
  looping(cue: string): boolean;
  setMuted(muted: boolean): void;
  muted(): boolean;
}
```

| Member | Behavior |
| --- | --- |
| `play` | Emits `cue:played` and, when audible, sounds the cue. Returns immediately. With `at`, the cue sounds from that world point. |
| `loop` | Starts the cue looping if it is not already: emits `cue:looped` once and, when audible, sounds the cue continuously until stopped. Does nothing for a cue already looping. With `at`, the loop sounds from that world point until it is placed elsewhere. |
| `stop` | Stops the cue's loop if it is looping and emits `cue:stopped`. Does nothing for a cue that is not looping. |
| `place` | Moves the cue's running loop to `at`. Does nothing for a cue that is not looping. |
| `looping` | Whether the cue is looping. `false` for an undeclared cue. |
| `setMuted` | Sets the mute bit. A muted cue still emits its event, and every running loop follows the bit live. |
| `muted` | The mute bit. |

Playback belongs to a tick, so what a frame sounds is decided by the same code
that advanced the simulation. An actor, a component, a controller, and a game
mode all reach the bus through the world they belong to.

## Positional playback

`PlayOptions.at` is a world point in the same units and axes as an actor's
`Transform.position`. A cue played or
looped with `at` is routed through a panner with the `inverse` distance model,
a `refDistance` of `1`, a `rolloffFactor` of `1`, a `maxDistance` of `10000`,
and HRTF panning, so a cue one world unit from the listener sounds at its full
gain and a cue farther away sounds quieter and from its direction. A cue played
without `at` is unpositioned.

The listener is the camera as it stood at the most recent render. The engine
writes the camera's world position and orientation onto the listener every
frame, so a positioned loop tracks a moving camera without the game touching
it, and a loop that follows a moving actor is moved with `place` from that
actor's tick. `place` sets the position a loop sounds from whether or not the
loop was started with one; the position holds until the next `place` or until
the loop stops.

```ts
class Drone extends Actor {
  beginPlay(): void {
    this.world.audio.loop("hum", { at: this.transform.position });
  }

  tick(dt: number): void {
    this.world.audio.place("hum", this.transform.position);
  }

  endPlay(): void {
    this.world.audio.stop("hum");
  }
}
```

## Looping

A file-backed cue loops its decoded buffer seamlessly. A synthesized cue holds
its `wave` at `freq` at its `gain` until stopped, with no sweep and no decay. A
cue is either looping or not; `loop` and `stop` each act once per transition
and emit once per transition.

Mute is live: `setMuted(true)` silences every running loop and `setMuted(false)`
restores each one's gain, without stopping or restarting it. A loop started
before the unlock is looping from that call, with its event emitted, and begins
to sound when the gesture opens the context.

Loops belong to the engine with the cue definitions, so a loop started in one
level keeps running across a transition until a tick stops it. A positioned loop
keeps its position across the transition and is heard from the new world's
camera. Redeclaring a looping cue, through `define` or `load` under the same
name, stops the loop and emits `cue:stopped`. `engine.destroy()` stops every
loop.

## `AudioState`

```ts
interface AudioState {
  muted: boolean;
  unlocked: boolean;
}
```

| Field | Meaning |
| --- | --- |
| `muted` | Whether the bus is muted. |
| `unlocked` | Whether a user gesture has opened the audio context. |

The engine opens the audio context on the first pointerdown or keydown event it
sees and emits `audio:unlocked` at that moment.

## Events

Audio reports itself through the engine's [event
broadcaster](/engines/structured-3d/apis/engine/), subscribed with
`events.on(name, handler)`.

```ts
"cue:played": { cue: string; t: number; gain: number; at: Vec3 | null };
"cue:looped": { cue: string; t: number; gain: number; at: Vec3 | null };
"cue:stopped": { cue: string; t: number };
"audio:unlocked": Record<string, never>;
```

| Field | Meaning |
| --- | --- |
| `cue` | The name that was played, started looping, or stopped. |
| `t` | The frame loop's accumulated simulated time in milliseconds at that moment. |
| `gain` | The gain it played or started looping at. |
| `at` | The world point the call gave, as a copy, or `null` for an unpositioned play or loop. |

A play or a loop on a muted bus reports `gain: 0`. On an unmuted bus it reports
the spec's `gain` for a synthesized cue and `1` for a file-backed cue, before
any distance attenuation. `cue:looped` is emitted once per loop, when it
starts, and `cue:stopped` once, when it ends; `place` emits nothing.

Handlers run synchronously at the moment of the call, so a subscriber sees the
frame a cue belongs to. The broadcaster lives on the engine, so a subscription
made before [`engine.initialize`](/engines/structured-3d/apis/engine/) captures
the cues a game plays from its start level onward and across every transition.

## Errors

| Condition | Result |
| --- | --- |
| `play`, `loop`, `stop`, or `place` names a cue that was never declared | Throws, naming the cue |
| `looping` names a cue that was never declared | Returns `false` |
| `load` is given a path the asset loader refuses | Rejects with the `resolve` error, and the cue stays undeclared |
| `load` cannot fetch or decode the audio | Rejects with the cause, and the cue stays undeclared |
| `load` rejects inside the instance's `initialize` or the start level's `load` | `engine.initialize` rejects with the cause |

## Exports

`CueSpec`, `PlayOptions`, `AudioState`, and `WorldAudio` are exported as types
from `@clockwyrks/structured-3d`.
