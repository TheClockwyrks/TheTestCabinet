---
title: Audio and Assets
---

A build named Vault: a level loads a produced `.glb`, a texture, and a produced
`.wav` before its world is built, the game instance defines a synthesized cue,
and the game mode plays both while the match runs. The model spins through one
of its own clips, the texture covers the floor, and the file-backed cue sounds
from where each coin stood. A missing file is reported on screen.

## Where the files live

Every path the game names resolves under the asset root, which is
`EngineOptions.assetRoot` and defaults to `assets/` relative to the page the
build is served from. `sprites/banner.png` names a file this workspace holds no
copy of, which is the load the notice on screen reports.

```text
assets/
  models/coin.glb
  textures/floor.png
  audio/collect.wav
```

`coin.glb` is a glTF 2.0 binary carrying one animation clip named `spin`, and a
per-part `.glb` the voxel binaries emit or a whole-rig export loads the same way.
`floor.png` is an ordinary image the texture loader wraps.

## src/constants.ts

```ts
import { vec3 } from "@test-cabinet/structured-3d";

export const LEVEL = "vault";

export const PATH = {
  coin: "models/coin.glb",
  floor: "textures/floor.png",
  sound: "audio/collect.wav",
  banner: "sprites/banner.png",
};

export const CUE = { collect: "collect", blip: "blip" } as const;

export const COIN = {
  tag: "coin",
  animation: "spin",
  spots: [vec3(-3, 0.5, 0), vec3(0, 0.5, -2), vec3(3, 0.5, 0)],
};

export const CAMERA = { position: vec3(0, 6, 9), target: vec3(0, 0, 0) };
```

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-3d";
import { vault } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: vault,
});

engine.events.on("asset:failed", (event) => {
  console.warn(`asset failed: ${event.path} (${event.reason})`);
});

await engine.initialize();
await engine.run();
```

Construction performs no loading and runs no game code, so this subscription is
in place before the instance is built and before the start level loads anything.

## src/instance.ts

```ts
import * as THREE from "three";
import { GameInstance } from "@test-cabinet/structured-3d";
import type { InitApi, Model } from "@test-cabinet/structured-3d";
import { CUE } from "./constants";

let built: VaultInstance | null = null;

/** The instance the engine built, reachable from the level's own modules. */
export function instance(): VaultInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

export class VaultInstance extends GameInstance<null> {
  coin: Model | null = null;
  floor: THREE.Texture | null = null;
  notice: string | null = null;

  constructor() {
    super();
    built = this;
  }

  override initialize(api: InitApi): null {
    api.audio.define(CUE.blip, {
      wave: "square",
      freq: 660,
      freqTo: 990,
      gain: 0.2,
      durationMs: 90,
    });

    api.events.on("asset:failed", (event) => {
      this.notice = `${event.path} unavailable: ${event.reason}`;
    });
    return null;
  }
}
```

`initialize` runs once, before the start level opens. A cue defined here belongs
to the engine rather than to a world, so `blip` is playable from every level and
survives every transition. The constructor records the instance in a module
accessor, which is how the level reaches the fields it fills. The texture field
is typed against `three` directly, because the engine re-exports nothing from
it and a game imports the library where it names one of its classes.

## src/game.ts

```ts
import {
  Actor,
  LightComponent,
  MeshComponent,
  ModelComponent,
  RIGHT,
  TextComponent,
  quatFromAxisAngle,
  quatLookAt,
  vec3,
} from "@test-cabinet/structured-3d";
import type { GameDefinition, LoadApi } from "@test-cabinet/structured-3d";
import { COIN, CUE, LEVEL, PATH } from "./constants";
import { instance, VaultInstance } from "./instance";
import { VaultMode } from "./levels/vault-mode";

const lights = {
  type: Actor,
  transform: { rotation: quatLookAt(vec3(-0.5, -1, -0.3)) },
  configure: (actor: Actor) => {
    actor.attach(new LightComponent({ light: { kind: "hemisphere", intensity: 0.5 } }));
    actor.attach(new LightComponent({ light: { kind: "directional", intensity: 2 } }));
  },
};

const floor = {
  type: Actor,
  transform: { rotation: quatFromAxisAngle(RIGHT, -Math.PI / 2) },
  configure: (actor: Actor) => {
    const map = instance().floor;
    actor.attach(
      new MeshComponent({
        geometry: { kind: "plane", width: 12, height: 8 },
        material: map === null ? { color: "#1c2230" } : { map, roughness: 1 },
      }),
    );
  },
};

const coins = COIN.spots.map((spot) => ({
  type: Actor,
  transform: { position: spot },
  tags: [COIN.tag],
  configure: (actor: Actor) => {
    const model = instance().coin;
    if (model === null) return;
    actor.attach(new ModelComponent({ model, animation: COIN.animation }));
  },
}));

