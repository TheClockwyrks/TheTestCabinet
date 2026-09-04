---
title: Debug Surface
---

A build hands the engine one object a caller drives it through. The game
instance builds that surface in `initialize` and returns it, and the engine
returns the same object unchanged from `engine.debug`. A caller poses a scenario
through it, steps the world, and reads the outcome back, with no keyboard and no
waiting on real time.

The surface's operations are methods that act on the live world. The instance
holds `engine`, and `engine.world` follows every transition, so an operation
reads `this.engine.world` at the moment of the call and reaches the world that
is open then. A pose takes only its own arguments and returns nothing; a reading
takes nothing and returns plain data. Each pose does one thing and takes
scalars, so a caller arranges exactly the part of the world its scenario is
about: a ball's position and its velocity are two operations.

```ts
import { GameInstance, vec3, type InitApi } from "@test-cabinet/structured-3d";
import { Ball } from "./actors";
import { RallyMode } from "./modes";
import { TAG_BALL } from "./constants";

export type Mode = "solo" | "versus";

export interface Snapshot {
  phase: string;
  ball: {
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
  };
  score: readonly number[];
}

export interface Debug {
  startMatch(mode: Mode): void;
  setBallPosition(x: number, y: number, z: number): void;
  setBallVelocity(vx: number, vy: number, vz: number): void;
  snapshot(): Snapshot;
}

export class Arcade extends GameInstance<Debug> {
  override initialize(api: InitApi): Debug {
    api.input.register("up", { keys: ["KeyW", "ArrowUp"] });
    api.input.register("down", { keys: ["KeyS", "ArrowDown"] });

    const ballActor = (): Ball => {
      const world = this.engine.world;
      return (
        (world.byTag(TAG_BALL)[0] as Ball | undefined) ??
        world.spawn(Ball, { tags: [TAG_BALL] })
      );
    };

    return {
      startMatch: (mode) => {
        const rally = this.engine.world.mode as RallyMode;
        rally.begin(mode);
      },
      setBallPosition: (x, y, z) => {
        ballActor().transform.position = vec3(x, y, z);
      },
      setBallVelocity: (vx, vy, vz) => {
        ballActor().velocity = vec3(vx, vy, vz);
      },
      snapshot: () => {
        const world = this.engine.world;
        const ball = world.byTag(TAG_BALL)[0] as Ball | undefined;
        return {
          phase: world.state.phase,
          ball: ball
            ? {
                x: ball.transform.position.x,
                y: ball.transform.position.y,
                z: ball.transform.position.z,
                vx: ball.velocity.x,
                vy: ball.velocity.y,
                vz: ball.velocity.z,
              }
            : { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
          score: world.state.players.map((p) => p.score),
        };
      },
    };
  }
}
```

A pose arranges the world through the same systems play uses: it spawns actors,
moves transforms, drives the game mode, and possesses pawns, and leaves the
outcome to the frames that follow. A reading reports what the world holds at
the instant of the call. A caller drives both directly.

```ts
await engine.initialize();

engine.debug.startMatch("versus");
engine.debug.setBallPosition(12, 1, 0);
engine.debug.setBallVelocity(-8, 0, 0);
await engine.advance(60);

const { score } = engine.debug.snapshot();
```

## Declaring the type

`GameInstance` takes the surface as its type parameter, `GameDefinition` carries
the same parameter through its `instance` class, and `createEngine` infers it
from the definition the options carry, so `engine.debug` is typed as the surface
the instance returns. `D` defaults to `unknown`. A game with no surface extends
`GameInstance<null>` and returns `null`.

The engine holds the value and reads no member of it. The methods, their
signatures, and the vocabulary they use are the game's own design.

## What belongs on it

Offer the operations a scenario is written in rather than the fields of the
framework objects: placing a piece, starting a match, spawning a wave, ending a
round, reading the score. Each pose is an arrangement the game's own systems
could have produced, so a scenario posed from code and the same scenario reached
by playing leave the world in one state. A pose decides nothing about the
outcome; the frames that follow do.

A diagnostic source names one value, of the types the overlay draws; the surface
names the operations a caller drives from code, and the readings it needs to
decide what happened. A reading returns a plain object built at the call, so a
caller compares and serializes it without holding a framework object. A
position or a rotation is returned as its scalar fields, or as a fresh `Vec3`
or `Quat`, which are plain records and serialize as they stand.

```ts
return {
  spawnWave: (kind, count) => {
    const world = this.engine.world;
    for (let i = 0; i < count; i += 1) {
      world.spawn(Enemy, { tags: [TAG_ENEMY], configure: (e) => e.setKind(kind) });
    }
  },
  live: () => this.engine.world.byTag(TAG_ENEMY).length,
  hud: () => ({ lives: this.lives, wave: this.engine.world.state.wave }),
  camera: () => this.engine.world.camera.snapshot().position,
};
```

## Returning it

`initialize` returns the surface, so it is in place before the start level opens
and a caller finds it the moment `engine.initialize` resolves. Every caller that
reads `engine.debug` holds the same object for the life of the engine, across
every level the game opens.

The surface's methods may be written inline as above or gathered from the
instance's own methods, so long as the value `initialize` returns carries them.
An `initialize` that returns `undefined` rejects `engine.initialize` with an
error naming the surface, and a game with none returns `null`.

Reading `engine.debug` before `initialize` resolves throws, naming the ordering,
exactly as `engine.instance` and `engine.world` do.

## The case's contract

A case that checks a build through the engine specifies the surface in its
instrumentation spec, and the build writes it: the instance's `initialize` builds
the surface and returns it. The validators reach the surface only through
`engine.debug`, declaring their own type for it from the spec, and read the
outcome back off the surface's readings, `engine.world`, and `engine.scene`. The
module paths a case fixes are at [The
Suite](/engines/structured-3d/validators/the-suite/).
