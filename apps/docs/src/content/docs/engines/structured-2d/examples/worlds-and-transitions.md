---
title: Worlds and Transitions
---

Relay runs in three levels. `menu` waits for a confirm, `match` scores taps
against a timer, and `results` reports the score before returning to the menu.
The best score across every match lives on the game instance, the one framework
object that survives a level transition.

## src/constants.ts

```ts
import type { ActionBinding } from "@clockwyrks/structured-2d";

export const WIDTH = 640;
export const HEIGHT = 360;
export const BACKGROUND = "#0b0f16";
export const TEXT = "#e6edf6";

export const LEVELS = {
  menu: "menu",
  match: "match",
  results: "results",
} as const;

export const ACTIONS: Record<string, ActionBinding> = {
  confirm: { keys: ["Enter", "Space"] },
};

export const MATCH_SECONDS = 20;
export const RESULTS_SECONDS = 4;
```

## src/main.ts

```ts
import { createEngine } from "@clockwyrks/structured-2d";
import { BACKGROUND, HEIGHT, WIDTH } from "./constants";
import { relay } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");
const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  background: BACKGROUND,
  game: relay,
});

await engine.initialize();
await engine.run();
```

## src/game.ts

```ts
import type { GameDefinition } from "@clockwyrks/structured-2d";
import { LEVELS } from "./constants";
import { RelayInstance } from "./instance";
import { MatchMode } from "./levels/match-mode";
import { MenuMode } from "./levels/menu-mode";
import { ResultsMode } from "./levels/results-mode";

export const relay: GameDefinition<null> = {
  instance: RelayInstance,
  levels: {
    [LEVELS.menu]: { mode: MenuMode },
    [LEVELS.match]: { mode: MatchMode },
    [LEVELS.results]: { mode: ResultsMode },
  },
  startLevel: LEVELS.menu,
};
```

A level is a description. Each entry names the game mode class the engine
constructs when that level is opened, and `startLevel` names a key of `levels`.

## src/instance.ts

```ts
import { GameInstance, type InitApi } from "@clockwyrks/structured-2d";
import { ACTIONS } from "./constants";

let built: RelayInstance | null = null;

export function instance(): RelayInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

export class RelayInstance extends GameInstance<null> {
  bestScore = 0;

  override initialize(api: InitApi): null {
    built = this;
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, binding);
    }
    api.diagnostics.register("best", () => this.bestScore);
    return null;
  }
}
```

`initialize` runs once, before the start level opens. What it registers through
`InitApi` belongs to the whole game and outlives every transition. `initialize`
also records the instance in a module accessor, which is how a game mode reaches
the figures that travel with it. `engine` is assigned before `initialize` runs,
so a constructor sets defaults and nothing more.

## src/levels/menu-mode.ts

```ts
import { Actor, GameMode, TextComponent } from "@clockwyrks/structured-2d";
import type { PlayerController } from "@clockwyrks/structured-2d";
import { HEIGHT, LEVELS, TEXT, WIDTH } from "../constants";
import { instance } from "../instance";

class Prompt extends Actor {
  readonly label = this.attach(new TextComponent({ text: "", fill: TEXT }));
}

export class MenuMode extends GameMode {
  override pawnClass = null;
  private player!: PlayerController;

  override beginPlay(): void {
    this.player = this.addPlayer({ name: "player" });
    this.world.spawn(Prompt, {
      transform: { x: WIDTH / 2, y: HEIGHT / 2 },
      configure: (prompt) => {
        prompt.label.text = `RELAY    best ${instance().bestScore}    ENTER`;
      },
    });
  }

  override tick(): void {
    if (this.player.input.pressed("confirm")) this.world.open(LEVELS.match);
  }
}
```

The menu's controller possesses nothing, so `pawnClass` is `null` and
`addPlayer` builds a player state and a controller alone, whose `input` is where
the build reads an action.

## src/levels/match-mode.ts

