---
title: Game Mode and Scoring
---

Rally is a two-player match played to a score limit. Two paddles are pawns, each
possessed by a controller that reads its own half of the action vocabulary. The
game mode awards the points, restarts the pawns, and ends the match.

## src/constants.ts

```ts
import type { ActionBinding } from "@test-cabinet/structured-2d";

export const WIDTH = 640;
export const HEIGHT = 360;
export const BACKGROUND = "#0b0f16";

export const LEVELS = { rally: "rally" } as const;
export const TAGS = { ball: "ball", paddle: "paddle" } as const;
export const CUES = { point: "point" } as const;
export const FILLS = { ball: "#ffd479", paddle: "#7fd1ff" } as const;

export const SCORE_LIMIT = 7;
export const PADDLE = { width: 12, height: 72, inset: 32, speed: 320 };
export const BALL = { radius: 7, speed: 260, drift: 90 };

export const ACTIONS: Record<string, ActionBinding> = {
  "p1-up": { keys: ["KeyW"] },
  "p1-down": { keys: ["KeyS"] },
  "p2-up": { keys: ["ArrowUp"] },
  "p2-down": { keys: ["ArrowDown"] },
};
```

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-2d";
import { BACKGROUND, HEIGHT, WIDTH } from "./constants";
import { rally } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  background: BACKGROUND,
  layout: "dual-vertical",
  game: rally,
});

await engine.initialize();
await engine.run();
```

## src/game.ts

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-2d";
import type { GameDefinition } from "@test-cabinet/structured-2d";
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
import { GameState, PlayerState } from "@test-cabinet/structured-2d";
import type { World } from "@test-cabinet/structured-2d";

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
import { Actor, ColliderComponent, ShapeComponent } from "@test-cabinet/structured-2d";
import type { Shape } from "@test-cabinet/structured-2d";
import { BALL, FILLS, HEIGHT, TAGS, WIDTH } from "../constants";
import { rallyState } from "../state";

const SHAPE: Shape = { kind: "circle", radius: BALL.radius };

export class Ball extends Actor {
  readonly body = this.attach(new ShapeComponent({ shape: SHAPE, fill: FILLS.ball }));
  readonly collider = this.attach(
    new ColliderComponent({ shape: SHAPE, responses: { default: "overlap" } }),
  );

  velocity = { x: 0, y: 0 };
  private lastHit = 0;

  override beginPlay(): void {
    this.serve(1);
  }

  serve(direction: number): void {
    this.transform.x = WIDTH / 2;
    this.transform.y = HEIGHT / 2;
    this.velocity = { x: BALL.speed * direction, y: BALL.drift };
    this.lastHit = 0;
  }

  override tick(dt: number): void {
    this.transform.x += this.velocity.x * dt;
    this.transform.y += this.velocity.y * dt;
    const y = this.transform.y;
    if (y < BALL.radius || y > HEIGHT - BALL.radius) {
      this.velocity.y = -this.velocity.y;
    }
    for (const contact of this.world.collision.overlaps(this)) {
      if (!contact.actor.hasTag(TAGS.paddle)) continue;
      if (contact.actor.id === this.lastHit) continue;
      this.lastHit = contact.actor.id;
      const away = Math.sign(this.transform.x - contact.actor.transform.x);
      this.velocity.x = Math.abs(this.velocity.x) * away;
      rallyState(this.world).rallies += 1;
    }
  }
}
```

Both colliders sit on the default channel and answer it with `overlap`, so the
engine reports the pair and moves nothing. Reflecting off the paddle and
counting the contact are the ball's own rules.

## src/actors/paddle.ts

```ts
import { ColliderComponent, Pawn, ShapeComponent } from "@test-cabinet/structured-2d";
import type { Shape } from "@test-cabinet/structured-2d";
import { FILLS, PADDLE, TAGS } from "../constants";

const SHAPE: Shape = { kind: "rect", width: PADDLE.width, height: PADDLE.height };

export class Paddle extends Pawn {
  readonly body = this.attach(new ShapeComponent({ shape: SHAPE, fill: FILLS.paddle }));
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
its own, so both paddles are one class driven by two controllers.

## src/levels/rally-mode.ts

```ts
import { GameMode, PlayerController } from "@test-cabinet/structured-2d";
import type { Controller, Transform } from "@test-cabinet/structured-2d";
import { CUES, HEIGHT, PADDLE, SCORE_LIMIT, WIDTH } from "../constants";
import { Ball } from "../actors/ball";
import { Paddle } from "../actors/paddle";
import { RallyPlayerState, RallyState } from "../state";

class PaddleController extends PlayerController {
  override tick(dt: number): void {
    const pawn = this.pawn;
    if (pawn === null) return;
    const side = this.index === 0 ? "p1" : "p2";
    const dir = this.input.value(`${side}-down`) - this.input.value(`${side}-up`);
    const half = PADDLE.height / 2;
    const y = pawn.transform.y + dir * PADDLE.speed * dt;
    pawn.transform.y = Math.min(Math.max(y, half), HEIGHT - half);
  }
}

export class RallyMode extends GameMode {
  declare readonly state: RallyState;

  override gameStateClass = RallyState;
  override playerStateClass = RallyPlayerState;
  override playerControllerClass = PaddleController;
  override pawnClass = Paddle;

  override beginPlay(): void {
    this.addPlayer({ index: 0, name: "left" });
    this.addPlayer({ index: 1, name: "right" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const left = controller.playerState.index === 0;
    const x = left ? PADDLE.inset : WIDTH - PADDLE.inset;
    return { x, y: HEIGHT / 2, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    const ball = this.world.find(Ball);
    if (ball === null) return;
    const x = ball.transform.x;
    if (x >= 0 && x <= WIDTH) return;

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
begun play, is where a paddle first exists.

The mode ticks after every actor has ticked and after collision has been
reported, so it decides the point from a settled world. `restart` destroys a
controller's pawn, spawns `pawnClass` at `spawnPoint(controller)`, and possesses
it.

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
