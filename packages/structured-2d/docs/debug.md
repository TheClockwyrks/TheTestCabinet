# The debug surface

A game's debug surface is the object its instance's `initialize` returns for
posing a scenario and reading it back from code. A caller holding it places the
pieces where it wants them, steps the simulation, and reads the outcome, so a
build can be driven without the keyboard and without waiting on real time.

```ts
class GameInstance<D = unknown> {
  initialize(api: InitApi): D | Promise<D>;
}

engine.debug: D;
```

The engine holds whatever the instance hands it and reads no member of it. The
shape is the game's own: the methods it names, the values they return, and the
vocabulary they use are the game's design.

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
  world through the same systems play uses — spawning actors, moving
  transforms, driving the game mode, possessing pawns — and leaves the outcome
  to the frames that follow.
- A **reading** takes nothing and returns plain data, built at the call, so a
  caller compares and serializes it without holding a framework object.

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
import { GameInstance, type InitApi } from "@test-cabinet/structured-2d";
import { Ball } from "./actors";
import { RallyMode } from "./modes";
import { TAG_BALL } from "./constants";

export interface BallPatch {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface Snapshot {
  phase: string;
  ball: { x: number; y: number; vx: number; vy: number };
  score: readonly number[];
}

export interface Debug {
  startMatch(mode: "solo" | "versus"): void;
  placeBall(patch: BallPatch): void;
  snapshot(): Snapshot;
}

export class Arcade extends GameInstance<Debug> {
  override initialize(api: InitApi): Debug {
    api.input.register("up", { keys: ["KeyW", "ArrowUp"] });
    api.input.register("down", { keys: ["KeyS", "ArrowDown"] });

    return {
      startMatch: (mode) => {
        const rally = this.engine.world.mode as RallyMode;
        rally.begin(mode);
      },
      placeBall: (patch) => {
        const world = this.engine.world;
        const ball =
          (world.byTag(TAG_BALL)[0] as Ball | undefined) ??
          world.spawn(Ball, { tags: [TAG_BALL] });
        if (patch.x !== undefined) ball.transform.x = patch.x;
        if (patch.y !== undefined) ball.transform.y = patch.y;
        if (patch.vx !== undefined) ball.velocity.x = patch.vx;
        if (patch.vy !== undefined) ball.velocity.y = patch.vy;
      },
      snapshot: () => {
        const world = this.engine.world;
        const ball = world.byTag(TAG_BALL)[0] as Ball | undefined;
        return {
          phase: world.state.phase,
          ball: ball
            ? {
                x: ball.transform.x,
                y: ball.transform.y,
                vx: ball.velocity.x,
                vy: ball.velocity.y,
              }
            : { x: 0, y: 0, vx: 0, vy: 0 },
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
import { ConstantClock, createEngine } from "@test-cabinet/structured-2d";

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  clock: new ConstantClock(1000 / 60),
});

await engine.initialize();

engine.debug.startMatch("versus");
engine.debug.placeBall({ x: 600, y: 180, vx: 200, vy: 0 });
await engine.advance(60);

const { score } = engine.debug.snapshot();
```

Pair the surface with `advance` and a clock that supplies its own deltas: pose
the scenario, step an exact number of frames, and read the result back. See
`frame.md` for the clocks and for what a frame does. A caller can also read the
world directly — `engine.world.byTag`, `world.state`, and the rest — beside the
surface's own readings.

## A surface is not a diagnostic

A diagnostic source names a value for a person reading the overlay; the surface
names the operations a caller drives from code, and the readings it needs to
decide what happened. The two are declared separately and neither replaces the
other. See `diagnostics.md`.

## Errors

| Condition | Result |
| --- | --- |
| `engine.debug` read before `initialize` resolves | `Error` naming the ordering |
| The instance's `initialize` returns `undefined` | `engine.initialize` rejects with an `Error` naming the debug surface |

Reading before `initialize` resolves throws exactly as `engine.instance` and
`engine.world` do. A game with no surface returns `null` there, and
`engine.debug` hands that `null` back rather than refusing: the surface is
whatever the game chose, and `null` is a choice the game can make.
