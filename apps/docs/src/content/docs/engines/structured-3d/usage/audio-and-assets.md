---
title: Audio and Assets
---

Sound and files follow the same shape: the game names things and the engine owns
everything below the name. Cues are declared by name and played by name from a
tick, from a point in the world or from nowhere in particular. Assets are named
by a path relative to the asset root, and the engine computes the URL and
performs the load.

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
import { GameInstance, type InitApi } from "@clockwyrks/structured-3d";

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
declaring them again.

## Loading a file-backed cue in a level's `load`

`api.audio.load` binds a cue name to an audio file, so a cue produced by the
asset-generation tools is played by exactly the same call as a synthesized one.
The engine awaits the level's `load`, so the name is live before the level's
first frame.

```ts
await api.audio.load("explosion", "audio/explosion.wav");
```

## Loading textures and models in `load`

A level's `load` is awaited before any actor exists, so a texture or a model
loaded there is a plain value by the time an actor's constructor reaches for
it. Hold them in a module the actors that need them import.

```ts
// assets.ts
import type { LoadApi, Model } from "@clockwyrks/structured-3d";
import type * as THREE from "three";

let hull: THREE.Texture | null = null;
let walker: Model | null = null;

export async function loadArena(api: LoadApi): Promise<void> {
  [hull, walker] = await Promise.all([
    api.assets.loadTexture("textures/hull.png"),
    api.assets.loadModel("models/walker.glb"),
  ]);
}

export function hullTexture(): THREE.Texture {
  if (hull === null) throw new Error("textures/hull.png is not loaded");
  return hull;
}

export function walkerModel(): Model {
  if (walker === null) throw new Error("models/walker.glb is not loaded");
  return walker;
}
```

The level loads its assets and its cue together, and declares the actors that
use them.

```ts
// levels.ts
import type { LevelDefinition, LoadApi } from "@clockwyrks/structured-3d";
import { vec3 } from "@clockwyrks/structured-3d";
import { Asteroid, Walker } from "./actors";
import { loadArena } from "./assets";
import { ArenaMode } from "./modes";

export const arena: LevelDefinition = {
  mode: ArenaMode,
  actors: [
    { type: Asteroid, transform: { position: vec3(-6, 0, -4) } },
    { type: Asteroid, transform: { position: vec3(5, 0, -9) } },
    { type: Walker, transform: { position: vec3(0, 0, 0) } },
  ],
  async load(api: LoadApi): Promise<void> {
    await Promise.all([
      loadArena(api),
      api.audio.load("explosion", "audio/explosion.wav"),
    ]);
  },
};
```

An actor reads the texture as a value through its material's `map`, and the
model through a `ModelComponent`, which clones it so the two actors share one
load.

```ts
// actors.ts
import {
  Actor,
  MeshComponent,
  ModelComponent,
} from "@clockwyrks/structured-3d";
import { hullTexture, walkerModel } from "./assets";

export class Asteroid extends Actor {
  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "sphere", radius: 1.5, segments: 8 },
        material: { map: hullTexture(), flatShading: true },
      }),
    );
  }
}

export class Walker extends Actor {
  constructor() {
    super();
    this.attach(
      new ModelComponent({ model: walkerModel(), animation: "idle" }),
    );
  }
}
```

`loadTexture` wraps the decoded image as a `THREE.Texture` in the sRGB color
space, ready to be a material's `map`. `loadModel` decodes a glTF 2.0 file,
`.glb` or `.gltf`, into its node tree, meshes, materials, skins, and clips; a
texture inside the file that the host cannot decode leaves that material's
`map` unset, and the load still resolves. An `ImageBitmap` for a screen-space
sprite is loaded with `loadImage` in the same place.

## Playing cues

Play a cue from the tick that detected the event it belongs to, through the
world the object belongs to. The call returns immediately, is safe several times
in one frame, and succeeds while muted.

```ts
// An actor plays the cue for what happened to it.
import { Pawn, add, scale } from "@clockwyrks/structured-3d";
import type { Vec3 } from "@clockwyrks/structured-3d";
import { FIELD_WIDTH } from "./constants";

export class Ship extends Pawn {
  velocity: Vec3 = { x: 6, y: 0, z: 0 };

  tick(dt: number): void {
    this.transform.position = add(
      this.transform.position,
      scale(this.velocity, dt),
    );
    const x = this.transform.position.x;
    if (x < -FIELD_WIDTH / 2 || x > FIELD_WIDTH / 2) {
      this.velocity = scale(this.velocity, -1);
      this.world.audio.play("bounce", { at: this.transform.position });
    }
  }
}
```

