# Audio

A game declares its cues from `InitApi.audio` in the instance's `initialize` or
from a level's `LoadApi.audio`, and plays them by name from `world.audio` inside
a tick. A cue is either synthesized from a `CueSpec` or backed by an audio file,
and both play through the same call.

```ts
// In the instance's initialize:
api.audio.define(cue: string, spec: CueSpec): void;
api.audio.load(cue: string, path: string): Promise<void>;

// In a level's load:
api.audio.load(cue: string, path: string): Promise<void>;

// In a tick, through the world:
world.audio.play(cue: string): void;
world.audio.loop(cue: string): void;
world.audio.stop(cue: string): void;
world.audio.looping(cue: string): boolean;
world.audio.setMuted(muted: boolean): void;
world.audio.muted(): boolean;
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
override initialize(api: InitApi): null {
  api.audio.define("thrust", { wave: "sawtooth", freq: 120, durationMs: 90 });
  api.audio.define("bounce", { wave: "square", freq: 440, durationMs: 60 });
  api.audio.define("victory", { wave: "triangle", freq: 520, freqTo: 880, durationMs: 220 });
  return null;
}
```

`durationMs` is milliseconds, and the delta time a tick receives is seconds.

A cue name carries one source. Declaring a name that already exists replaces
what it plays, whichever of the two declared it, so swapping a placeholder bleep
for a produced clip is a change to the declaration alone.

Cue definitions belong to the engine rather than the world, so they survive a
level transition: a cue declared during initialization, or loaded in one level's
`load`, is playable in every level that follows.

## File-backed cues

`load` fetches and decodes audio through the asset loader and binds the result
to a cue name. It resolves once the cue is playable:

```ts
export const arena: LevelDefinition = {
  mode: ArenaMode,
  async load(api) {
    await api.audio.load("explosion", "audio/explosion.wav");
  },
};
```

`load` resolves the path through the asset loader, so it follows the same asset
root and the same path rules and emits the same `asset:loaded` and
`asset:failed` events. See `assets.md`. The name is bound only after the decode
succeeds, so a load that failed leaves the name exactly as it was. A level's
`load` is awaited before the world is built, so the name is live before the
level's first frame.

## Playback

Playback belongs to a tick, so what a frame sounds is decided by the same code
that advanced the simulation. An actor, a component, a controller, and a game
mode all reach the bus through the world they belong to.

```ts
export class Ship extends Pawn {
  vx = 180;

  override tick(dt: number): void {
    this.transform.x += this.vx * dt;
    if (this.transform.x < 0 || this.transform.x > FIELD_WIDTH) {
      this.vx = -this.vx;
      this.world.audio.play("bounce");
    }
  }
}
```

`play` returns immediately, is safe several times in one frame, and succeeds
while muted. It emits `cue:played` and, when audible, sounds the cue.

`setMuted(true)` silences the bus. A muted cue still emits its event, at
`gain: 0`, so a build that reacted while muted stays distinguishable from one
that never reacted. Every touch layout carries a `mute` action; read it from a
player controller and drive the bus from there:

```ts
export class ShipController extends PlayerController {
  override tick(): void {
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }
  }
}
```

## Looping

`loop` starts a cue sounding continuously and `stop` ends it. A file-backed cue
loops its decoded buffer seamlessly. A synthesized cue holds its `wave` at
`freq` at its `gain` until stopped, with no sweep and no decay. A cue is either
looping or not: `loop` on a cue that is already looping does nothing, and `stop`
on a cue that is not looping does nothing, so drive a loop from the object's
state on every tick rather than tracking whether it was started.

```ts
export class Ship extends Pawn {
  thrusting = false;

  override tick(dt: number): void {
    if (this.thrusting) this.world.audio.loop("thrust");
    else this.world.audio.stop("thrust");
    this.integrate(dt);
  }
}
```

`loop` emits `cue:looped` once, when the loop starts, and `stop` emits
`cue:stopped` once, when it ends. `looping` reports whether the cue is looping
and is `false` for a name that was never declared.

Mute is live. `setMuted(true)` silences every running loop and `setMuted(false)`
restores each one's gain, without restarting either. A loop started before the
unlock is looping from that call, its event already emitted, and it begins to
sound the moment the gesture opens the context.

Loops belong to the engine with the cue definitions, so a loop started in one
level keeps running across a transition until a tick stops it — which is how a
music bed started in a game mode's `beginPlay` plays on. Redeclaring a looping
cue, with `define` or `load` under the same name, stops the loop and emits
`cue:stopped`. `engine.destroy()` stops every loop.

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

| Field | Meaning |
| --- | --- |
| `cue` | The name that was played, started looping, or stopped. |
| `t` | The frame loop's accumulated simulated time in milliseconds at that moment. |
| `gain` | The gain it played or started looping at. |

A play or a loop on a muted bus reports `gain: 0`. On an unmuted bus it reports
the spec's `gain` for a synthesized cue and `1` for a file-backed cue.
`cue:looped` is emitted once per loop, when it starts, and `cue:stopped` once,
when it ends.

`t` is frame time rather than wall time, so a cue's stamp lines up with the
frame counter. Handlers run synchronously at the moment of the play, so a
subscriber sees the frame a cue belongs to. Nothing accumulates a record of the
cues a run played: a subscriber keeps exactly what it decided was worth keeping.

```ts
const played: string[] = [];
const off = engine.events.on("cue:played", (event) => played.push(event.cue));
```

## Errors

| Condition | Result |
| --- | --- |
| `play`, `loop`, or `stop` names a cue that was never declared | Throws, naming the cue |
| `looping` names a cue that was never declared | Returns `false` |
| `load` is given a path the asset loader refuses | Rejects with the `resolve` error, and the cue stays undeclared |
| `load` cannot fetch or decode the audio | Rejects with the cause, and the cue stays undeclared |
| `load` rejects inside the instance's `initialize` or the start level's `load` | `engine.initialize` rejects with the cause |
| No audio context is available | `play` and `loop` emit their events and nothing sounds |

Playing, looping, or stopping an undeclared cue throws because silence is the
expected outcome of a muted or still-locked bus, so a typo'd name would
otherwise disappear into the same silence and survive the run unnoticed.
Nothing else about audio can fail a frame.
