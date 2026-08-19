# Audio

The engine synthesizes sound. A game declares a cue once and plays it by name;
it never touches an `AudioContext`, an oscillator, or the browser's autoplay
policy.

```ts
engine.audio.define(cue: string, spec: CueSpec): void;
engine.audio.play(cue: string): void;
engine.audio.setMuted(muted: boolean): void;
engine.audio.muted(): boolean;
engine.audio.state(): AudioState;
engine.audio.log(): CueEvent[];
```

## Defining a cue

```ts
interface CueSpec {
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  freq: number;
  freqTo?: number;
  gain?: number;
  durationMs: number;
}
```

| Field | Unit | Meaning |
| --- | --- | --- |
| `wave` | — | Oscillator waveform. Defaults to `"sine"`. |
| `freq` | hertz | Starting frequency. Required. |
| `freqTo` | hertz | Frequency swept to across the duration. Absent holds `freq`. |
| `gain` | `0`–`1` | Peak gain. Defaults to `0.2`. |
| `durationMs` | milliseconds | How long the cue sounds. Required. |

`durationMs` is milliseconds, unlike the frame's `dt`.

One oscillator through one gain node produces the sound: the frequency ramps
linearly from `freq` to `freqTo` while the gain decays to silence over
`durationMs`. That is the whole synthesis model, and it covers the bleeps a 2D
game needs.

```ts
engine.audio.define("bounce", { wave: "square", freq: 440, durationMs: 60 });
engine.audio.define("score", {
  wave: "triangle",
  freq: 520,
  freqTo: 880,
  durationMs: 220,
});
engine.audio.define("lose", {
  wave: "sawtooth",
  freq: 300,
  freqTo: 90,
  gain: 0.3,
  durationMs: 400,
});
```

Defining a name that already exists replaces its spec, so a cue can be retuned
mid-run.

Define every cue during setup, before the first frame.

## Playing

```ts
if (ball.x < 0) {
  lives -= 1;
  engine.audio.play("lose");
}
```

`play` is safe to call from `update`, several times per frame, and while muted.
It returns immediately; nothing about audio blocks a frame.

Playing a cue that was never defined **throws**. Silence is the expected result
of a muted or still-locked bus, so a mistyped name would otherwise vanish into
the same silence and never be noticed.

## Mute

```ts
engine.audio.setMuted(true);
const isMuted = engine.audio.muted();
```

A muted cue still plays in every sense except audibility: the call succeeds and
the cue is recorded, at a gain of `0`. Wiring the menu vocabulary's `mute`
action to the bus is one line:

```ts
if (engine.input.pressed("mute")) engine.audio.setMuted(!engine.audio.muted());
```

## The unlock is the engine's job

Browsers refuse to start audio outside a user gesture. The engine listens for
the first pointer or key event on the document and opens the audio context
there, once. The game does nothing: no gesture handler, no "click to enable
sound" screen, no resume call.

Cues played before that first gesture succeed and are recorded; they are simply
inaudible, because no browser would have played them either.

```ts
interface AudioState {
  muted: boolean;
  unlocked: boolean;
}
```

`state()` reports both bits. `unlocked` is separate from `muted` because a
silent game may be silent for either reason.

A browser with no audio support at all degrades to a bus that records cues and
plays nothing. Audio never fails a frame.

## The cue log

```ts
interface CueEvent {
  cue: string;   // the name played
  t: number;     // frame-loop time, in milliseconds
  gain: number;  // the gain it played at; 0 while muted
}
```

`log()` returns every cue played, oldest first, as a copy. `t` comes from the
frame loop's clock, so it lines up with `engine.frame.info().timeMs` rather than
with wall time.