A game mode ticks after every actor has ticked and after collision has been
reported, so it plays the cues that belong to the match rather than to one
actor.

```ts
// modes.ts
import { GameMode } from "@clockwyrks/structured-3d";
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

## Positional cues

A cue played with `at` sounds from that world point, heard from the camera.
The engine routes it through a panner with the inverse distance model, so a
cue one world unit from the camera sounds at its full gain and a cue farther
away is quieter and comes from its direction. The listener is the camera as it
stood at the most recent render, and the engine moves the listener every frame,
so a positioned cue tracks a following camera with no help from the game.

The bounce above sounds from the ship, and the victory fanfare, played without
`at`, sounds as a 2D cue does. Give `at` to a cue that belongs to a place in the
world, an impact, an engine, a pickup, and leave it off a cue that belongs to
the player or the menu.

A loop that follows a moving actor is placed from that actor's tick. `place`
moves a running loop and does nothing for a cue that is not looping, so the
tick calls it every frame without a guard.

```ts
import { Actor } from "@clockwyrks/structured-3d";

export class Drone extends Actor {
  beginPlay(): void {
    this.world.audio.loop("hum", { at: this.transform.position });
  }

  tick(): void {
    this.world.audio.place("hum", this.transform.position);
  }

  endPlay(): void {
    this.world.audio.stop("hum");
  }
}
```

The `cue:played` and `cue:looped` events carry `at`, the world point the call
gave or `null` for an unpositioned cue, so a check reads where a build placed a
sound as well as which one it played.

## Looping a cue

`world.audio.loop` starts a cue sounding continuously and `world.audio.stop`
ends it. Both act only on a transition, so drive a loop from the object's state
on every tick rather than tracking whether it was started.

```ts
// A pawn holds its engine hum for as long as it is thrusting.
import { Pawn } from "@clockwyrks/structured-3d";

export class Ship extends Pawn {
  thrusting = false;

  tick(dt: number): void {
    if (this.thrusting)
      this.world.audio.loop("thrust", { at: this.transform.position });
    else this.world.audio.stop("thrust");
    this.world.audio.place("thrust", this.transform.position);
    this.integrate(dt);
  }
}
```

A synthesized cue loops as a held tone at its `freq` and `gain`, and a
file-backed cue loops its clip seamlessly, which is how a produced music bed is
played from a game mode's `beginPlay`. `world.audio.looping("thrust")` reports
whether the loop is running, and a loop keeps running across a level transition
until a tick stops it, keeping its position and heard from the new world's
camera.

## Muting

Every touch layout carries a `mute` action. Read it from a player controller and
drive the bus from there.

```ts
// controllers.ts
import { PlayerController } from "@clockwyrks/structured-3d";

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
source puts the failed paths on the overlay.

```ts
import { GameInstance, type InitApi } from "@clockwyrks/structured-3d";

export class ArenaGame extends GameInstance<null> {
  private failed: string[] = [];

  override async initialize(api: InitApi): Promise<null> {
    api.events.on("asset:failed", ({ path, reason }) => {
      this.failed.push(`${path}: ${reason}`);
    });
    api.diagnostics.register(
      "assets-failed",
      () => this.failed.join(", ") || "none",
    );
    return null;
  }
}
```

A load that fails also rejects, carrying the cause. A level that treats a
missing file as fatal lets the rejection escape its `load`; a level that would
rather draw something catches the rejection where it made the call and installs
a fallback, a `MeshComponent` in a flat color where a model was expected.

## Loading during play

A world that discovers it needs a file loads it through `world.assets` while
frames continue. The actor that asked for the file installs it when it arrives.

```ts
const crate = await this.world.assets.loadModel("models/crate.glb");
this.attach(new ModelComponent({ model: crate }));
```

## Resolving without loading

`assets.resolve` computes the URL a path loads from and performs no fetch, which
is what to use where the browser does the loading.

```ts
const img = document.createElement("img");
img.src = api.assets.resolve("textures/hull.png"); // "assets/textures/hull.png"
```

Keep every path relative, with no leading slash, no `..` segment, and no scheme.
A path that names a location outside the asset root is refused. A `.gltf`
file's external buffers and images are fetched relative to the file's own URL
inside the same load, so a model and its textures sit together under the root.
