---
title: Audio and Assets
---

Sound and files follow the same shape: the game names things and the engine owns
everything below the name. Cues are declared by name and played by name from a
tick. Assets are named by a path relative to the asset root, and the engine
computes the URL and performs the load.

What the whole game needs is declared on the game instance, which outlives every
level transition. What one level needs is declared in that level's `load`. Full
programs that use both are in the
[examples](/engines/structured-3d/examples/overview/).

## Defining synthesized cues on the instance

`api.audio.define` declares a cue as a starting frequency, an optional frequency
to sweep to, a gain, and a duration in milliseconds. The fields and their
defaults are specified in the [audio
API](/engines/structured-3d/apis/audio/).

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-3d";

export class ArenaGame extends GameInstance<null> {
  override async initialize(api: InitApi): Promise<null> {
    api.audio.define("thrust", { wave: "sawtooth", freq: 120, durationMs: 90 });
    api.audio.define("bounce", { wave: "square", freq: 440, durationMs: 60 });
    api.audio.define("victory", {
      wave: "triangle",
      freq: 520,
      freqTo: 880,
      durationMs: 220,
    });
    api.input.register("mute", { keys: ["KeyM"] });
    return null;
  }
}
```

These cues belong to the engine, so every level of the game plays them without
declaring them again. The bus is non-spatial: a cue has no position, and a
sound that should feel distant is the game's choice of when to play it.

## Loading a file-backed cue in a level's `load`

`api.audio.load` binds a cue name to an audio file, so a cue produced by the
asset-generation tools is played by exactly the same call as a synthesized one.
The engine awaits the level's `load`, so the name is live before the level's
first frame.

```ts
await api.audio.load("explosion", "audio/explosion.wav");
```

## Loading meshes and materials in `load`

A level's `load` is awaited before any actor exists, so a mesh loaded there is
a plain handle by the time an actor's constructor reaches for it. Hold the
handles in a module the actors that need them import.

```ts
// assets.ts
import type { LoadApi, MaterialHandle, MeshHandle } from "@test-cabinet/structured-3d";

let asteroid: MeshHandle | null = null;
let rock: MaterialHandle | null = null;

export async function loadArenaAssets(api: LoadApi): Promise<void> {
  [asteroid, rock] = await Promise.all([
    api.assets.loadMesh("models/asteroid.glb"),
    api.assets.loadMaterial("materials/rock/material.json"),
  ]);
}

export function asteroidMesh(): MeshHandle {
  if (asteroid === null) throw new Error("models/asteroid.glb is not loaded");
  return asteroid;
}

export function rockMaterial(): MaterialHandle {
  if (rock === null) throw new Error("materials/rock is not loaded");
  return rock;
}
```

`loadMesh` decodes a glTF binary to a handle ready to draw, and `loadMaterial`
parses the material document and loads every map it names in the one call, so a
PBR folder produced by the asset-generation tools travels as one path. There is
no `loadImage`: a texture is the 3D engine's image, loaded with `loadTexture`,
and a file the typed loaders do not cover — level data, a voxel `rig.json` —
goes through `load`.

The level loads its assets and its cue together, and declares the actors that
use them.

```ts
// levels.ts
import type { LevelDefinition, LoadApi } from "@test-cabinet/structured-3d";
import { Asteroid } from "./actors";
import { ArenaMode } from "./modes";
import { loadArenaAssets } from "./assets";

export const arena: LevelDefinition = {
  mode: ArenaMode,
  actors: [
    { type: Asteroid, transform: { position: { x: -12, y: 0, z: -8 } } },
    { type: Asteroid, transform: { position: { x: 15, y: 0, z: 6 } } },
  ],
  async load(api: LoadApi): Promise<void> {
    await Promise.all([
      loadArenaAssets(api),
      api.audio.load("explosion", "audio/explosion.wav"),
    ]);
  },
};
```

An actor reads the handles as values and hands them to its render component.

```ts
// actors.ts
import { Actor, MeshComponent } from "@test-cabinet/structured-3d";
import { asteroidMesh, rockMaterial } from "./assets";

