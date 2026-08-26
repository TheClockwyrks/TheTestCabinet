---
title: Game Mode and Scoring
---

Rally is a two-player match played to a score limit, on a court in the ground
plane seen from above. Two paddles are pawns, each possessed by a controller
that reads its own half of the action vocabulary. The game mode awards the
points, restarts the pawns, and ends the match.

## src/constants.ts

```ts
import type { ActionBinding, Vec3 } from "@test-cabinet/structured-3d";

export const WIDTH = 640;
export const HEIGHT = 360;
export const BACKGROUND = "#0b0f16";

export const LEVELS = { rally: "rally" } as const;
export const TAGS = { ball: "ball", paddle: "paddle" } as const;
export const CUES = { point: "point" } as const;
export const COLORS = { ball: "#ffd479", paddle: "#7fd1ff" } as const;

export const SCORE_LIMIT = 7;
export const COURT = { halfWidth: 8, halfDepth: 4.5 };
export const PADDLE = {
  size: { x: 0.4, y: 0.8, z: 2.4 } as Vec3,
  inset: 1,
  speed: 8,
};
export const BALL = { radius: 0.25, speed: 7, drift: 2.5 };

export const ACTIONS: Record<string, ActionBinding> = {
  "p1-up": { keys: ["KeyW"] },
  "p1-down": { keys: ["KeyS"] },
  "p2-up": { keys: ["ArrowUp"] },
  "p2-down": { keys: ["ArrowDown"] },
};
```

The court runs `halfWidth` world units along x to each side and `halfDepth`
along z, the game's own units on its ground plane.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-3d";
import { BACKGROUND, HEIGHT, WIDTH } from "./constants";
import { rally } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  background: BACKGROUND,
  game: rally,
});

await engine.initialize();
await engine.run();
```

The touch-layout catalogue carries no two-player layout, so the build names
none and the four actions stay keyboard-driven.

## src/game.ts

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-3d";
import type { GameDefinition } from "@test-cabinet/structured-3d";
import { ACTIONS, CUES, LEVELS, TAGS } from "./constants";
import { Ball } from "./actors/ball";
import { RallyMode } from "./levels/rally-mode";

class RallyInstance extends GameInstance<null> {
  matches = 0;

  override initialize(api: InitApi): null {
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, binding);
    }
    api.audio.define(CUES.point, { freq: 660, freqTo: 440, durationMs: 90 });
    api.diagnostics.register("matches", () => this.matches);
    api.events.on("match:phase", ({ phase }) => {
      if (phase === "over") this.matches += 1;
    });
    return null;
  }
}

export const rally: GameDefinition<null> = {
  instance: RallyInstance,
  levels: {
    [LEVELS.rally]: { mode: RallyMode, actors: [{ type: Ball, tags: [TAGS.ball] }] },
  },
  startLevel: LEVELS.rally,
};
```

## src/state.ts

```ts
import { GameState, PlayerState } from "@test-cabinet/structured-3d";
import type { World } from "@test-cabinet/structured-3d";

export class RallyPlayerState extends PlayerState {
  aces = 0;
}

export class RallyState extends GameState {
  declare readonly players: readonly RallyPlayerState[];
  rallies = 0;
}

export function rallyState(world: World): RallyState {
  return world.state as RallyState;
}
```

## src/actors/ball.ts

```ts
import { Actor, ColliderComponent, ShapeComponent } from "@test-cabinet/structured-3d";
import type { Shape3, Vec3 } from "@test-cabinet/structured-3d";
import { BALL, COLORS, COURT, TAGS } from "../constants";
import { rallyState } from "../state";

const SHAPE: Shape3 = { kind: "sphere", radius: BALL.radius };

export class Ball extends Actor {
  readonly body = this.attach(
    new ShapeComponent({ shape: SHAPE, color: COLORS.ball }),
  );
  readonly collider = this.attach(
    new ColliderComponent({ shape: SHAPE, responses: { default: "overlap" } }),
  );

  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private lastHit = 0;

  override beginPlay(): void {
    this.serve(1);
  }

  serve(direction: number): void {
    this.transform.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: BALL.speed * direction, y: 0, z: BALL.drift };
    this.lastHit = 0;
  }

  override tick(dt: number): void {
    const p = this.transform.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    const wall = COURT.halfDepth - BALL.radius;
    if (p.z < -wall || p.z > wall) {
      this.velocity.z = -this.velocity.z;
    }
    for (const contact of this.world.collision.overlaps(this)) {
      if (!contact.actor.hasTag(TAGS.paddle)) continue;
      if (contact.actor.id === this.lastHit) continue;
      this.lastHit = contact.actor.id;
      const away = Math.sign(p.x - contact.actor.transform.position.x);
      this.velocity.x = Math.abs(this.velocity.x) * away;
      rallyState(this.world).rallies += 1;
    }
  }
}
```

Both colliders sit on the default channel and answer it with `overlap`, so the
engine reports the pair and moves nothing. Reflecting off the paddle, bouncing
off the long walls at `±(halfDepth − radius)`, and counting the contact are the
ball's own rules, all in world units on the ground plane.

## src/actors/paddle.ts

