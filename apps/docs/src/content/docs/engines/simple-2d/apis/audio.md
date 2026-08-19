---
title: Audio
---

The audio bus is reached as `engine.audio`. It is the only audio surface the
engine exposes; a build never constructs one.

## AudioBus

```ts
define(cue: string, spec: CueSpec): void;
play(cue: string): void;
setMuted(muted: boolean): void;
muted(): boolean;
state(): AudioState;
log(): CueEvent[];
unlock(): void;
now(): number;
```

| Member | Behaviour |
| --- | --- |
| `define` | Declares `spec` under `cue`. A name that already exists is replaced. |
| `play` | Records the cue and, when audible, synthesizes it. Returns immediately. Throws when `cue` was never defined. |
| `setMuted` | Sets the mute bit. Muted cues are still accepted and recorded. |
| `muted` | The mute bit. |
| `state` | Both observable bits as an `AudioState`. |
| `log` | Every cue played, oldest first, as a copy the caller owns. |
| `unlock` | Opens the audio context. Idempotent, and must be called from a user gesture. The engine calls it from the first pointer or key event on the document. |
| `now` | The clock the log is stamped against, in milliseconds. The engine points it at the frame loop's simulated time. |

## CueSpec

```ts
interface CueSpec {
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  freq: number;
  freqTo?: number;
  gain?: number;
  durationMs: number;
}
```

| Field | Type | Unit | Default | Meaning |
| --- | --- | --- | --- | --- |
| `wave` | `"sine" \| "square" \| "sawtooth" \| "triangle"` | — | `"sine"` | The oscillator waveform. |
| `freq` | `number` | hertz | required | The starting frequency. |
| `freqTo` | `number` | hertz | `freq` | The frequency swept to linearly across the duration. |
| `gain` | `number` | `0`–`1` | `0.2` | The peak gain the envelope decays from. |
| `durationMs` | `number` | milliseconds | required | How long the cue sounds. |

`durationMs` is milliseconds, unlike the frame callback's delta time, which is
seconds.

## CueEvent

```ts
interface CueEvent {
  cue: string;
  t: number;
  gain: number;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `cue` | `string` | The name that was played. |
| `t` | `number` | The frame loop's simulated time in milliseconds when it played. |
| `gain` | `number` | The gain it played at. |

A play on a muted bus appends an entry with `gain: 0`. A play on an unmuted bus
appends the spec's `gain`, or `0.2` when the spec names none.

## AudioState

```ts
interface AudioState {
  muted: boolean;
  unlocked: boolean;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `muted` | `boolean` | Whether the bus is muted. |
| `unlocked` | `boolean` | Whether a user gesture has unlocked the audio context. |

`unlocked` becomes `true` on the first gesture the engine sees, including in a
browser that then offers no audio context.

## Errors

| Condition | Result |
| --- | --- |
| `play` names a cue that was never defined | Throws. |
| No audio context is available | The cue is recorded and nothing sounds. |
| The audio graph throws during synthesis | The cue is recorded and the frame continues. |

## Exports

`CueSpec`, `CueEvent` and `AudioState` are exported as types from
`@test-cabinet/simple-2d`. `AudioBus` is exported as a type only, since the
engine constructs the bus.
