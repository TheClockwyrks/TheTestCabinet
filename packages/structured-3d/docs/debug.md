# The debug surface

A game's debug surface is the object its instance's `initialize` returns for
posing a scenario and reading it back from code. A caller holding it places the
pieces where it wants them, steps the simulation, and reads the outcome, so a
build can be driven without the keyboard and without waiting on real time.

```ts
class GameInstance<D = unknown> {
  readonly engine: Engine<D>;
  readonly events: EngineEvents;
  initialize(api: InitApi): D | Promise<D>;
  worldOpened(world: World): void;
  worldClosing(world: World): void;
  shutdown(): void;
}

engine.debug: D;
```

| Member         | Called                                                         |
| -------------- | -------------------------------------------------------------- |
| `initialize`   | Once, before the start level opens. Returns the debug surface. |
| `worldOpened`  | After each world's game mode has begun play.                   |
| `worldClosing` | Before each world's actors end play.                           |
| `shutdown`     | Once, from `engine.destroy`.                                   |

The engine holds whatever the instance hands it and reads no member of it. The
shape is the game's own: the methods it names, the values they return, and the
vocabulary they use are the game's design.

`engine` is assigned before `initialize` runs, so a constructor sets defaults
and nothing more. `initialize` may return a promise, and the engine awaits it
before the start level opens.

## Declaring the surface

`GameInstance` takes the surface as its type parameter, `GameDefinition` carries
the same parameter through its `instance` class, and `createEngine` infers it
from the definition the options carry, so `engine.debug` is typed as the surface
the instance returns. `D` defaults to `unknown`. A game with no surface extends
`GameInstance<null>` and returns `null`.

## The shape of an operation

Each operation is a method that acts on the live world through `this.engine`.
`engine.world` follows every transition, so an operation reads it at the moment
of the call rather than holding a world of its own.

- A **pose** takes only its own arguments and returns nothing. It arranges the
  world through the same systems play uses — spawning actors, moving transforms,
  driving the game mode, possessing pawns — and leaves the outcome to the frames
  that follow.
- A **reading** takes nothing and returns plain data, built at the call, so a
  caller compares and serializes it without holding a framework object or a
  three object out of the scene.

Each pose does one thing and takes scalars, so a caller arranges exactly the
part of the world its scenario is about. A ball's position and its velocity are
two operations, and a scenario that needs both calls both.

Offer the operations a scenario is written in rather than the raw fields of the
framework objects: placing a piece, starting a match, spawning a wave, reading
the score. Each pose is an arrangement the game's own systems could have
produced, so a scenario posed from code and the same scenario reached by playing
leave the world in one state.

## Returning it

`initialize` returns the surface, so it is in place before the start level opens
and a caller finds it the moment `engine.initialize` resolves. Every caller that
reads `engine.debug` holds the same object for the life of the engine, across
every level the game opens.

```ts
import { GameInstance, vec3 } from "@clockwyrks/structured-3d";
import type { InitApi } from "@clockwyrks/structured-3d";
import { Ball } from "./actors";
import { ArenaMode } from "./modes";
import { TAGS } from "./constants";

export interface Snapshot {
  phase: string;
  ball: { x: number; y: number; z: number };
  score: readonly number[];
}

export interface Debug {
  startMatch(mode: "solo" | "versus"): void;
  setBallPosition(x: number, y: number, z: number): void;
  setBallVelocity(vx: number, vy: number, vz: number): void;
  snapshot(): Snapshot;
}

export class Arcade extends GameInstance<Debug> {
  override initialize(api: InitApi): Debug {
    api.input.register("move-up", {
      keys: ["KeyW", "ArrowUp"],
      kind: "analog",
    });
    api.input.register("move-down", {
      keys: ["KeyS", "ArrowDown"],
      kind: "analog",
    });

    const ballActor = (): Ball => {
      const world = this.engine.world;
      return (
        (world.byTag(TAGS.ball)[0] as Ball | undefined) ??
        world.spawn(Ball, { tags: [TAGS.ball] })
      );
    };

    return {
      startMatch: (mode) => {
        (this.engine.world.mode as ArenaMode).begin(mode);
      },
      setBallPosition: (x, y, z) => {
        ballActor().transform.position = vec3(x, y, z);
      },
      setBallVelocity: (vx, vy, vz) => {
        ballActor().velocity = vec3(vx, vy, vz);
      },
      snapshot: () => {
        const world = this.engine.world;
        const ball = world.byTag(TAGS.ball)[0] as Ball | undefined;
        const at = ball?.transform.position ?? vec3(0, 0, 0);
        return {
          phase: world.state.phase,
          ball: { x: at.x, y: at.y, z: at.z },
          score: world.state.players.map((p) => p.score),
        };
      },
    };
  }
}
```

The surface's methods may be written inline as above or gathered from the
instance's own methods, so long as the value `initialize` returns carries them.

## Driving it

`engine.debug` returns the value the instance returned, unchanged, and the
engine handle is the whole route to it. A caller drives an operation directly:

```ts
import { ConstantClock, createEngine } from "@clockwyrks/structured-3d";

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  clock: new ConstantClock(1000 / 60),
});

await engine.initialize();

engine.debug.startMatch("versus");
engine.debug.setBallPosition(6, 1, 0);
engine.debug.setBallVelocity(-8, 0, 0);
await engine.advance(60);

const { score } = engine.debug.snapshot();
```

Pair the surface with `advance` and a clock that supplies its own deltas: pose
the scenario, step an exact number of frames, and read the result back. See
`frame.md` for the clocks and for what a frame does. A caller can also read the
world directly — `engine.world.byTag`, `world.state`, `world.camera.snapshot()`,
and `engine.scene` — beside the surface's own readings.

## Carrying values across a level

`worldOpened` and `worldClosing` are where the instance and the world meet. A
game reads the outgoing world's state into the instance from `worldClosing`, and
seeds the incoming world from `worldOpened`:

```ts
override worldClosing(world: World): void {
  this.best = Math.max(this.best, world.state.players[0]?.score ?? 0);
}

override worldOpened(world: World): void {
  world.diagnostics.register("best", () => this.best);
}
```

## What the engine keeps for itself

Driving a browser game belongs to the engine and is reached through it: the
frame and its clock step the simulation, registered actions are driven through
the surface's own event target, the overlay is the engine's panel and toggle,
the render mode and the collision overlay are switches on `engine.renderer`, the
scene the pipeline maintains is read as `engine.scene`, and the camera is read
as `world.camera`. The debug surface carries the part of driving the game that
only the game can supply.

## A surface is not a diagnostic

A diagnostic source names one value, of the types the overlay draws, for a
person reading the panel; the surface names the operations a caller drives from
code, and the readings it needs to decide what happened. The two are declared
separately and neither replaces the other. See `diagnostics.md`.

## Inert in play

Nothing on the surface runs until something calls it. A build ships it in every
bundle and a player never reaches it: the engine publishes nothing on the page,
so the surface is reachable only by whoever holds the engine.

## Errors

| Condition                                        | Result                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `engine.debug` read before `initialize` resolves | `Error` naming the ordering                                          |
| The instance's `initialize` returns `undefined`  | `engine.initialize` rejects with an `Error` naming the debug surface |

Reading before `initialize` resolves throws exactly as `engine.instance` and
`engine.world` do. A game with no surface returns `null` there, and
`engine.debug` hands that `null` back rather than refusing: the surface is
whatever the game chose, and `null` is a choice the game can make.