export class Asteroid extends Actor {
  constructor() {
    super();
    this.attach(
      new MeshComponent({ mesh: asteroidMesh(), material: rockMaterial() }),
    );
  }
}
```

## Playing cues

Play a cue from the tick that detected the event it belongs to, through the
world the object belongs to. The call returns immediately, is safe several times
in one frame, and succeeds while muted.

```ts
// An actor plays the cue for what happened to it.
import { Pawn } from "@test-cabinet/structured-3d";
import { ARENA } from "./constants";

export class Ship extends Pawn {
  vx = 18;

  tick(dt: number): void {
    this.transform.position.x += this.vx * dt;
    if (Math.abs(this.transform.position.x) > ARENA.half) {
      this.vx = -this.vx;
      this.world.audio.play("bounce");
    }
  }
}
```

A game mode ticks after every actor has ticked and after collision has been
reported, so it plays the cues that belong to the match rather than to one
actor.

```ts
// modes.ts
import { GameMode } from "@test-cabinet/structured-3d";
import { Asteroid, Ship } from "./actors";
import { ShipController } from "./controllers";

export class ArenaMode extends GameMode {
  pawnClass = Ship;
  playerControllerClass = ShipController;

  beginPlay(): void {
    this.addPlayer();
    this.setPhase("playing");
  }

  tick(): void {
    if (this.phase !== "playing") return;
    if (this.world.ofType(Asteroid).length === 0) {
      this.setPhase("over");
      this.world.audio.play("victory");
    }
  }
}
```

Play a name that was defined or loaded. Playing any other name throws, so the
run itself is what catches a typo.

## Looping a cue

`world.audio.loop` starts a cue sounding continuously and `world.audio.stop`
ends it. Both act only on a transition, so drive a loop from the object's state
on every tick rather than tracking whether it was started.

```ts
// A pawn holds its engine hum for as long as it is thrusting.
import { Pawn } from "@test-cabinet/structured-3d";

export class Ship extends Pawn {
  thrusting = false;

  tick(dt: number): void {
    if (this.thrusting) this.world.audio.loop("thrust");
    else this.world.audio.stop("thrust");
    this.integrate(dt);
  }
}
```

A synthesized cue loops as a held tone at its `freq` and `gain`, and a
file-backed cue loops its clip seamlessly, which is how a produced music bed is
played from a game mode's `beginPlay`. `world.audio.looping("thrust")` reports
whether the loop is running, and a loop keeps running across a level transition
until a tick stops it.

## Muting

Every touch layout carries a `mute` action. Read it from a player controller and
drive the bus from there.

```ts
// controllers.ts
import { PlayerController } from "@test-cabinet/structured-3d";

export class ShipController extends PlayerController {
  tick(): void {
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }
  }
}
```

A muted cue still plays in every sense but audibility: the call succeeds and the
`cue:played` event still fires, at a gain of zero. A running loop follows the
mute bit live, silenced by `setMuted(true)` and restored by `setMuted(false)`
without restarting.

## Surfacing a failed load

Every load announces its outcome on the engine's event broadcaster. Subscribe
once from the instance's `initialize` and the subscription covers the instance's
own loads and every level's afterwards. Registering the record as a diagnostic
source puts the failed paths on the
[overlay](/engines/structured-3d/apis/diagnostics/).

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-3d";

export class ArenaGame extends GameInstance<null> {
  private failed: string[] = [];

  override async initialize(api: InitApi): Promise<null> {
    api.events.on("asset:failed", ({ path, reason }) => {
      this.failed.push(`${path}: ${reason}`);
    });
    api.diagnostics.register("assets-failed", () => this.failed);
    return null;
  }
}
```

A load that fails also rejects, carrying the cause. A material load fails whole
when any map it names fails, with the reason naming the map. A level that treats
a missing file as fatal lets the rejection escape its `load`; a level that would
rather draw something catches the rejection where it made the call and installs
a fallback.

## Loading during play

A world that discovers it needs a file loads it through `world.assets` while
frames continue. The actor that asked for the file installs it when it arrives.

```ts
const crate = await this.world.assets.loadMesh("models/crate.glb");
this.attach(new MeshComponent({ mesh: crate }));
```

## Resolving without loading

`assets.resolve` computes the URL a path loads from and performs no fetch, which
is what to use where the browser does the loading.

```ts
const img = document.createElement("img");
img.src = api.assets.resolve("textures/emblem.png"); // "assets/textures/emblem.png"
```

Keep every path relative, with no leading slash, no `..` segment, and no scheme.
A path that names a location outside the asset root is refused.
