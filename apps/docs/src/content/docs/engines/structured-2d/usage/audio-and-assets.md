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
[examples](/engines/structured-2d/examples/overview/).

## Defining synthesized cues on the instance

`api.audio.define` declares a cue as a starting frequency, an optional frequency
to sweep to, a gain, and a duration in milliseconds. The fields and their
defaults are specified in the [audio
API](/engines/structured-2d/apis/audio/).

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-2d";

export class ArenaGame extends GameInstance {
  async initialize(api: InitApi): Promise<void> {
    api.audio.define("thrust", { wave: "sawtooth", freq: 120, durationMs: 90 });
    api.audio.define("bounce", { wave: "square", freq: 440, durationMs: 60 });
    api.audio.define("victory", {
      wave: "triangle",
      freq: 520,
      freqTo: 880,
      durationMs: 220,
    });
    api.input.register("mute", { keys: ["KeyM"] });
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

## Loading a sprite sheet in `load`

A level's `load` is awaited before any actor exists, so a sheet loaded there is
a plain value by the time an actor's constructor reaches for it. Hold it in a
module the actors that need it import.

```ts
// sprites.ts
import type { LoadApi } from "@test-cabinet/structured-2d";

let sheet: ImageBitmap | null = null;

export async function loadSheet(api: LoadApi): Promise<void> {
  sheet = await api.assets.loadImage("sprites/arena.png");
}

export function sheetImage(): ImageBitmap {
  if (sheet === null) throw new Error("sprites/arena.png is not loaded");
  return sheet;
}
```

The level loads its sheet and its cue together, and declares the actors that use
them.

```ts
// levels.ts
import type { LevelDefinition, LoadApi } from "@test-cabinet/structured-2d";
import { Asteroid } from "./actors";
import { ArenaMode } from "./modes";
import { loadSheet } from "./sprites";

export const arena: LevelDefinition = {
  mode: ArenaMode,
  actors: [
    { type: Asteroid, transform: { x: 120, y: 80 } },
    { type: Asteroid, transform: { x: 520, y: 240 } },
  ],
  async load(api: LoadApi): Promise<void> {
    await Promise.all([
      loadSheet(api),
      api.audio.load("explosion", "audio/explosion.wav"),
    ]);
  },
};
```

An actor reads the sheet as a value and selects its region with the sprite
component's `source` rectangle.

```ts
// actors.ts
import { Actor, SpriteComponent } from "@test-cabinet/structured-2d";
import { sheetImage } from "./sprites";

export class Asteroid extends Actor {
  constructor() {
    super();
    this.attach(
      new SpriteComponent({
        image: sheetImage(),
        source: { x: 64, y: 0, width: 32, height: 32 },
        width: 32,
        height: 32,
      }),
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
import { Pawn } from "@test-cabinet/structured-2d";
import { FIELD_WIDTH } from "./constants";

export class Ship extends Pawn {
  vx = 180;

  tick(dt: number): void {
    this.transform.x += this.vx * dt;
    if (this.transform.x < 0 || this.transform.x > FIELD_WIDTH) {
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
import { GameMode } from "@test-cabinet/structured-2d";
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

## Muting

Every touch layout carries a `mute` action. Read it from a player controller and
drive the bus from there.

```ts
// controllers.ts
import { PlayerController } from "@test-cabinet/structured-2d";

export class ShipController extends PlayerController {
  tick(): void {
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }
  }
}
```

A muted cue still plays in every sense but audibility: the call succeeds and the
`cue:played` event still fires, at a gain of zero.

## Surfacing a failed load

Every load announces its outcome on the engine's event broadcaster. Subscribe
once from the instance's `initialize` and the subscription covers the instance's
own loads and every level's afterwards. Registering the record as a diagnostic
source puts the failed paths on the
[overlay](/engines/structured-2d/apis/diagnostics/).

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-2d";

export class ArenaGame extends GameInstance {
  private failed: string[] = [];

  async initialize(api: InitApi): Promise<void> {
    api.events.on("asset:failed", ({ path, reason }) => {
      this.failed.push(`${path}: ${reason}`);
    });
    api.diagnostics.register("assets-failed", () => this.failed);
  }
}
```

A load that fails also rejects, carrying the cause. A level that treats a
missing file as fatal lets the rejection escape its `load`; a level that would
rather draw something catches the rejection where it made the call and installs
a fallback.

## Loading during play

A world that discovers it needs a file loads it through `world.assets` while
frames continue. The actor that asked for the file installs it when it arrives.

```ts
const portrait = await this.world.assets.loadImage("ui/portrait.png");
this.attach(new SpriteComponent({ image: portrait }));
```

## Resolving without loading

`assets.resolve` computes the URL a path loads from and performs no fetch, which
is what to use where the browser does the loading.

```ts
const img = document.createElement("img");
img.src = api.assets.resolve("sprites/ship.png"); // "assets/sprites/ship.png"
```

Keep every path relative, with no leading slash, no `..` segment, and no scheme.
A path that names a location outside the asset root is refused.
