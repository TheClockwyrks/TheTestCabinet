---
title: Pawns and Controllers
---

A build with two rovers on a square arena: one driven by a player through the
action registry and one driven by a computer opponent that reads the world. Both
rovers are the same class, and the side that differs is which controller holds
the pawn.

## src/constants.ts

```ts
import type { ActionBinding } from "@test-cabinet/structured-3d";

export const WIDTH = 640;
export const HEIGHT = 360;

export const ARENA = 8;
export const MARGIN = 2;
export const ROVER_RADIUS = 0.5;
export const ROVER_SPEED = 6;
export const DEAD_ZONE = 0.75;

export const LEVEL = "duel";

export const TAGS = {
  rover: "rover",
  player: "player-rover",
  opponent: "opponent-rover",
} as const;

export const BINDINGS: Record<string, ActionBinding> = {
  "move-forward": { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  "move-back": { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  "move-left": { keys: ["KeyA", "ArrowLeft"], kind: "analog" },
  "move-right": { keys: ["KeyD", "ArrowRight"], kind: "analog" },
  confirm: { keys: ["Enter", "Space"] },
};
```

The four move actions are the `stick-move` vocabulary and `confirm` is a menu
action, so all five carry the layout once the engine is built with it. The
arena is a square of `ARENA` world units' half-extent in the ground plane,
a rule the game states rather than a size it reads anywhere.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-3d";
import { HEIGHT, WIDTH } from "./constants";
import { duel } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  background: "#0b0f16",
  layout: "stick-move",
  game: duel,
});

await engine.initialize();
await engine.run();
```

`layout` selects the touch layout before anything is registered, so each action
in that layout's vocabulary is tagged with it as the instance registers it.

## src/game.ts

```ts
import { GameInstance } from "@test-cabinet/structured-3d";
import type { GameDefinition, InitApi } from "@test-cabinet/structured-3d";
import { BINDINGS, LEVEL } from "./constants";
import { DuelMode } from "./levels/duel-mode";

export class DuelGame extends GameInstance<null> {
  override initialize(api: InitApi): null {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }
    return null;
  }
}

export const duel: GameDefinition<null> = {
  instance: DuelGame,
  levels: { [LEVEL]: { mode: DuelMode } },
  startLevel: LEVEL,
};
```

The instance registers the bindings once, before the start level opens. The
level declares no actors: the mode spawns both rovers as it adds its players.

## src/actors/rover.ts

```ts
import { Pawn, PlayerController, ShapeComponent } from "@test-cabinet/structured-3d";
import type { Controller } from "@test-cabinet/structured-3d";
import { ARENA, ROVER_RADIUS, ROVER_SPEED, TAGS } from "../constants";

export class Rover extends Pawn {
  private dx = 0;
  private dz = 0;

  constructor() {
    super();
    this.addTag(TAGS.rover);
    this.attach(
      new ShapeComponent({
        shape: { kind: "capsule", radius: ROVER_RADIUS, height: 0.6 },
        color: "#e6edf6",
      }),
    );
  }

  drive(x: number, z: number): void {
    const length = Math.hypot(x, z);
    const scale = length > 1 ? 1 / length : 1;
    this.dx = x * scale;
    this.dz = z * scale;
  }

  override possessedBy(controller: Controller): void {
    const side =
      controller instanceof PlayerController ? TAGS.player : TAGS.opponent;
    this.addTag(side);
  }

  override tick(dt: number): void {
    const limit = ARENA - ROVER_RADIUS;
    const p = this.transform.position;
    p.x = Math.min(Math.max(p.x + this.dx * ROVER_SPEED * dt, -limit), limit);
    p.z = Math.min(Math.max(p.z + this.dz * ROVER_SPEED * dt, -limit), limit);
    this.dx = 0;
    this.dz = 0;
  }
}
```

`drive` records an intent on the ground plane and `tick` integrates it against
the delta, so the pawn holds the movement rule and the controller holds the
decision. Clamping the intent to unit length keeps a diagonal no faster than a
straight line, and movement is an assignment to `transform.position`'s fields,
in world units. The direction returns to rest each tick, so a rover stops when
its controller stops driving. `possessedBy` is where the pawn learns which side
it is on.

## src/controllers/rover-player.ts

```ts
import { PlayerController } from "@test-cabinet/structured-3d";
import { Rover } from "../actors/rover";

