---
title: Audio and Assets
---

A build named Vault: a level loads a sprite sheet and a produced `.wav` before
its world is built, the game instance defines a synthesized cue, and the game
mode plays both while the match runs. A missing file is reported on screen.

## Where the files live

Every path the game names resolves under the asset root, which is
`EngineOptions.assetRoot` and defaults to `assets/` relative to the page the
build is served from. `sprites/banner.png` names a file this workspace holds no
copy of, which is the load the notice on screen reports.

```text
assets/
  sprites/coins.png
  audio/collect.wav
```

## src/constants.ts

```ts
export const LEVEL = "vault";

export const PATH = {
  sheet: "sprites/coins.png",
  sound: "audio/collect.wav",
  banner: "sprites/banner.png",
};

export const CUE = { collect: "collect", blip: "blip" } as const;

export const COIN = {
  tag: "coin",
  frame: { width: 32, height: 32 },
  spots: [{ x: 160, y: 200 }, { x: 320, y: 160 }, { x: 480, y: 200 }],
};
```

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-2d";
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
import { GameInstance } from "@test-cabinet/structured-2d";
import type { InitApi } from "@test-cabinet/structured-2d";
import { CUE } from "./constants";

let built: VaultInstance | null = null;

/** The instance the engine built, reachable from the level's own modules. */
export function instance(): VaultInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

export class VaultInstance extends GameInstance {
  sheet: ImageBitmap | null = null;
  notice: string | null = null;

  constructor() {
    super();
    built = this;
  }

  override initialize(api: InitApi): void {
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
  SpriteComponent,
  TextComponent,
} from "@test-cabinet/structured-2d";
import type { GameDefinition, LoadApi } from "@test-cabinet/structured-2d";
import { COIN, CUE, LEVEL, PATH } from "./constants";
import { instance, VaultInstance } from "./instance";
import { VaultMode } from "./levels/vault-mode";

const coins = COIN.spots.map((spot, index) => ({
  type: Actor,
  transform: spot,
  tags: [COIN.tag],
  configure: (actor: Actor) => {
    const image = instance().sheet;
    if (image === null) return;
    actor.attach(
      new SpriteComponent({
        image,
        source: { x: index * COIN.frame.width, y: 0, ...COIN.frame },
        width: 48,
        height: 48,
      }),
    );
  },
}));

const notice = {
  type: Actor,
  transform: { x: 320, y: 40 },
  configure: (actor: Actor) => {
    const text = instance().notice;
    if (text === null) return;
    actor.attach(new TextComponent({ text, fill: "#ffb4a2" }));
  },
};

async function load(api: LoadApi): Promise<void> {
  const game = instance();
  const [sheet] = await Promise.all([
    api.assets.loadImage(PATH.sheet),
    api.audio.load(CUE.collect, PATH.sound),
  ]);
  game.sheet = sheet;
  await api.assets.loadImage(PATH.banner).catch(() => null);
}

export const vault: GameDefinition = {
  instance: VaultInstance,
  levels: { [LEVEL]: { mode: VaultMode, load, actors: [...coins, notice] } },
  startLevel: LEVEL,
};
```

The engine awaits `load` before any actor exists, so `configure` reads the sheet
as a plain `ImageBitmap` and hands it to a `SpriteComponent` along with the
`source` rectangle that selects one frame of it. Each coin takes a different
frame from the same image. The banner is optional to this build, so its
rejection is caught; the failure itself is reported by the event.

## src/levels/vault-mode.ts

```ts
import { GameMode } from "@test-cabinet/structured-2d";
import { COIN, CUE } from "../constants";

export class VaultMode extends GameMode {
  override beginPlay(): void {
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
reports that event with `gain: 0`.

`world.audio.setMuted` sets the mute bit and `world.audio.muted()` reports it.
The engine opens the audio context on the first pointer or key event it sees
and emits `audio:unlocked` at that moment.

## Observing a failed load

Each loader emits exactly one event per call: `asset:loaded` with the path and
the URL it resolved to, or `asset:failed` with the reason as well. A refused
path fails with an empty URL; a response outside `2xx`, a failed fetch, and a
body that will not decode each fail with the resolved URL.

The instance's handler writes the reason onto a field, and the notice actor's
`configure` reads that field when the world is built.
