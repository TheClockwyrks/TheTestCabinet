---
title: Game Modes
---

A build writes the rules of a match as a subclass of
[`GameMode`](/engines/structured-3d/apis/game-mode/). The mode names the classes
its match is built from, adds its participants in `beginPlay`, moves the match
through its phases, decides it in `tick`, and opens the next level when it is
over. A level names the class, and the engine constructs it, ticks it, and ends
its play with the world.

```ts
import { GameMode } from "@clockwyrks/structured-3d";
import { PaddlePawn } from "./actors";
import { PaddleController } from "./controllers";
import { RallyPlayerState, RallyState } from "./state";

export class RallyMode extends GameMode {
  declare readonly state: RallyState;

  gameStateClass = RallyState;
  playerStateClass = RallyPlayerState;
  playerControllerClass = PaddleController;
  pawnClass = PaddlePawn;
}
```

Redeclaring `state` with `declare` narrows its type to the subclass the mode
built without emitting a field of its own, so `this.state` reads the match's own
figures without a cast at every use.

## The four class fields

The engine builds a match out of the classes the mode names, so a game supplies
its own subclasses in place of the framework's defaults.

| Field                   | Read                                                 | Builds                                            |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `gameStateClass`        | Once, when the world is built                        | The game state the world exposes as `world.state` |
| `playerStateClass`      | On each `addPlayer` and `addBot`                     | The participant's player state                    |
| `playerControllerClass` | On each `addPlayer` whose options name no controller | The player controller                             |
| `pawnClass`             | On each `restart`                                    | The pawn the controller possesses                 |

A mode whose controllers possess nothing sets `pawnClass` to `null`, and
`restart` then returns `null`.

The level registry names the mode class, and the engine constructs it with
whatever `world.open` was given.

```ts
import type { GameDefinition } from "@clockwyrks/structured-3d";
import { Ball, Net } from "./actors";
import { RallyMode } from "./rally-mode";
import { TitleMode } from "./title-mode";

export const game: GameDefinition = {
  levels: {
    title: { mode: TitleMode },
    court: {
      mode: RallyMode,
      actors: [{ type: Net }, { type: Ball, tags: ["ball"] }],
    },
  },
  startLevel: "title",
};
```

## Adding players and bots

`beginPlay` runs after every declared actor has begun play, so the world is
fully built when the mode adds its participants. `addPlayer` builds the player
state, the player controller, and the pawn, and possesses; `addBot` does the
same for an AI controller whose class it takes as its first argument.

```ts
import { PaddleBot } from "./controllers";
import { COUNTDOWN } from "./constants";

beginPlay() {
  this.addPlayer({ name: "Left" });
  this.addBot(PaddleBot, { name: "Right" });

  this.world.after(COUNTDOWN, () => this.setPhase("playing"));
}
```

Each call assigns the next free index, so the player above carries index `0` and
the bot index `1`. `state.players` holds both, in index order, and a bot's
player state is a player state like any other.

`PlayerOptions` names an index, a name, a controller class, and a pawn class,
each in place of what the mode would otherwise choose. A two-player match that
wants a different controller per side supplies one.

```ts
beginPlay() {
  this.addPlayer({ index: 0, name: "Left", controller: LeftPaddle });
  this.addPlayer({ index: 1, name: "Right", controller: RightPaddle });
}
```

## The match's own figures

A game carries what its match counts by subclassing `GameState`, and what each
participant counts by subclassing `PlayerState`. Both are plain classes, so a
field with an initializer is all a figure needs.

```ts
import { GameState, PlayerState } from "@clockwyrks/structured-3d";

export class RallyState extends GameState {
  rallies = 0;
  sinceServe = 0;
}

export class RallyPlayerState extends PlayerState {
  lives = 3;
}
```

The base classes already carry the figures every match has: `phase` and
`elapsed` on the game state, `index`, `name`, and `score` on the player state.
`elapsed` accumulates only while the phase is `"playing"`, so it is the match
clock and needs nothing from the game.

Anything a match keeps belongs on the game state rather than on the mode, since
the state is what the rest of the world reads. An actor reaches it through
`world.state` and a controller through `this.world.state`.

## Driving the phases

A mode holds `"waiting"` when it begins play, and `setPhase` is what moves it
on. Each call writes the phase onto the game state and emits `match:phase`, so
anything that reacts to the match starting or ending subscribes rather than
polls.

```ts
private stopWatchingPhase = () => {};

beginPlay() {
  this.addPlayer({ name: "Left" });
  this.addBot(PaddleBot, { name: "Right" });

  this.stopWatchingPhase = this.world.events.on("match:phase", (event) => {
    if (event.phase === "over") this.world.audio.play("fanfare");
  });

  this.world.after(COUNTDOWN, () => this.setPhase("playing"));
}

endPlay() {
  this.stopWatchingPhase();
}
```