const notice = {
  type: Actor,
  transform: { position: vec3(320, 40, 0) },
  configure: (actor: Actor) => {
    const text = instance().notice;
    if (text === null) return;
    actor.attach(new TextComponent({ text, fill: "#ffb4a2" }));
  },
};

async function load(api: LoadApi): Promise<void> {
  const game = instance();
  const [coin, floorMap] = await Promise.all([
    api.assets.loadModel(PATH.coin),
    api.assets.loadTexture(PATH.floor),
    api.audio.load(CUE.collect, PATH.sound),
  ]);
  game.coin = coin;
  game.floor = floorMap;
  await api.assets.loadImage(PATH.banner).catch(() => null);
}

export const vault: GameDefinition<null> = {
  instance: VaultInstance,
  levels: {
    [LEVEL]: { mode: VaultMode, load, actors: [lights, floor, ...coins, notice] },
  },
  startLevel: LEVEL,
};
```

The engine awaits `load` before any actor exists, so `configure` reads the
model as a plain `Model` and hands it to a `ModelComponent`, which clones the
model's `scene` on construction and plays the named clip looping from its first
frame. Three coins share one loaded model and each animates on its own clone.
The texture goes onto a `MaterialSpec` as its `map`; the plane it covers lies in
its local `XY` plane facing `+Z`, and a quarter turn about `RIGHT` lays it flat
facing `+Y`. The banner is optional to this build, so its rejection is caught;
the failure itself is reported by the event.

The notice is a `TextComponent`, a screen-space component, so its position is
logical units from the top-left of the design field and it holds its place on
the canvas whatever the camera does. Its `z` plays no part in the screen pass.

## src/levels/vault-mode.ts

```ts
import { GameMode } from "@test-cabinet/structured-3d";
import { CAMERA, COIN, CUE } from "../constants";

export class VaultMode extends GameMode {
  override beginPlay(): void {
    const camera = this.world.camera;
    camera.position = CAMERA.position;
    camera.lookAt(CAMERA.target);

    this.world.every(1.2, () => this.take());
    this.setPhase("playing");
  }

  private take(): void {
    const coins = this.world.byTag(COIN.tag);
    const coin = coins[0];
    if (coin === undefined) return;

    coin.destroy();
    this.world.audio.play(CUE.collect, { at: coin.transform.position });
    if (coins.length === 1) {
      this.world.audio.play(CUE.blip);
      this.setPhase("over");
    }
  }
}
```

A cue is played by name from `world.audio`, whichever kind it is. The timer runs
on simulated world time, so a scripted clock collects at the same rate. The
camera belongs to the world and starts at its defaults on every transition, so
the mode poses it in `beginPlay`: `lookAt` writes the rotation that looks from
`position` toward the target with `+Y` up.

## The two kinds of cue

`define` binds a name to a synthesized cue from a waveform, a frequency, an
optional sweep, a gain, and a duration in milliseconds. `load` binds a name to
an audio file under the asset root, which is how a clip produced by the
asset-generation tools is played. A cue name carries one source, and declaring
a name that already exists
replaces what it plays. Both kinds emit `cue:played`, and a play on a muted bus
reports that event with `gain: 0`. Either kind is looped by name through
`world.audio.loop` and ended through `world.audio.stop`, which emit
`cue:looped` and `cue:stopped` once each.

`world.audio.setMuted` sets the mute bit and `world.audio.muted()` reports it.
The engine opens the audio context on the first pointer or key event it sees
and emits `audio:unlocked` at that moment.

## A cue with a position

`play` and `loop` take a `PlayOptions` whose `at` is a world point in the same
units and axes as an actor's `transform.position`. A cue played with `at` is
routed through a panner and heard from the camera as it stood at the most
recent render, so the coin on the left sounds from the left and the far coin
sounds quieter than the near ones. A cue played without `at`, as `blip` is, is
unpositioned and sounds as it does in the 2D engines.

`cue:played` carries `at` beside `cue`, `t`, and `gain`: the world point the
call gave, as a copy, or `null` for an unpositioned play. A check that the
collect cue sounded where the coin stood reads that field. The gain reported is
the cue's own, before any distance attenuation.

## Observing a failed load

Each loader emits exactly one event per call: `asset:loaded` with the path and
the URL it resolved to, or `asset:failed` with the reason as well. A refused
path fails with an empty URL; a response outside `2xx`, a failed fetch, and a
body that will not decode each fail with the resolved URL. A model whose file
decodes and whose texture does not is a value that arrived: the load resolves
and the material affected has no `map`.

The instance's handler writes the reason onto a field, and the notice actor's
`configure` reads that field when the world is built.