export class RoverPlayer extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    pawn.drive(
      this.input.value("move-right") - this.input.value("move-left"),
      this.input.value("move-back") - this.input.value("move-forward"),
    );

    if (this.input.pressed("confirm")) {
      this.world.mode.restart(this);
    }
  }
}
```

`value` is the held read: all four move actions are analog, so a key reports `1`
while it is down and the stick reports the deflection it is pushed to, and
taking each axis as the difference of its opposed pair makes holding both report
`0`. The camera sits above the player's end looking toward the opponent, so
forward is −z and the two differences are a ground-plane direction. `pressed` is
the edge read, true once per press and consumed by the call, so one press costs
one `restart`, which respawns the rover at the mode's spawn point and possesses
it.

## src/controllers/rover-ai.ts

```ts
import { AIController } from "@test-cabinet/structured-3d";
import { Rover } from "../actors/rover";
import { DEAD_ZONE, TAGS } from "../constants";

export class RoverAI extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    const target = this.world.byTag(TAGS.player)[0];
    if (target === undefined) return;

    const dx = target.transform.position.x - pawn.transform.position.x;
    const dz = target.transform.position.z - pawn.transform.position.z;
    if (Math.hypot(dx, dz) < DEAD_ZONE) return;
    pawn.drive(dx, dz);
  }
}
```

The opponent reaches the same `drive` call from the world: it finds the player's
rover by tag and chases it across the ground plane, and the dead zone keeps it
still once close. `drive` normalizes what it is handed, so the chase runs at one
speed however far the target sits.

## src/levels/duel-mode.ts

```ts
import { GameMode, PlayerController, quatFromAxisAngle } from "@test-cabinet/structured-3d";
import type { Controller, Transform } from "@test-cabinet/structured-3d";
import { ARENA, MARGIN } from "../constants";
import { Rover } from "../actors/rover";
import { RoverAI } from "../controllers/rover-ai";
import { RoverPlayer } from "../controllers/rover-player";

const UP = { x: 0, y: 1, z: 0 };

export class DuelMode extends GameMode {
  override playerControllerClass = RoverPlayer;
  override pawnClass = Rover;

  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 12, z: 16 };
    this.world.camera.lookAt({ x: 0, y: 0, z: 0 });
    this.addPlayer({ name: "Player" });
    this.addBot(RoverAI, { name: "Opponent" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const player = controller instanceof PlayerController;
    return {
      position: { x: 0, y: 0, z: player ? ARENA - MARGIN : MARGIN - ARENA },
      rotation: quatFromAxisAngle(UP, player ? 0 : Math.PI),
      scale: { x: 1, y: 1, z: 1 },
    };
  }
}
```

`addPlayer` builds the player state, builds a `RoverPlayer` because the options
name no controller, spawns a `Rover` at `spawnPoint`, and possesses it. `addBot`
does the same with the `RoverAI` it is handed. `spawnPoint` returns a whole
`Transform`, all three fields; the base implementation returns the identity, so
a mode that places its pawns overrides it, here putting each rover at its own
end and turning the opponent to face across. The camera is part of the world, so
the mode frames the arena in `beginPlay`: `lookAt` aims −Z at the origin from
above the player's end.

## The two controllers are interchangeable

`Rover` exposes `drive` and integrates what it is given, so a controller is free
to compute that pair however it likes. `RoverPlayer` computes it from four
actions and `RoverAI` computes it from another actor's transform, and the pawn
behaves the same way under either.

Controllers tick before any actor, in the order they were added, so both rovers
observe a direction set this frame. Swapping the class handed to `addBot`, or
handing `addPlayer` a different `controller`, changes who decides.

## Driving a pawn from a check

A check drives the game the way a player does, with a controller of its own:

```ts
class HoldForward extends AIController {
  override tick(): void {
    (this.pawn as Rover).drive(0, -1);
  }
}

const scripted = world.mode.addBot(HoldForward, { pawn: null });
scripted.possess(world.byTag(TAGS.player)[0] as Rover);
await engine.advance(60);
```

`possess` unpossesses whatever controller already held that pawn, so the
player's rover answers to the scripted controller from the next frame. The
movement rule, the frame order, and the clamp against the arena are the ones a
player exercises, so the check measures the build rather than a path beside it.
