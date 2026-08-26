# Audio

A game declares its cues from `InitApi.audio` or a level's `LoadApi.audio`, and
plays them by name from `world.audio`. A cue is either synthesized from a
`CueSpec` or backed by an audio file, and both play through the same call. The
bus is **not spatial**: a cue has no position, and a sound that should feel
distant is the game's choice of when to play it.

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

A cue name carries one source, and declaring a name that already exists replaces
what it plays, whichever of the two declared it. Cue definitions belong to the
engine rather than the world, so they survive a level transition: a cue declared
during initialization is playable in every level that follows, and a cue a level
loads stays bound for the rest of the run.

```ts
override async initialize(api: InitApi): Promise<null> {
  api.audio.define("thrust", { wave: "sawtooth", freq: 120, durationMs: 90 });
  api.audio.define("bounce", { wave: "square", freq: 440, durationMs: 60 });
  api.audio.define("victory", {
    wave: "triangle",
    freq: 520,
    freqTo: 880,
    durationMs: 220,
  });
  return null;
}
```

```ts
// In a level's load, for the file-backed cues that level needs:
await api.audio.load("explosion", "audio/explosion.wav");
```

`load` resolves `path` through the asset loader, so it follows the same asset
root and path rules and emits the same `asset:loaded` and `asset:failed` events.

**Decoding needs no audio context.** A file-backed cue is a PCM WAV — the
container the asset-generation tools produce — and the engine decodes it itself,
so `load` resolves once the cue is decoded and `assets.loadAudio` resolves the
decoded buffer whether or not a context exists. Headless, that buffer is an
`AudioBuffer`-shaped value carrying the channel data, sample rate, and duration,
so a suite awaits the same promises a browser build does and nothing sounds.

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
interface WorldAudio {
  play(cue: string): void;
  loop(cue: string): void;
  stop(cue: string): void;
  looping(cue: string): boolean;
  setMuted(muted: boolean): void;
  muted(): boolean;
}
```

| Member | Behavior |
| --- | --- |
| `play` | Emits `cue:played` and, when audible, sounds the cue. Returns immediately. |
| `loop` | Starts the cue looping if it is not already: emits `cue:looped` once and, when audible, sounds the cue continuously until stopped. Does nothing for a cue already looping. |
| `stop` | Stops the cue's loop if it is looping and emits `cue:stopped`. Does nothing for a cue that is not looping. |
| `looping` | Whether the cue is looping. `false` for an undeclared cue. |
| `setMuted` | Sets the mute bit. A muted cue still emits its event, and every running loop follows the bit live. |
| `muted` | The mute bit. |

Playback belongs to a tick, so what a frame sounds is decided by the same code
that advanced the simulation. An actor, a component, a controller, and a game
mode all reach the bus through the world they belong to.

```ts
override tick(dt: number): void {
  this.transform.position.x += this.vx * dt;
  if (Math.abs(this.transform.position.x) > ARENA.half) {
    this.vx = -this.vx;
    this.world.audio.play("bounce");
  }
}
```

Playing a name that was never defined or loaded throws, so the run itself is
what catches a typo.

## Looping

A file-backed cue loops its decoded buffer seamlessly. A synthesized cue holds
its `wave` at `freq` at its `gain` until stopped, with no sweep and no decay. A
cue is either looping or not; `loop` and `stop` each act once per transition and
emit once per transition — so drive a loop from the object's state on every tick
rather than tracking whether it was started:

```ts
override tick(dt: number): void {
  if (this.thrusting) this.world.audio.loop("thrust");
  else this.world.audio.stop("thrust");
  this.integrate(dt);
}
```

Mute is live: `setMuted(true)` silences every running loop and `setMuted(false)`
restores each one's gain, without stopping or restarting it. A loop started
before the unlock is looping from that call, with its event emitted, and begins
to sound when the gesture opens the context.

Loops belong to the engine with the cue definitions, so a loop started in one
level keeps running across a transition until a tick stops it. Redeclaring a
looping cue, through `define` or `load` under the same name, stops the loop and
emits `cue:stopped`. `engine.destroy()` stops every loop.

## Muting

Every touch layout carries a `mute` action. Read it from a player controller and
drive the bus from there:

```ts
override tick(): void {
  if (this.input.pressed("mute")) {
    this.world.audio.setMuted(!this.world.audio.muted());
  }
}
```

A muted cue still plays in every sense but audibility: the call succeeds and the
`cue:played` event still fires, at a gain of zero.

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

The engine opens the audio context on the first `pointerdown` or `keydown` event
it sees and emits `audio:unlocked` at that moment. Mute is read through
`muted()` and the unlock is observed through the event.

## Events

Audio reports itself through the engine's broadcaster, subscribed with
`events.on(name, handler)`.

```ts
"cue:played": { cue: string; t: number; gain: number };
"cue:looped": { cue: string; t: number; gain: number };
"cue:stopped": { cue: string; t: number };
"audio:unlocked": Record<string, never>;
```

| Field | Meaning |
| --- | --- |
| `cue` | The name that was played, started looping, or stopped. |
| `t` | The frame loop's accumulated simulated time in milliseconds at that moment. |
| `gain` | The gain it played or started looping at. |

A play or a loop on a muted bus reports `gain: 0`. On an unmuted bus it reports
the spec's `gain` for a synthesized cue and `1` for a file-backed cue.
`cue:looped` is emitted once per loop, when it starts, and `cue:stopped` once,
when it ends. A cue played from the game instance's `initialize`, before any
frame has run, carries `t: 0`.

Handlers run synchronously at the moment of the call, so a subscriber sees the
frame a cue belongs to. The broadcaster lives on the engine, so a subscription
made before `engine.initialize` captures the cues a game plays from its start
level onward and across every transition.

## Errors

| Condition | Result |
| --- | --- |
| `play`, `loop`, or `stop` names a cue that was never declared | Throws, naming the cue |
| `looping` names a cue that was never declared | Returns `false` |
| `load` is given a path the asset loader refuses | Rejects with the `resolve` error, and the cue stays undeclared |
| `load` cannot fetch or decode the audio | Rejects with the cause, and the cue stays undeclared |
| `load` rejects inside the instance's `initialize` or the start level's `load` | `engine.initialize` rejects with the cause |
| No audio context is available | `play` and `loop` emit their events and nothing sounds |
| The audio graph throws during synthesis or a loop | The event is emitted and the frame continues |
