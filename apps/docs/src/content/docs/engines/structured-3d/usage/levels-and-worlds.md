---
title: Levels and Worlds
---

A build declares its levels once, on the game definition the engine is created
with. Each level names the game mode that runs it, lists the actors it places,
and loads the assets it needs. The engine opens `startLevel` when it
initializes, and the game travels afterwards by naming another level.

```ts
// src/game.ts
import type { GameDefinition } from "@test-cabinet/structured-3d";
import { Rally } from "./instance";
import { arena, title } from "./levels";

export const game: GameDefinition = {
  instance: Rally,
  levels: { title, arena },
  startLevel: "title",
};
```

The keys of `levels` are the names a build travels by, so a case fixes them in
its constants module and every build of the case agrees on them. `startLevel`
must be one of those keys, and `instance` is optional: a game that keeps nothing
across a transition omits it and takes the base game instance. Every member of
`LevelDefinition` and `World` is listed under
[worlds and levels](/engines/structured-3d/apis/worlds/).

## Placing a level's actors

`actors` lists the actors the level places. Each entry names a class and
optionally a transform, a set of tags, and a `configure` step that runs on the
constructed actor before it begins play.

```ts
// src/levels.ts
import type { LevelDefinition } from "@test-cabinet/structured-3d";
import { ARENA } from "./constants";
import { ArenaMode } from "./arena-mode";
import { Goal } from "./goal";
import { PauseMenu } from "./pause-menu";
import { TitleMode } from "./title-mode";

export const title: LevelDefinition = { mode: TitleMode };

export const arena: LevelDefinition = {
  mode: ArenaMode,
  actors: [
    {
      type: Goal,
      transform: { position: { x: -ARENA.half, y: 0, z: 0 } },
      tags: ["goal"],
      configure: (goal: Goal) => {
        goal.side = "left";
      },
    },
    {
      type: Goal,
      transform: { position: { x: ARENA.half, y: 0, z: 0 } },
      tags: ["goal"],
      configure: (goal: Goal) => {
        goal.side = "right";
      },
    },
    { type: PauseMenu },
  ],
};
```

A transform written here is a `Partial<Transform>` applied over the identity,
and each present field replaces the whole value: an entry supplying `position`
supplies all three of its numbers. A field left out stays at the identity —
position `(0, 0, 0)`, rotation identity, scale `(1, 1, 1)`. A rotation written
here is built with `quatFromAxisAngle`.

Place the scenery here and leave the pawns to the
[game mode](/engines/structured-3d/usage/game-modes/). A mode's `restart`
spawns its `pawnClass` at its own spawn point, so a paddle, a ship, or a
character arrives through possession rather than through the level's list.

Every declared actor exists before any of their `beginPlay` runs, so an actor
that needs a peer looks it up in `beginPlay` rather than in `configure`.

```ts
// src/goal.ts
import { Actor, ColliderComponent } from "@test-cabinet/structured-3d";
import { ARENA } from "./constants";

export class Goal extends Actor {
  side: "left" | "right" = "left";

  constructor() {
    super();
    this.attach(new ColliderComponent({
      shape: { kind: "box", size: { x: 1, y: ARENA.height, z: ARENA.depth } },
      channel: "goal",
      responses: { ball: "overlap" },
    }));
  }
}
```

A constructor attaches components and sets defaults. Work that reads the world
belongs in `beginPlay`, which runs once every declared actor of the level
exists.

## Loading a level's assets

`load` runs before the world is built and the engine awaits it, so every actor
of the level finds its assets already decoded. Hold what it produced in the
level's own module and read it as a plain value.

```ts
// src/arena-assets.ts
import type { MeshHandle } from "@test-cabinet/structured-3d";

export interface ArenaMeshes {
  field: MeshHandle;
  paddle: MeshHandle;
}

let meshes: ArenaMeshes | null = null;

export function setArenaMeshes(loaded: ArenaMeshes): void {
  meshes = loaded;
}

export function arenaMeshes(): ArenaMeshes {
  if (meshes === null) throw new Error("arena assets are not loaded");
  return meshes;
}
```

```ts
export const arena: LevelDefinition = {
  mode: ArenaMode,
  actors: [/* ... */],
  async load(api) {
    const [field, paddle] = await Promise.all([
      api.assets.loadMesh("models/field.glb"),
      api.assets.loadMesh("models/paddle.glb"),
    ]);
    await api.audio.load("bounce", "audio/bounce.ogg");
    setArenaMeshes({ field, paddle });
  },
};
```

Load here what this level alone needs. An asset every level needs is loaded in
the game instance's `initialize` and held on the instance, where it survives
every transition, and so does a cue: a cue bound in one level's `load` stays
bound for the rest of the run.

## Spawning at run time

`world.spawn` constructs an actor, applies the spec, attaches it, and runs its
`beginPlay` and each component's `beginPlay` before returning. The actor is
fully live when the call returns, and its first `tick` is the next frame.