```ts
import { Actor, GameMode, TextComponent } from "@clockwyrks/structured-2d";
import type { PlayerController } from "@clockwyrks/structured-2d";
import { HEIGHT, LEVELS, MATCH_SECONDS, TEXT, WIDTH } from "../constants";

class Readout extends Actor {
  readonly label = this.attach(new TextComponent({ text: "", fill: TEXT }));
}

export class MatchMode extends GameMode {
  override pawnClass = null;
  private player!: PlayerController;
  private readout!: Readout;

  override beginPlay(): void {
    this.player = this.addPlayer({ name: "player" });
    this.readout = this.world.spawn(Readout, {
      transform: { x: WIDTH / 2, y: HEIGHT / 2 },
    });
    this.setPhase("playing");
    this.world.after(MATCH_SECONDS, () => this.finish());
  }

  override tick(): void {
    const player = this.player.playerState;
    if (this.player.input.pressed("confirm")) player.score += 1;
    const left = Math.max(MATCH_SECONDS - this.state.elapsed, 0);
    this.readout.label.text = `${player.score}    ${left.toFixed(1)}s`;
  }

  private finish(): void {
    this.setPhase("over");
    this.world.open(LEVELS.results, { score: this.player.playerState.score });
  }
}
```

`elapsed` accumulates only while the phase is `"playing"`, so the readout counts
match time rather than world time.

## src/levels/results-mode.ts

```ts
import { Actor, GameMode, TextComponent } from "@clockwyrks/structured-2d";
import { HEIGHT, LEVELS, RESULTS_SECONDS, TEXT, WIDTH } from "../constants";
import { instance } from "../instance";

class Summary extends Actor {
  readonly label = this.attach(new TextComponent({ text: "", fill: TEXT }));
}

export class ResultsMode extends GameMode {
  override pawnClass = null;

  override beginPlay(): void {
    const score = Number(this.options.score ?? 0);
    const game = instance();
    game.bestScore = Math.max(game.bestScore, score);
    this.setPhase("over");
    this.world.spawn(Summary, {
      transform: { x: WIDTH / 2, y: HEIGHT / 2 },
      configure: (summary) => {
        summary.label.text = `SCORED ${score}    BEST ${game.bestScore}`;
      },
    });
    this.world.after(RESULTS_SECONDS, () => {
      this.world.open(LEVELS.menu);
    });
  }
}
```

## The transition

`world.open(LEVELS.results, { score })` requests a transition. The request is
deferred to the end of the frame, so the tick that made it finishes against a
world that is still whole, and one request per frame is honored.

1. `world:opening` is emitted, carrying `match` and `results`.
2. The instance's `worldClosing` runs.
3. The match world's timers are cleared and its diagnostic sources are dropped.
4. Each controller's `endPlay("level-closed")` runs, in reverse order.
5. Each actor's components' and then each actor's `endPlay("level-closed")`
   runs, in reverse spawn order.
6. `MatchMode.endPlay("level-closed")` runs.
7. `world:closed` is emitted.
8. The `results` level's `load` runs and is awaited.
9. The world is built: `ResultsMode` is constructed with `{ score }`, then the
   game state, then the level's declared actors in order.
10. Every declared actor's `beginPlay` runs, in spawn order.
11. `ResultsMode.beginPlay` runs, folding `score` into `bestScore`.
12. `world:opened` is emitted, then the instance's `worldOpened` runs.

A transition is asynchronous because a level's `load` is, and the loop runs no
frame while one is in flight.

## What crossed

| Survives | Is rebuilt |
| --- | --- |
| `RelayInstance` and its `bestScore` | The world, `ResultsMode`, and the game state |
| The action bindings registered from `InitApi` | Every actor, component, and controller |
| The instance's diagnostic source | The player states |
| Subscriptions on `engine.events` | World timers and world-level diagnostic sources |
| The frame counter and accumulated simulated time | `world.time`, which restarts at zero |

`{ score }` reaches the next level as `ResultsMode.options`. A figure that must
outlive a transition is written onto the instance, which is what `bestScore` is.