```ts
import { ColliderComponent, Pawn, ShapeComponent } from "@test-cabinet/structured-3d";
import type { Shape3 } from "@test-cabinet/structured-3d";
import { COLORS, PADDLE, TAGS } from "../constants";

const SHAPE: Shape3 = { kind: "box", size: PADDLE.size };

export class Paddle extends Pawn {
  readonly body = this.attach(
    new ShapeComponent({ shape: SHAPE, color: COLORS.paddle }),
  );
  readonly collider = this.attach(
    new ColliderComponent({ shape: SHAPE, responses: { default: "overlap" } }),
  );

  constructor() {
    super();
    this.addTag(TAGS.paddle);
  }
}
```

The paddle carries its shape, its collider, and its tag. It reads no action of
its own, so both paddles are one class driven by two controllers. The box
collider is positioned and oriented by the world transform; the transform's
rotation stays identity, so the box stays court-aligned.

## src/levels/rally-mode.ts

```ts
import { GameMode, PlayerController } from "@test-cabinet/structured-3d";
import type { Controller, Transform } from "@test-cabinet/structured-3d";
import { COURT, CUES, PADDLE, SCORE_LIMIT } from "../constants";
import { Ball } from "../actors/ball";
import { Paddle } from "../actors/paddle";
import { RallyPlayerState, RallyState } from "../state";

class PaddleController extends PlayerController {
  override tick(dt: number): void {
    const pawn = this.pawn;
    if (pawn === null) return;
    const side = this.index === 0 ? "p1" : "p2";
    const dir = this.input.value(`${side}-down`) - this.input.value(`${side}-up`);
    const limit = COURT.halfDepth - PADDLE.size.z / 2;
    const p = pawn.transform.position;
    p.z = Math.min(Math.max(p.z + dir * PADDLE.speed * dt, -limit), limit);
  }
}

export class RallyMode extends GameMode {
  declare readonly state: RallyState;

  override gameStateClass = RallyState;
  override playerStateClass = RallyPlayerState;
  override playerControllerClass = PaddleController;
  override pawnClass = Paddle;

  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 10, z: 9 };
    this.world.camera.lookAt({ x: 0, y: 0, z: 0 });
    this.addPlayer({ index: 0, name: "left" });
    this.addPlayer({ index: 1, name: "right" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const left = controller.playerState.index === 0;
    const x = left ? PADDLE.inset - COURT.halfWidth : COURT.halfWidth - PADDLE.inset;
    return {
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    const ball = this.world.find(Ball);
    if (ball === null) return;
    const x = ball.transform.position.x;
    if (Math.abs(x) <= COURT.halfWidth) return;

    const scorer = this.state.players[x < 0 ? 1 : 0];
    scorer.score += 1;
    if (this.state.rallies === 0) scorer.aces += 1;
    this.state.rallies = 0;
    this.world.audio.play(CUES.point);

    if (scorer.score >= SCORE_LIMIT) {
      this.setPhase("over");
      return;
    }
    ball.serve(x < 0 ? 1 : -1);
    for (const controller of this.world.players()) this.restart(controller);
  }
}
```

`gameStateClass` is read once, when the world is built, and `playerStateClass`
on each `addPlayer`. `addPlayer` builds the player state, the controller, and
the pawn, and possesses, so `beginPlay`, which runs after the declared ball has
begun play, is where a paddle first exists. The camera is part of the world, so
`beginPlay` frames the court first, from above the center line; with the camera
on +z looking down at the origin, "up" on the screen is −z, which is what the
controller's `up`/`down` difference moves along.

The mode ticks after every actor has ticked and after collision has been
reported, so it decides the point from a settled world. `restart` destroys a
controller's pawn, spawns `pawnClass` at `spawnPoint(controller)`, and possesses
it; `spawnPoint` returns a whole `Transform`, each paddle at its own end at
identity rotation and unit scale.

## The match phase

A mode's `phase` is `"waiting"` when it begins play, so a mode that starts its
match at once calls `setPhase("playing")` from `beginPlay`. `setPhase` sets the
phase, writes it onto the game state, and emits `match:phase` carrying the new
phase and the previous one. Setting the phase the mode already holds emits
nothing. `RallyMode` reaches `"over"` on the point that meets the score limit,
which is where its `tick` stops scoring and where `RallyInstance` counts the
match from its `match:phase` subscription.

## Where each figure lives

| Figure | Holder | Rebuilt |
| --- | --- | --- |
| `phase`, `elapsed`, `rallies` | `RallyState` | With the world |
| `index`, `name`, `score`, `aces` | `RallyPlayerState` | On each `addPlayer` |
| `matches` | `RallyInstance` | Never |

A figure that describes the match belongs to the game state. `rallies` is read
by the ball and by the mode and means nothing outside this match, so it sits
beside `phase` and `elapsed`, the match clock that accumulates only while the
phase is `"playing"`.

A figure that answers which player belongs to a player state. The engine builds
one per `addPlayer` and `addBot` call and holds them in index order on
`state.players`, beside the `index`, `name`, and `score` every one carries.

A figure that outlives the match belongs to the game instance. `matches` counts
what no single world can see, and the instance is the one framework object kept
across a level transition, so its diagnostic source outlives the match too.