`on` returns the function that removes the handler, and a subscription lives on
the engine rather than on the world, so a mode releases its handlers in
`endPlay` and the next level starts with none of them attached.

Setting the phase the mode already holds emits nothing, so a guard against
repeat calls is unnecessary. An actor that should stand still before the whistle
reads `this.world.state.phase` in its own tick.

## Deciding the match in `tick`

The mode ticks after every actor has ticked and after collision has been
reported, so it decides the match from a settled world. A tick that gates on the
phase runs its rules only while the match is live.

```ts
import { Ball } from "./actors";
import { END_DELAY, SERVE_DELAY, TARGET_SCORE } from "./constants";

tick(dt: number) {
  if (this.phase !== "playing") return;

  this.state.sinceServe += dt;
  if (this.state.sinceServe >= SERVE_DELAY && !this.world.find(Ball)) {
    this.world.spawn(Ball, { tags: ["ball"] });
    this.state.rallies += 1;
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

The phase guard is also what keeps the ending from running twice: the frame that
sets `"over"` is the last frame the rules run in. Keeping one win condition in
one place is what makes the match decidable from the game state alone.

## Respawning

`restart` destroys the controller's current pawn, spawns `pawnClass` at
`spawnPoint(controller)`, and possesses it. A mode that wants its participants
somewhere other than the world origin overrides `spawnPoint` and returns a whole
transform: a position, a rotation, and a scale.

```ts
import {
  UP,
  VEC3_ONE,
  quatFromAxisAngle,
  vec3,
  type Controller,
  type Transform,
} from "@clockwyrks/structured-3d";
import { COURT, MARGIN } from "./constants";

spawnPoint(controller: Controller): Transform {
  const left = controller.playerState.index === 0;
  return {
    position: vec3(left ? -COURT.halfWidth + MARGIN : COURT.halfWidth - MARGIN, 0, 0),
    rotation: quatFromAxisAngle(UP, left ? -Math.PI / 2 : Math.PI / 2),
    scale: VEC3_ONE,
  };
}
```

`spawnPoint` reads the controller's player state, so the placement follows the
participant rather than the pawn that just died. The player state survives every
respawn, which is what lets a side keep its end of the court across all of them.
The rotation turns each pawn about the world's up axis to face the net, so a
pawn whose forward axis is `FORWARD` rotated by its transform arrives facing
into play.

## Reacting to a death

`pawnDied` runs when a possessed pawn is destroyed, after the pawn's `endPlay`
and after it has been unpossessed. It receives the controller left without a
pawn and the pawn it lost, so a mode reads the pawn's last transform before
deciding what to do.

```ts
import type { Controller, Pawn } from "@clockwyrks/structured-3d";
import { Debris } from "./actors";
import { RESPAWN_DELAY, TARGET_SCORE } from "./constants";
import type { RallyPlayerState } from "./state";

pawnDied(controller: Controller, pawn: Pawn) {
  this.world.spawn(Debris, {
    transform: { position: { ...pawn.transform.position } },
  });
  this.world.audio.play("burst", { at: pawn.transform.position });

  const player = controller.playerState as RallyPlayerState;
  player.lives -= 1;

  if (player.lives > 0) {
    this.world.after(RESPAWN_DELAY, () => this.restart(controller));
    return;
  }

  for (const other of this.state.players) {
    if (other !== player) other.score = TARGET_SCORE;
  }
}
```

Exhausting a side's lives awards the match to the other side, and the mode's
`tick` reads that score on the next frame and ends the match. Routing both
endings through the one win condition keeps the match decided in a single place.
The burst is played with `at`, so it sounds from where the pawn was lost as
heard from the camera.

## Ending a match

A match ends by opening the next level with the figures the next mode needs.
`world.open` requests the transition and returns at once; the request is honored
at the end of the frame, after the ticks and the collision pass, so the mode
that requested it finishes its frame normally.

The options are read by the incoming mode as `this.options`, typed as unknown
values, so the receiving mode narrows what it uses.

```ts
import { GameMode } from "@clockwyrks/structured-3d";
import { Banner } from "./actors";

export class TitleMode extends GameMode {
  pawnClass = null;

  beginPlay() {
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

  tick() {
    const [player] = this.world.players();
    if (player?.input.pressed("confirm")) this.world.open("court");
  }
}
```

A title screen possesses nothing, so its `pawnClass` is `null` and `addPlayer`
builds a controller alone. That controller is still what reads the menu actions,
since an action reaches the game through a player controller.

The start level's `options` is an empty object, so a mode that reads a figure
from a previous match tests for it as the title mode does above.
