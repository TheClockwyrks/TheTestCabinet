# Game modes

A game mode is the rules of a match. A level names its class, and opening the
level constructs the mode with the options the transition supplied, builds the
game state from the mode's `gameStateClass`, and runs its `beginPlay` after
every declared actor has begun play. The mode is the only object that adds
players and bots, restarts their pawns, moves the match through its phases, and
decides when the match is over.

## `GameMode`

```ts
type GameModeClass = new () => GameMode;

class GameMode {
  readonly world: World;
  readonly options: Readonly<Record<string, unknown>>;
  readonly state: GameState;
  readonly phase: MatchPhase;

  gameStateClass: new () => GameState;
  playerStateClass: new () => PlayerState;
  playerControllerClass: ControllerClass<PlayerController>;
  pawnClass: ActorClass<Pawn> | null;

  beginPlay(): void;
  tick(dt: number): void;
  endPlay(reason: EndPlayReason): void;

  addPlayer(options?: PlayerOptions): PlayerController;
  addBot(type: ControllerClass<AIController>, options?: BotOptions): AIController;
  restart(controller: Controller): Pawn | null;
  spawnPoint(controller: Controller): Transform;
  pawnDied(controller: Controller, pawn: Pawn): void;
  setPhase(phase: MatchPhase): void;
}
```

| Member | Semantics |
| --- | --- |
| `world` | The world this mode governs. |
| `options` | Whatever `world.open` was given, or an empty object for the start level. |
| `state` | The world's game state, the instance built from `gameStateClass`. |
| `phase` | The match phase. `"waiting"` when the mode begins play. |
| `gameStateClass` | Defaults to `GameState`. Read once, when the world is built. |
| `playerStateClass` | Defaults to `PlayerState`. Read on each `addPlayer` and `addBot`. |
| `playerControllerClass` | Defaults to `PlayerController`. The controller `addPlayer` builds when its options name none. |
| `pawnClass` | Defaults to `null`. The pawn `restart` spawns. `null` for a mode whose controllers possess nothing. |
| `beginPlay` | Runs after every declared actor has begun play. Where a mode adds its players and sets its phase. |
| `tick` | Runs once per frame, after every actor has ticked and after collision has been reported. |
| `endPlay` | Runs when the world closes, after every actor has ended play. |
| `addPlayer` | Builds the player state, the player controller, and the pawn, and possesses. Assigns the next free index when the options name none. |
| `addBot` | The same for an AI controller whose class the caller names. |
| `restart` | Destroys the controller's current pawn, spawns `pawnClass` at `spawnPoint(controller)`, and possesses it. Returns `null` when `pawnClass` is `null`. |
| `spawnPoint` | Where `restart` places a pawn, as a whole `Transform`. The base implementation returns the identity transform. |
| `pawnDied` | Runs when a possessed pawn is destroyed, after the pawn's `endPlay`. |
| `setPhase` | Sets the phase, writes it onto the game state, and emits `match:phase`. Setting the phase it already holds emits nothing. |

A mode is constructed with no arguments, so a constructor sets its class fields
and its own defaults; `world`, `options`, and `state` are assigned before
`beginPlay` runs. The base class's `beginPlay`, `tick`, `endPlay`, and
`pawnDied` do nothing, so a mode overrides only what it needs.

```ts
import { GameMode } from "@clockwyrks/structured-3d";
import { ShipPawn } from "./actors";
import { ShipController } from "./controllers";
import { ArenaPlayerState, ArenaState } from "./state";

export class ArenaMode extends GameMode {
  declare readonly state: ArenaState;

  gameStateClass = ArenaState;
  playerStateClass = ArenaPlayerState;
  playerControllerClass = ShipController;
  pawnClass = ShipPawn;
}
```

Redeclaring `state` with `declare` narrows its type to the subclass the mode
built without emitting a field of its own, so `this.state` reads the match's own
figures without a cast at every use.

## `MatchPhase`

```ts
type MatchPhase = "waiting" | "playing" | "over";
```

| Phase | Meaning |
| --- | --- |
| `waiting` | The match is being set up. This is the phase a mode holds when it begins play. |
| `playing` | The match is running. `GameState.elapsed` accumulates only in this phase. |
| `over` | The match is decided. |

The phase changes only through `setPhase`. Each call writes the phase onto the
game state and emits `match:phase`, so anything that reacts to the match
starting or ending subscribes rather than polls. An actor that should stand
still before the whistle reads `this.world.state.phase` in its own tick.

```ts
"match:phase": { phase: MatchPhase; previous: MatchPhase };
```

## Adding players and bots

`beginPlay` runs after every declared actor has begun play, so the world is
fully built when the mode adds its participants.

```ts
override beginPlay(): void {
  this.addPlayer({ name: "Left" });
  this.addBot(ShipBot, { name: "Right" });

  this.world.after(COUNTDOWN, () => this.setPhase("playing"));
}
```

Each call assigns the next free index, so the player above carries index `0` and
the bot index `1`. `state.players` holds both, in index order, and a bot's
player state is a player state like any other.

```ts
interface PlayerOptions {
  index?: number;
  name?: string;
  controller?: ControllerClass<PlayerController>;
  pawn?: ActorClass<Pawn> | null;
}

interface BotOptions {
  name?: string;
  pawn?: ActorClass<Pawn> | null;
}
```

