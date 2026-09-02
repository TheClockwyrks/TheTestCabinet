# Audio

A game declares its cues once, from `InitApi.audio` inside `initialize`, and
plays them by name from `UpdateApi.audio` inside `update`. A cue is either
synthesized from a `CueSpec` or backed by an audio file, and both play through
the same call — unpositioned, or placed at a world point and heard from where
the camera stands.

```ts
// In initialize:
api.audio.define(cue: string, spec: CueSpec): void;
api.audio.load(cue: string, path: string): Promise<void>;

// In update:
api.audio.play(cue: string, options?: PlayOptions): void;
api.audio.loop(cue: string, options?: PlayOptions): void;
api.audio.stop(cue: string): void;
api.audio.place(cue: string, at: Vec3): void;
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

| Field | Unit | Default | Meaning |
| --- | --- | --- | --- |
| `wave` | — | `"sine"` | The oscillator waveform. |
| `freq` | hertz | required | The starting frequency. A loop holds it. |
| `freqTo` | hertz | `freq` | The frequency swept to linearly across the duration. A loop ignores it. |
| `gain` | `0`–`1` | `0.2` | The peak gain the envelope decays from. A loop holds it. |
| `durationMs` | milliseconds | required | How long the cue sounds. A loop ignores it. |

```ts
initialize(api) {
  api.audio.define("clank", { freq: 440, freqTo: 220, durationMs: 80 });
  api.audio.define("motor", { wave: "sawtooth", freq: 90, durationMs: 200, gain: 0.15 });
  return [openingState(), null];
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
  api.audio.define("clank", { freq: 440, durationMs: 80 });
  await api.audio.load("theme", "audio/theme.ogg");
  return [openingState(), null];
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
  if (y <= 0) {
    api.audio.play("clank", { at: { x: state.x, y: 0, z: state.z } });
    return { ...state, y: 0, vy: -state.vy * 0.5 };
  }
  return { ...state, y, vy: state.vy - GRAVITY * dt };
}
```

`play` returns immediately. It emits `cue:played` and, when audible, sounds the
cue.

`setMuted(true)` silences the bus. A muted cue still emits its event, at
`gain: 0`, so a build that reacted while muted stays distinguishable from one
that never reacted.

## Positional playback

```ts
interface PlayOptions {
  at?: Vec3;
}
```

A cue played or looped with `at` is **positioned**: it is routed through a
panner at that world point and heard from where the camera stands. A cue played
without `at` is unpositioned and plays at the bus's gain with no panning, which
is right for a confirmation beep that belongs to no place at all. The
distinction is per playback rather than per cue, so one declared sound serves
both.

| Panner setting | Value |
| --- | --- |
| Distance model | `inverse` |
| Reference distance | `1` |
| Rolloff factor | `1` |
| Maximum distance | `10000` |
| Panning model | HRTF |

The listener is the camera as it stood at the most recent render, and the engine
updates its position and orientation every frame, so **a game poses the ear by
posing the eye**: a loop placed at a fixed point moves across the stereo field
as the camera turns. A positioned one-shot keeps the point it was played at for
its duration; `place` moves a positioned loop, and a loop started without `at`
stays unpositioned for its life.

```ts
api.audio.play("clank", { at: state.hook });
api.audio.loop("motor", { at: state.crane });
api.audio.place("motor", state.crane);
```

## Looping

`loop` starts a cue sounding continuously and `stop` ends it. A file-backed cue
loops its decoded buffer seamlessly. A synthesized cue holds its `wave` at
`freq` at its `gain` until stopped, with no sweep and no decay. A cue is either
looping or not, so `loop` on a cue that is already looping does nothing and
`stop` on one that is not looping does nothing.

```ts
update(state, api, dt) {
  const hoisting = api.input.value("hoist") > 0;
  if (hoisting && !api.audio.looping("motor")) {
    api.audio.loop("motor", { at: state.crane });
  }
  if (hoisting) api.audio.place("motor", state.crane);
  if (!hoisting) api.audio.stop("motor");
  return step(state, dt);
}
```

`loop` emits `cue:looped` once, when the loop starts, and `stop` emits
`cue:stopped` once, when it ends. `looping` reports whether the cue is looping
and is `false` for a name that was never declared.

Mute is live. `setMuted(true)` silences every running loop and `setMuted(false)`
restores each one's gain, without stopping or restarting either. Redeclaring a
looping cue, with `define` or `load` under the same name, stops the loop and
emits `cue:stopped`. `engine.destroy()` stops every loop.

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
the gesture is announced and simply sounds nothing, and a loop started before it
is looping from that call and begins to sound when the gesture opens the
context.

## Events

Audio reports itself through the engine's event broadcaster, subscribed with
`api.events.on(name, handler)` in `initialize` or with `engine.events.on` before
initialization.

```ts
"cue:played": { cue: string; t: number; gain: number; at: Vec3 | null };
"cue:looped": { cue: string; t: number; gain: number; at: Vec3 | null };
"cue:stopped": { cue: string; t: number };
"audio:unlocked": Record<string, never>;
```

| Field | Meaning |
| --- | --- |
| `cue` | The name that was played, started looping, or stopped. |
| `t` | The frame loop's simulated time in milliseconds at that moment. |
| `gain` | The gain it played or started looping at. |
| `at` | The world point it was placed at, as a copy, or `null` for an unpositioned cue. |

A play or a loop on a muted bus reports `gain: 0`. On an unmuted bus it reports
the spec's `gain` for a synthesized cue and `1` for a file-backed cue, before
any distance attenuation the panner applies.

`t` is frame time rather than wall time, so a cue's stamp lines up with the
`frame().timeMs` a check asserts against. Handlers run synchronously at the
moment of the play, so a subscriber sees the frame a cue belongs to.

`on` returns the function that removes the handler. Nothing accumulates a record
of the cues a run played: a subscriber keeps exactly what it decided was worth
keeping.

```ts
const played: string[] = [];
const off = engine.events.on("cue:played", (event) => played.push(event.cue));
```

## Errors

| Condition | Result |
| --- | --- |
| `play`, `loop`, `stop`, or `place` names a cue that was never declared | Throws, naming the cue |
| `looping` names a cue that was never declared | Returns `false` |
| `load` is given a path the asset loader refuses | Rejects with the `resolve` error, and the cue stays undeclared |
| `load` cannot fetch or decode the audio | Rejects with the cause, and the cue stays undeclared |
| No audio context is available | `play` and `loop` emit their events and nothing sounds |
| The audio graph throws during synthesis, a loop, or a placement | The event is emitted and the frame continues |

Naming an undeclared cue throws because silence is the expected outcome of a
muted or still-locked bus, so a typo'd name would otherwise disappear into the
same silence and survive the run unnoticed. Nothing else about audio can fail a
frame.
