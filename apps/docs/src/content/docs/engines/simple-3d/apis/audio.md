---
title: Audio
---

A game declares its cues once, from
[`InitApi.audio`](/engines/simple-3d/apis/game/), and plays them by name from
`UpdateApi.audio`. A cue is either synthesized from a `CueSpec` or backed by an
audio file, and both play through the same call. The bus is not spatial: a cue
has no position.

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

`load` resolves `path` through the [asset
loader](/engines/simple-3d/apis/assets/), so it follows the same asset root and
the same path rules, and it emits the same `asset:loaded` and `asset:failed`
events. The audio the [asset-generation
tools](/testing/asset-generation/manifests/overview/) produce is loaded this
way.

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

`durationMs` is milliseconds, and the delta time an update receives is seconds.

## Playback

```ts
readonly audio: {
  play(cue: string): void;
  loop(cue: string): void;
  stop(cue: string): void;
  looping(cue: string): boolean;
  setMuted(muted: boolean): void;
  muted(): boolean;
};
```

| Member | Behavior |
| --- | --- |
| `play` | Emits `cue:played` and, when audible, sounds the cue. Returns immediately. |
| `loop` | Starts the cue looping if it is not already: emits `cue:looped` once and, when audible, sounds the cue continuously until stopped. Does nothing for a cue already looping. |
| `stop` | Stops the cue's loop if it is looping and emits `cue:stopped`. Does nothing for a cue that is not looping. |
| `looping` | Whether the cue is looping. `false` for an undeclared cue. |
| `setMuted` | Sets the mute bit. A muted cue still emits its event, and every running loop follows the bit live. |
| `muted` | The mute bit. |

Playback belongs to `update`, so what a frame sounds is decided by the same
function that advanced the simulation.

## Looping

A file-backed cue loops its decoded buffer seamlessly. A synthesized cue holds
its `wave` at `freq` at its `gain` until stopped, with no sweep and no decay. A
cue is either looping or not; `loop` and `stop` each act once per transition
and emit once per transition.

Mute is live: `setMuted(true)` silences every running loop and `setMuted(false)`
restores each one's gain, without stopping or restarting it. A loop started
before the unlock is looping from that call, with its event emitted, and begins
to sound when the gesture opens the context.

Redeclaring a looping cue, through `define` or `load` under the same name,
stops the loop and emits `cue:stopped`. `engine.destroy()` stops every loop.

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

The engine opens the audio context on the first pointer or key event it sees and
emits `audio:unlocked` at that moment. `unlocked` becomes `true` on that gesture
in every browser, including one that then offers no audio context.

## Events

Audio reports itself through the engine's [event
broadcaster](/engines/simple-3d/apis/game/), subscribed with
`api.events.on(name, handler)`.

```ts
"cue:played": { cue: string; t: number; gain: number };
"cue:looped": { cue: string; t: number; gain: number };
"cue:stopped": { cue: string; t: number };
"audio:unlocked": Record<string, never>;
```

| Field | Meaning |
| --- | --- |
| `cue` | The name that was played, started looping, or stopped. |
| `t` | The frame loop's simulated time in milliseconds at that moment. |
| `gain` | The gain it played or started looping at. |

A play or a loop on a muted bus reports `gain: 0`. On an unmuted bus it reports
the spec's `gain` for a synthesized cue and `1` for a file-backed cue.
`cue:looped` is emitted once per loop, when it starts, and `cue:stopped` once,
when it ends.

Handlers run synchronously at the moment of the call, so a subscriber sees the
frame a cue belongs to. Subscribing before
[`engine.initialize`](/engines/simple-3d/apis/engine/) captures the cues a game
plays from its own initialization onward.

## Errors

| Condition | Result |
| --- | --- |
| `play`, `loop`, or `stop` names a cue that was never declared | Throws, naming the cue |
| `looping` names a cue that was never declared | Returns `false` |
| `load` is given a path the asset loader refuses | Rejects with the `resolve` error, and the cue stays undeclared |
| `load` cannot fetch or decode the audio | Rejects with the cause, and the cue stays undeclared |
| No audio context is available | `play` and `loop` emit their events and nothing sounds |
| The audio graph throws during synthesis or a loop | The event is emitted and the frame continues |

## Exports

`CueSpec` and `AudioState` are exported as types from
`@test-cabinet/simple-3d`.
