---
title: Audio and Assets
---

A build named Vault: a level loads a produced mesh, a PBR material folder, and a
produced `.wav` before its world is built, the game instance defines a
synthesized cue, and the game mode plays both while the match runs. A missing
file is reported in the scene.

## Where the files live

Every path the game names resolves under the asset root, which is
`EngineOptions.assetRoot` and defaults to `assets/` relative to the page the
build is served from. The material document names its maps by paths relative to
its own directory, so `gold` and its textures travel as one folder.
`textures/banner.png` names a file this workspace holds no copy of, which is
the load the notice in the scene reports.

```text
assets/
  models/coin.glb
  materials/gold/material.json
  materials/gold/basecolor.png
  materials/gold/roughness.png
  audio/collect.wav
```

## src/constants.ts

```ts
export const LEVEL = "vault";

export const PATH = {
  coin: "models/coin.glb",
  gold: "materials/gold/material.json",
  sound: "audio/collect.wav",
  banner: "textures/banner.png",
};

export const CUE = { collect: "collect", blip: "blip" } as const;

export const COIN = {
  tag: "coin",
  spots: [
    { x: -4, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ],
};
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
import { GameInstance } from "@test-cabinet/structured-3d";
import type {
  InitApi,
  MaterialHandle,
  MeshHandle,
} from "@test-cabinet/structured-3d";
import { CUE } from "./constants";

let built: VaultInstance | null = null;

/** The instance the engine built, reachable from the level's own modules. */
export function instance(): VaultInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

export class VaultInstance extends GameInstance<null> {
  coin: MeshHandle | null = null;
  gold: MaterialHandle | null = null;
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
accessor, which is how the level reaches the fields it fills.

## src/game.ts

```ts
import {
  Actor,
  MeshComponent,
  TextComponent,
  quatFromAxisAngle,
} from "@test-cabinet/structured-3d";
import type { GameDefinition, LoadApi } from "@test-cabinet/structured-3d";
import { COIN, CUE, LEVEL, PATH } from "./constants";
import { instance, VaultInstance } from "./instance";
import { VaultMode } from "./levels/vault-mode";

const coins = COIN.spots.map((spot, index) => ({
  type: Actor,
  transform: {
    position: spot,
    rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, index * (Math.PI / 3)),
  },
  tags: [COIN.tag],
  configure: (actor: Actor) => {
    const game = instance();
    if (game.coin === null) return;
    actor.attach(
      new MeshComponent({
        mesh: game.coin,
        material: game.gold ?? undefined,
      }),
    );
  },
}));

const notice = {
  type: Actor,
  transform: { position: { x: 0, y: 2.5, z: 0 } },
  configure: (actor: Actor) => {
    const text = instance().notice;
    if (text === null) return;
    actor.attach(
      new TextComponent({ text, fill: "#ffb4a2", font: "0.8px sans-serif" }),
    );
  },
};

async function load(api: LoadApi): Promise<void> {
  const game = instance();
  const [coin, gold] = await Promise.all([
    api.assets.loadMesh(PATH.coin),
    api.assets.loadMaterial(PATH.gold),
    api.audio.load(CUE.collect, PATH.sound),
  ]);
  game.coin = coin;
  game.gold = gold;
  await api.assets.loadTexture(PATH.banner).catch(() => null);
}

export const vault: GameDefinition<null> = {
  instance: VaultInstance,
  levels: { [LEVEL]: { mode: VaultMode, load, actors: [...coins, notice] } },
  startLevel: LEVEL,
};
```

The engine awaits `load` before any actor exists, so `configure` reads the mesh
as a plain `MeshHandle` and hands it to a `MeshComponent` with the material the
level loaded applied over every surface. Each coin draws the same mesh at a
different facing, built with `quatFromAxisAngle` around the world's up axis. The
banner is optional to this build, so its rejection is caught; the failure itself
is reported by the event.

The notice is a `TextComponent`, which draws as a camera-facing billboard at the
actor's world position with its font size read as world units of text height, so
`0.8px` letters 0.8 units tall over the coins.

## src/levels/vault-mode.ts

```ts
import { GameMode } from "@test-cabinet/structured-3d";
import { COIN, CUE } from "../constants";

export class VaultMode extends GameMode {
  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 3, z: 10 };
    this.world.camera.lookAt({ x: 0, y: 0.5, z: 0 });
    this.world.every(1.2, () => this.take());
    this.setPhase("playing");
  }

  private take(): void {
    const coins = this.world.byTag(COIN.tag);
    const coin = coins[0];
    if (coin === undefined) return;

    coin.destroy();
    this.world.audio.play(CUE.collect);
    if (coins.length === 1) {
      this.world.audio.play(CUE.blip);
      this.setPhase("over");
    }
  }
}
```

A cue is played by name from `world.audio`, whichever kind it is. The timer runs
on simulated world time, so a scripted clock collects at the same rate.

## The two kinds of cue

`define` binds a name to a synthesized cue from a waveform, a frequency, an
optional sweep, a gain, and a duration in milliseconds. `load` binds a name to
an audio file under the asset root, which is how a clip produced by the
[asset-generation](/testing/asset-generation/manifests/overview/) tools is
played. A cue name carries one source, and declaring a name that already exists
replaces what it plays. Both kinds emit `cue:played`, and a play on a muted bus
reports that event with `gain: 0`. Either kind is looped by name through
`world.audio.loop` and ended through `world.audio.stop`, which emit
`cue:looped` and `cue:stopped` once each. The bus is non-spatial: a cue has no
position, and the coins' places in the scene change nothing about the sound.

`world.audio.setMuted` sets the mute bit and `world.audio.muted()` reports it.
The engine opens the audio context on the first pointer or key event it sees
and emits `audio:unlocked` at that moment.

## Observing a failed load

Each loader emits exactly one event per call: `asset:loaded` with the path and
the URL it resolved to, or `asset:failed` with the reason as well. A refused
path fails with an empty URL; a response outside `2xx`, a failed fetch, and a
body that will not decode each fail with the resolved URL. `loadMaterial` is
one call and one event even though it fetches every map the document names: a
map that fails fails the whole load, with the reason naming the map.

The instance's handler writes the reason onto a field, and the notice actor's
`configure` reads that field when the world is built.