| Field | Meaning |
| --- | --- |
| `index` | The index the player state carries. Absent, `addPlayer` assigns the next free index. |
| `name` | The name written onto the player state. |
| `controller` | The controller class to build. Absent, `addPlayer` builds `playerControllerClass`. |
| `pawn` | The pawn class to spawn and possess, in place of `pawnClass`. `null` adds a controller that possesses nothing. |

`addBot` takes the controller class as its first argument, so `BotOptions` names
no controller.

## The match's own figures

```ts
class GameState {
  readonly world: World;
  readonly players: readonly PlayerState[];
  phase: MatchPhase;
  elapsed: number;
}

class PlayerState {
  readonly index: number;
  readonly controller: Controller;
  name: string;
  score: number;
}
```

`elapsed` is seconds accumulated while the phase is `"playing"` — the match
clock rather than the world clock. A game carries what its match counts by
subclassing `GameState`, and what each participant counts by subclassing
`PlayerState`. Both are plain classes, so a field with an initializer is all a
figure needs.

```ts
import { GameState, PlayerState } from "@clockwyrks/structured-3d";

export class ArenaState extends GameState {
  rounds = 0;
  sinceServe = 0;
}

export class ArenaPlayerState extends PlayerState {
  lives = 3;
}
```

Anything a match keeps belongs on the game state rather than on the mode, since
the state is what the rest of the world reads: an actor reaches it through
`world.state` and a controller through `this.world.state`. The player state is
the durable half of a participant — it survives every respawn its controller
performs — while a value that must survive a level transition lives on the game
instance instead.

## Deciding the match in `tick`

The mode ticks after every actor has ticked and after collision has been
reported, so it decides the match from a settled world. A tick that gates on the
phase runs its rules only while the match is live, and the gate is also what
keeps the ending from running twice: the frame that sets `"over"` is the last
frame the rules run in.

```ts
import { vec3 } from "@clockwyrks/structured-3d";

override tick(dt: number): void {
  if (this.phase !== "playing") return;

  this.state.sinceServe += dt;
  if (this.state.sinceServe >= SERVE_DELAY && !this.world.find(Ball)) {
    this.world.spawn(Ball, {
      transform: { position: vec3(0, 1, 0) },
      tags: [TAGS.ball],
    });
    this.state.rounds += 1;
    this.state.sinceServe = 0;
  }

  const leader = this.state.players.find((p) => p.score >= TARGET_SCORE);
  if (!leader) return;

  this.setPhase("over");
  this.world.after(END_DELAY, () => {
    this.world.open("title", { winner: leader.index });
  });
}
```

## Respawning and reacting to a death

`restart` destroys the controller's current pawn, spawns `pawnClass` at
`spawnPoint(controller)`, and possesses it. A mode that wants its participants
somewhere other than the origin overrides `spawnPoint` and returns a whole
transform, reading the controller's player state so the placement follows the
participant rather than the pawn that just died:

```ts
import { UP, VEC3_ONE, quatFromAxisAngle, vec3 } from "@clockwyrks/structured-3d";

override spawnPoint(controller: Controller): Transform {
  const side = controller.playerState.index === 0 ? -1 : 1;
  return {
    position: vec3(side * 8, 0, 0),
    rotation: quatFromAxisAngle(UP, (side * Math.PI) / 2),
    scale: VEC3_ONE,
  };
}
```

`pawnDied` runs when a possessed pawn is destroyed, after the pawn's `endPlay`
and after it has been unpossessed. It receives the controller left without a
pawn and the pawn it lost, so a mode reads the pawn's last transform before
deciding what to do:

```ts
override pawnDied(controller: Controller, pawn: Pawn): void {
  this.world.spawn(Debris, {
    transform: { position: pawn.transform.position },
  });

  const player = controller.playerState as ArenaPlayerState;
  player.lives -= 1;
  if (player.lives > 0) {
    this.world.after(RESPAWN_DELAY, () => this.restart(controller));
  }
}
```

## Ending a match

A match ends by opening the next level with the figures the next mode needs.
The options are read by the incoming mode as `this.options`, typed as unknown
values, so the receiving mode narrows what it uses:

```ts
import { GameMode } from "@clockwyrks/structured-3d";
import { Banner } from "./actors";

export class TitleMode extends GameMode {
  pawnClass = null;

  override beginPlay(): void {
    this.addPlayer({ name: "Player 1" });

    const winner = this.options.winner;
    if (typeof winner === "number") {
      this.world.spawn(Banner, {
        configure: (banner) => {
          banner.text = `Player ${winner + 1} wins`;
        },
      });
    }
  }

  override tick(): void {
    const [player] = this.world.players();
    if (player?.input.pressed("confirm") === true) this.world.open("arena");
  }
}
```

A title screen possesses nothing, so its `pawnClass` is `null` and `addPlayer`
builds a controller alone. That controller is still what reads the menu actions,
since an action reaches the game only through a player controller. See
`controllers.md`.

## Errors

| Condition | Result |
| --- | --- |
| `beginPlay` throws while the start level is opening | `engine.initialize` rejects with the cause |
| `tick` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| `tick` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