```ts
// src/arena-mode.ts
import { GameMode } from "@test-cabinet/structured-3d";
import { BALL_SPEED } from "./constants";
import { Ball } from "./ball";

export class ArenaMode extends GameMode {
  serve(): Ball {
    return this.world.spawn(Ball, {
      transform: { position: { x: 0, y: 0, z: 0 } },
      tags: ["ball"],
      configure: (ball) => {
        ball.velocity = { x: BALL_SPEED, y: 0, z: 0 };
      },
    });
  }
}
```

`spec` carries the same three fields a placed actor's entry carries, and
`configure` receives the actor at its own type, so a spawn site sets the fields
the class declares without a cast. The spec's transform replaces whole fields,
exactly as a placed entry's does.

`destroy` is the other half. It marks the actor, which stops ticking and
rendering at once, and the actor leaves the world at the end of the frame.

## Finding actors

Three lookups cover what a frame asks for. Each returns live actors in spawn
order, as a copy the caller owns.

```ts
const goals = this.world.byTag("goal");
const balls = this.world.ofType(Ball);
const ball = this.world.find(Ball);
```

`byTag` is the lookup a case's validators use, so fix the tag vocabulary in the
constants module and tag every actor a check needs to name. `ofType` and `find`
are the typed lookups a build uses on its own classes, and `find` returns `null`
when nothing matches.

```ts
tick(dt: number): void {
  const ball = this.world.find(Ball);
  if (ball === null) this.serve();
}
```

`world.actors()` returns everything, and `world.players()` returns the player
controllers in index order, which is how a mode reaches the input side of the
world.

## Scheduling with `after` and `every`

Timers count simulated world time. `after` runs a callback once and `every`
repeats it, and both return a handle `clearTimer` cancels.

```ts
// src/arena-mode.ts
import { GameMode, type TimerHandle } from "@test-cabinet/structured-3d";
import { ArenaState } from "./arena-state";

export class ArenaMode extends GameMode {
  declare readonly state: ArenaState;
  gameStateClass = ArenaState;
  private countdown: TimerHandle | null = null;

  beginPlay(): void {
    this.addPlayer({ name: "P1" });
    this.setPhase("playing");
    this.world.after(1.5, () => this.serve());
    this.countdown = this.world.every(1, () => {
      this.state.remaining -= 1;
      if (this.state.remaining === 0) this.setPhase("over");
    });
  }

  endPlay(): void {
    if (this.countdown !== null) this.world.clearTimer(this.countdown);
  }
}
```

`ArenaState` is this game's `GameState` subclass, named by `gameStateClass` and
redeclared on `state` so the mode reads its own match figures at their own type.

Clearing on the way out is optional, because a world clears its own timers when
it closes. Clearing explicitly is what stops a repeating timer that has finished
its job while the world stays open.

A paused world runs no timer, so a countdown scheduled with `every` holds its
place across a pause without the game tracking the remainder itself.

## Pausing

`world.setPaused` suspends the controllers, the actors, their components, the
timers, the collision pass, and the game mode. The world keeps rendering, so a
pause screen draws over the world it suspended.

An actor that must keep running sets `tickWhenPaused`, and reads its action
through a player controller's input, which is the only place a game reads one.

```ts
// src/pause-menu.ts
import {
  Actor,
  PlayerController,
  TextComponent,
} from "@test-cabinet/structured-3d";

export class PauseMenu extends Actor {
  private player: PlayerController | null = null;

  constructor() {
    super();
    this.tickWhenPaused = true;
    this.attach(new TextComponent({ text: "paused" })).layer = 10;
  }

  beginPlay(): void {
    this.player = this.world.players()[0] ?? null;
  }

  tick(): void {
    if (this.player?.input.pressed("pause") === true) {
      this.world.setPaused(!this.world.paused);
    }
  }
}
```

The text draws as a billboard at the menu actor's position, and its layer sits
above the scene's, so the label reads over whatever the paused world shows.
Read the pause action in one place. Each player controller consumes an edge
independently, so a second reader of the same controller's `pressed("pause")`
takes the edge this one is waiting for.

## Opening the next level

`world.open` requests a transition and returns. The engine performs it after the
frame's ticks and collision are finished and before the frame renders, so the
caller returns into a world that is still whole.

```ts
tick(dt: number): void {
  if (this.phase !== "over") return;
  this.world.open("arena", {
    round: this.round + 1,
    carried: this.state.players[0].score,
  });
}
```

The options object reaches the incoming game mode as `this.options`, before its
`beginPlay` runs. It is `Readonly<Record<string, unknown>>`, so a mode narrows
each value it reads and supplies a default for the start level, which receives
an empty object.

```ts
// src/arena-mode.ts
export class ArenaMode extends GameMode {
  round = 1;

  beginPlay(): void {
    this.round = typeof this.options.round === "number" ? this.options.round : 1;
    const player = this.addPlayer({ name: "P1" });
    if (typeof this.options.carried === "number") {
      player.playerState.score = this.options.carried;
    }
    this.setPhase("playing");
  }
}
```

One call per frame is honored, and a second call in the same frame replaces the
first, so two systems that both decide to travel produce one transition.

Options carry a value into the next match. A value that must survive many
transitions lives on the game instance instead, which is the one framework
object a transition leaves standing.
