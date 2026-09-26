# Audio

A game declares its cues once, from `InitApi.audio` inside `initialize`, and
plays them by name from `UpdateApi.audio` inside `update`. A cue is either
synthesized from a `CueSpec` or backed by an audio file, and both play through
the same call.

```ts
// In initialize:
api.audio.define(cue: string, spec: CueSpec): void;
api.audio.load(cue: string, path: string): Promise<void>;

// In update:
api.audio.play(cue: string): void;
api.audio.loop(cue: string): void;
api.audio.stop(cue: string): void;
api.audio.looping(cue: string): boolean;
api.audio.setMuted(muted: boolean): void;
api.audio.muted(): boolean;
```

## Declaring cues

```ts
interface CueSpec {
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  freq: number;
  freqTo?: number;
  gain?: number;
  durationMs: number;
}
```

| Field        | Unit         | Default  | Meaning                                                                 |
| ------------ | ------------ | -------- | ----------------------------------------------------------------------- |
| `wave`       | —            | `"sine"` | The oscillator waveform.                                                |
| `freq`       | hertz        | required | The starting frequency. A loop holds it.                                |
| `freqTo`     | hertz        | `freq`   | The frequency swept to linearly across the duration. A loop ignores it. |
| `gain`       | `0`–`1`      | `0.2`    | The peak gain the envelope decays from. A loop holds it.                |
| `durationMs` | milliseconds | required | How long the cue sounds. A loop ignores it.                             |

```ts
initialize(api) {
  api.audio.define("bounce", { freq: 440, freqTo: 220, durationMs: 80 });
  api.audio.define("score", { wave: "square", freq: 660, durationMs: 120, gain: 0.15 });
  return [{ /* ... */ }, null];
}
```

`durationMs` is milliseconds, and the delta time an update receives is seconds.

A cue name carries one source. Declaring a name that already exists replaces
what it plays, whichever of the two declared it, so swapping a placeholder bleep
for a produced clip is a change to the declaration alone.

## File-backed cues

`load` fetches and decodes audio through the asset loader and binds the result
to a cue name. It resolves once the cue is playable:

```ts
async initialize(api) {
  api.audio.define("bounce", { freq: 440, durationMs: 80 });
  await api.audio.load("theme", "audio/theme.ogg");
  return [{ /* ... */ }, null];
}
```

`load` resolves the path through the asset loader, so it follows the same asset
root and the same path rules and emits the same `asset:loaded` and
`asset:failed` events. The name is bound only after the decode succeeds, so a
load that failed leaves the name exactly as it was.

## Playback

Playback belongs to `update`, so what a frame sounds is decided by the same
function that advanced the simulation:

```ts
update(state, api, dt) {
  const y = state.y + state.vy * dt;
  if (y > FLOOR) {
    api.audio.play("bounce");
    return { ...state, y, vy: -state.vy };
  }
  return { ...state, y };
}
```

`play` returns immediately. It emits `cue:played` and, when audible, sounds the
cue.

`setMuted(true)` silences the bus. A muted cue still emits its event, at
`gain: 0`, so a build that reacted while muted stays distinguishable from one
that never reacted.

## Looping

`loop` starts a cue sounding continuously and `stop` ends it. A file-backed cue
loops its decoded buffer seamlessly. A synthesized cue holds its `wave` at
`freq` at its `gain` until stopped, with no sweep and no decay. A cue is either
looping or not, so `loop` on a cue that is already looping does nothing, and
`stop` on a cue that is not looping does nothing.

```ts
update(state, api, dt) {
  const thrusting = api.input.value("thrust") > 0;
  if (thrusting && !api.audio.looping("engine")) api.audio.loop("engine");
  if (!thrusting) api.audio.stop("engine");
  return { ...state, thrusting };
}
```

`loop` emits `cue:looped` once, when the loop starts, and `stop` emits
`cue:stopped` once, when it ends. `looping` reports whether the cue is looping
and is `false` for a name that was never declared.

Mute is live. `setMuted(true)` silences every running loop and `setMuted(false)`
restores each one's gain, without restarting either. A loop started before the
unlock is looping from that call, its event already emitted, and it begins to
sound the moment the gesture opens the context.

Redeclaring a looping cue, with `define` or `load` under the same name, stops
the loop and emits `cue:stopped`. `engine.destroy()` stops every loop.

## The unlock

Browsers refuse to start audio before a user gesture. The engine opens the audio
context on the first pointer or key event it sees and emits `audio:unlocked` at
that moment.

```ts
interface AudioState {
  muted: boolean;
  unlocked: boolean;
}
```

`unlocked` becomes `true` on that gesture in every browser, including one that
then offers no audio context. A game needs no code for this; a cue played before
the gesture is announced and simply sounds nothing.

## Events

Audio reports itself through the engine's event broadcaster, subscribed with
`api.events.on(name, handler)` in `initialize` or with `engine.events.on` before
initialization.

```ts
"cue:played": { cue: string; t: number; gain: number };
"cue:looped": { cue: string; t: number; gain: number };
"cue:stopped": { cue: string; t: number };
"audio:unlocked": Record<string, never>;
```

| Field  | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| `cue`  | The name that was played, started looping, or stopped.          |
| `t`    | The frame loop's simulated time in milliseconds at that moment. |
| `gain` | The gain it played or started looping at.                       |

A play or a loop on a muted bus reports `gain: 0`. On an unmuted bus it reports
the spec's `gain` for a synthesized cue and `1` for a file-backed cue.
`cue:looped` is emitted once per loop, when it starts, and `cue:stopped` once,
when it ends.

`t` is frame time rather than wall time, so a cue's stamp lines up with the
frame counter. Handlers run synchronously at the moment of the play, so a
subscriber sees the frame a cue belongs to.

`on` returns the function that removes the handler. Nothing accumulates a record
of the cues a run played: a subscriber keeps exactly what it decided was worth
keeping.

```ts
const played: string[] = [];
const off = engine.events.on("cue:played", (event) => played.push(event.cue));
```

## Errors

| Condition                                                     | Result                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| `play`, `loop`, or `stop` names a cue that was never declared | Throws, naming the cue                                         |
| `looping` names a cue that was never declared                 | Returns `false`                                                |
| `load` is given a path the asset loader refuses               | Rejects with the `resolve` error, and the cue stays undeclared |
| `load` cannot fetch or decode the audio                       | Rejects with the cause, and the cue stays undeclared           |
| No audio context is available                                 | `play` and `loop` emit their events and nothing sounds         |
| The audio graph throws during synthesis or a loop             | The event is emitted and the frame continues                   |

Playing, looping, or stopping an undeclared cue throws because silence is the
expected outcome of a muted or still-locked bus, so a typo'd name would otherwise
disappear into the same silence and survive the run unnoticed. Nothing else
about audio can fail a frame.
