---
title: Audio
---

A game declares its cues from
[`InitApi.audio`](/engines/structured-2d/apis/game-instance/) or a level's
`LoadApi.audio`, and plays them by name from
[`world.audio`](/engines/structured-2d/apis/worlds/). A cue is either
synthesized from a `CueSpec` or backed by an audio file, and both play through
the same call.

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
loader](/engines/structured-2d/apis/assets/), so it follows the same asset root
and the same path rules, and it emits the same `asset:loaded` and
`asset:failed` events. The audio the [asset-generation
tools](/testing/asset-generation/manifests/overview/) produce is loaded this
way.

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
| `freq` | hertz | required | The starting frequency. |
| `freqTo` | hertz | `freq` | The frequency swept to linearly across the duration. |
| `gain` | `0`–`1` | `0.2` | The peak gain the envelope decays from. |
| `durationMs` | milliseconds | required | How long the cue sounds. |

`durationMs` is milliseconds, and the delta time a `tick` receives is seconds.

## Playback

```ts
interface WorldAudio {
  play(cue: string): void;
  setMuted(muted: boolean): void;
  muted(): boolean;
}
```

| Member | Behavior |
| --- | --- |
| `play` | Emits `cue:played` and, when audible, sounds the cue. Returns immediately. |
| `setMuted` | Sets the mute bit. A muted cue still emits its event. |
| `muted` | The mute bit. |

Playback belongs to a tick, so what a frame sounds is decided by the same code
that advanced the simulation. An actor, a component, a controller, and a game
mode all reach the bus through the world they belong to.

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
emits `audio:unlocked` at that moment.

## Events

Audio reports itself through the engine's [event
broadcaster](/engines/structured-2d/apis/engine/), subscribed with
`events.on(name, handler)`.

```ts
"cue:played": { cue: string; t: number; gain: number };
"audio:unlocked": Record<string, never>;
```

| Field | Meaning |
| --- | --- |
| `cue` | The name that was played. |
| `t` | The frame loop's accumulated simulated time in milliseconds when it played. |
| `gain` | The gain it played at. |

A play on a muted bus reports `gain: 0`. A play on an unmuted bus reports the
spec's `gain` for a synthesized cue and `1` for a file-backed cue.

Handlers run synchronously at the moment of the play, so a subscriber sees the
frame a cue belongs to. The broadcaster lives on the engine, so a subscription
made before [`engine.initialize`](/engines/structured-2d/apis/engine/) captures
the cues a game plays from its start level onward and across every transition.

## Errors

| Condition | Result |
| --- | --- |
| `play` names a cue that was never declared | Throws, naming the cue |
| `load` is given a path the asset loader refuses | Rejects with the `resolve` error, and the cue stays undeclared |
| `load` cannot fetch or decode the audio | Rejects with the cause, and the cue stays undeclared |
| `load` rejects inside the instance's `initialize` or the start level's `load` | `engine.initialize` rejects with the cause |

## Exports

`CueSpec`, `AudioState`, and `WorldAudio` are exported as types from
`@test-cabinet/structured-2d`.
