---
title: Audio and Assets
---

Sound and files follow the same shape: the game names things in `initialize` and
the engine owns everything below the name. Cues are declared once and played by
name from `update`. Assets are named by a path relative to the asset root, and
the engine computes the URL and performs the load.

Full programs that use both are in the
[examples](/engines/simple-2d/examples/overview/).

## Defining synthesized cues

`api.audio.define` declares a cue as a starting frequency, an optional frequency
to sweep to, a gain, and a duration in milliseconds. The fields and their
defaults are specified in the [audio API](/engines/simple-2d/apis/audio/).

```ts
import type { InitApi } from "@clockwyrks/simple-2d";

function defineCues(api: InitApi): void {
  api.audio.define("paddle", { wave: "square", freq: 440, durationMs: 60 });
  api.audio.define("score", {
    wave: "triangle",
    freq: 520,
    freqTo: 880,
    durationMs: 220,
  });
}
```

## Loading a file-backed cue

`api.audio.load` binds a cue name to an audio file, so a cue produced by the
asset-generation tools is played by exactly the same call as a synthesized one.
Await it in `initialize`, and the name is live before the first frame.

```ts
await api.audio.load("explosion", "audio/explosion.wav");
```

## Playing cues

Play a cue from `update`, where the event it belongs to is detected. The call
returns immediately, is safe several times in one frame, and succeeds while
muted.

```ts
import type { UpdateApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

function update(state: DeepReadonly<Match>, api: UpdateApi, dt: number): Match {
  const next = step(state, dt);
  if (next.hitPaddle) api.audio.play("paddle");
  if (next.scored) api.audio.play("explosion");
  return next;
}
```

Play a name that was defined or loaded. Playing any other name throws, so the
run itself is what catches a typo.

## Looping a cue

`api.audio.loop` starts a cue sounding continuously and `api.audio.stop` ends
it. Both act only on a transition, so drive a loop from the state on every frame
rather than tracking whether it was started.

```ts
function update(state: DeepReadonly<Ship>, api: UpdateApi, dt: number): Ship {
  const thrusting = api.input.value("thrust") > 0;
  if (thrusting) api.audio.loop("engine");
  else api.audio.stop("engine");
  return step(state, thrusting, dt);
}
```

A synthesized cue loops as a held tone at its `freq` and `gain`, and a
file-backed cue loops its clip seamlessly, which is how a produced music bed is
played. `api.audio.looping("engine")` reports whether the loop is running.

## Muting

Every touch layout carries a `mute` action. Register it like any other action
and drive the bus from it.

```ts
if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
```

A muted cue still plays in every sense but audibility: the call succeeds and the
`cue:played` event still fires, at a gain of zero. A running loop follows the
mute bit live, silenced by `setMuted(true)` and restored by `setMuted(false)`
without restarting.

## Loading assets

`initialize` loads every file the game needs and returns them inside the state.
`loadImage` resolves to an `ImageBitmap`, `loadAudio` to an `AudioBuffer`, and
`load` to a `Blob` for anything else. The engine awaits the whole of
`initialize`, so each field is present from the first frame and `update` and
`render` read them directly.

```ts
import type { Game, InitApi } from "@clockwyrks/simple-2d";

interface State {
  readonly ship: ImageBitmap;
  readonly level: Blob;
  readonly player: { readonly x: number; readonly y: number };
}

const game: Game<State, null> = {
  async initialize(api: InitApi<State>): Promise<[State, null]> {
    const [ship, level] = await Promise.all([
      api.assets.loadImage("sprites/ship.png"),
      api.assets.load("levels/01.json"),
    ]);
    return [{ ship, level, player: { x: 320, y: 180 } }, null];
  },
  update(state, api, dt) {
    return step(state, dt);
  },
  render(state, api) {
    api.ctx.drawImage(state.ship, state.player.x - 16, state.player.y - 16);
  },
};
```

A load that fails rejects, and `engine.initialize` rejects with the cause. A
game that would rather draw something substitutes a fallback where it catches
the rejection, and a caller that subscribed to `asset:failed` before calling
`initialize` observes every failed path either way.

## Resolving without loading

`api.assets.resolve` computes the URL a path loads from and performs no fetch,
which is what to use where the browser does the loading.

```ts
const img = document.createElement("img");
img.src = api.assets.resolve("sprites/ship.png"); // "assets/sprites/ship.png"
```

Keep every path relative, with no leading slash, no `..` segment, and no scheme.
A path that names a location outside the asset root is refused.
