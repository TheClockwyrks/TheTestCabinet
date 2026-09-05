---
title: Audio and Assets
---

Sound and files follow the same shape: the game names things in `initialize` and
the engine owns everything below the name. Cues are declared once and played by
name from `update`, unpositioned or at a point in the world. Assets are named by
a path relative to the asset root, and the engine computes the URL and performs
the load.

Full programs that use both are in the
[examples](/engines/simple-3d/examples/overview/).

## Defining synthesized cues

`api.audio.define` declares a cue as a starting frequency, an optional frequency
to sweep to, a gain, and a duration in milliseconds. The fields and their
defaults are specified in the [audio API](/engines/simple-3d/apis/audio/).

```ts
import type { InitApi } from "@clockwyrks/simple-3d";

function defineCues(api: InitApi): void {
  api.audio.define("place", { wave: "square", freq: 440, durationMs: 60 });
  api.audio.define("complete", {
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
await api.audio.load("collapse", "audio/collapse.wav");
```

## Playing cues

Play a cue from `update`, where the event it belongs to is detected. The call
returns immediately, is safe several times in one frame, and succeeds while
muted.

```ts
import type { UpdateApi } from "@clockwyrks/simple-3d";
import type { DeepReadonly } from "ts-essentials";

function update(state: DeepReadonly<Yard>, api: UpdateApi, dt: number): Yard {
  const next = step(state, dt);
  if (next.placed) api.audio.play("place");
  if (next.collapsed) api.audio.play("collapse");
  return next;
}
```

Play a name that was defined or loaded. Playing any other name throws, so the
run itself is what catches a typo.

## Playing a cue at a position

`play` takes an `at` option, a world point, and the cue is then heard from that
point: it is routed through a panner, attenuated by its distance from the
camera and panned by its direction. The listener is the camera as it stood at
the most recent render, so a cue played at the far end of the yard sounds far
and to one side of wherever the player is looking. A cue played without `at`
sounds unpositioned, at the bus's gain, as a HUD sound should.

```ts
function update(state: DeepReadonly<Yard>, api: UpdateApi, dt: number): Yard {
  const next = step(state, dt);
  if (next.hookLanded) api.audio.play("clank", { at: next.hook });
  if (next.completed) api.audio.play("complete");
  return next;
}
```

The point is the one the cue was played at, for its whole duration. The
state's own positions are plain `{ x, y, z }` values, so a position the
simulation already holds is passed as it stands.

## Looping a cue

`api.audio.loop` starts a cue sounding continuously and `api.audio.stop` ends
it. Both act only on a transition, so drive a loop from the state on every frame
rather than tracking whether it was started.

```ts
function update(state: DeepReadonly<Yard>, api: UpdateApi, dt: number): Yard {
  const running = state.phase === "run";
  if (running) api.audio.loop("motor");
  else api.audio.stop("motor");
  return step(state, dt);
}
```

A synthesized cue loops as a held tone at its `freq` and `gain`, and a
file-backed cue loops its clip seamlessly, which is how a produced music bed is
played. `api.audio.looping("motor")` reports whether the loop is running.

## Moving a loop

A loop started with `at` is positioned like a one-shot, and `api.audio.place`
moves it while it runs. `loop` does nothing for a cue already looping, so a
loop that follows a moving object is started with `loop` and moved with `place`
on every frame, and `place` does nothing for a cue that is not looping. The two
calls together are what an engine sound on a moving crane needs.

```ts
function update(state: DeepReadonly<Yard>, api: UpdateApi, dt: number): Yard {
  const next = step(state, dt);
  if (next.phase === "run") {
    api.audio.loop("motor", { at: next.trolley });
    api.audio.place("motor", next.trolley);
  } else {
    api.audio.stop("motor");
  }
  return next;
}
```

A loop started without `at` stays unpositioned for its life. The listener
follows the camera every frame, so a positioned loop at a fixed point still
moves across the stereo field as the camera orbits.

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

`initialize` loads every file the game needs. `loadImage` resolves to an
`ImageBitmap`, `loadAudio` to an `AudioBuffer`, `load` to a `Blob` for anything
else, `loadTexture` to a `THREE.Texture`, and `loadModel` to a `Model` whose
`scene` is a template. The engine awaits the whole of `initialize`, so
everything is present from the first frame.

Where each value lives depends on what it is. An image, an audio buffer, and a
blob are plain values the state carries, and `update` and `render` read them
directly. A texture and a model are three objects: a game keeps them in a
module-level cache, or places what it builds from them in `api.scene` during
initialization, and `render` finds them there.

```ts
import * as THREE from "three";
import { cloneModel } from "@clockwyrks/simple-3d";
import type { Game, InitApi, Model } from "@clockwyrks/simple-3d";

interface State {
  readonly icon: ImageBitmap;
  readonly site: Blob;
  readonly crane: { readonly x: number; readonly y: number; readonly z: number };
}

const templates = new Map<string, Model>();
let crane: THREE.Group | undefined;

const game: Game<State, null> = {
  async initialize(api: InitApi<State>): Promise<[State, null]> {
    const [model, gravel, icon, site] = await Promise.all([
      api.assets.loadModel("models/crane.glb"),
      api.assets.loadTexture("textures/gravel.png"),
      api.assets.loadImage("ui/hook.png"),
      api.assets.load("sites/01.json"),
    ]);
    templates.set("crane", model);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ map: gravel }),
    );
    ground.rotation.x = -Math.PI / 2;
    api.scene.add(ground);

    crane = cloneModel(model);
    api.scene.add(crane);

    return [{ icon, site, crane: { x: 0, y: 0, z: 0 } }, null];
  },
  update(state, api, dt) {
    return step(state, dt);
  },
  render(state, api) {
    crane?.position.set(state.crane.x, state.crane.y, state.crane.z);
    api.screen.drawImage(state.icon, 16, 16);
  },
};
```

A texture goes onto a material as its `map` and arrives in the sRGB color space,
so a color image drawn by the asset-generation tools looks on the mesh as it
looks in the file. A model is a template, and `cloneModel` makes a placed copy
that keeps a skinned mesh bound to its own skeleton; one template yields as many
copies as the state has things to place. The
[scene page](/engines/simple-3d/usage/the-scene/) covers placing and posing the
clones from the state.

A load that fails rejects, and `engine.initialize` rejects with the cause. A
game that would rather draw something substitutes a fallback where it catches
the rejection, and a caller that subscribed to `asset:failed` before calling
`initialize` observes every failed path either way. A model whose textures the
host cannot decode still resolves, with those materials' maps unset.

## Resolving without loading

`api.assets.resolve` computes the URL a path loads from and performs no fetch,
which is what to use where the browser does the loading.

```ts
const img = document.createElement("img");
img.src = api.assets.resolve("ui/hook.png"); // "assets/ui/hook.png"
```

Keep every path relative, with no leading slash, no `..` segment, and no scheme.
A path that names a location outside the asset root is refused.
