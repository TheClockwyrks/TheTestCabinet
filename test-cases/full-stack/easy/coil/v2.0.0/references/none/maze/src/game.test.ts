import { beforeEach, describe, expect, it } from "vitest";
import {
  BITE_SECONDS,
  COMBO_WINDOW,
  CUES,
  PELLET_POINTS,
  START_CELLS,
  TICK_SECONDS,
  type Cell,
  type Cue,
} from "./constants";
import { Game, type AudioBus } from "./game";
import { menuItems } from "./menus";

/** An audio bus that records what it was asked for, and makes no sound. */
class RecordingBus implements AudioBus {
  muted = false;
  readonly played: Cue[] = [];
  readonly loops: Cue[] = [];
  readonly stopped: Cue[] = [];

  play(cue: Cue): void {
    this.played.push(cue);
  }

  startLoop(cue: Cue): void {
    this.loops.push(cue);
  }

  stopLoop(cue: Cue): void {
    this.stopped.push(cue);
  }

  toggleMute(): void {
    this.muted = !this.muted;
  }
}

let audio: RecordingBus;
let game: Game;

beforeEach(() => {
  audio = new RecordingBus();
  game = new Game(audio);
});

/** A straight chain of `length` cells running left from `(col, row)`. */
function chain(col: number, row: number, length: number): Cell[] {
  return Array.from({ length }, (_, i) => ({ col: col - i, row }));
}

describe("the opening screen", () => {
  it("opens on the title with nothing advanced", () => {
    expect(game.screen).toBe("title");
    expect(game.menuIndex).toBe(0);
    expect(game.best).toBe(0);
    expect(game.ticks).toBe(0);
    expect(game.simTime).toBe(0);
  });

  it("advances nothing on the title however much time passes", () => {
    game.update(5);
    expect(game.ticks).toBe(0);
    expect(game.simTime).toBe(0);
    expect(game.sim.snake).toEqual(START_CELLS.map((cell) => ({ ...cell })));
  });
});

describe("the tick accumulator", () => {
  beforeEach(() => {
    game.startRound();
    game.sim.clearPellet();
  });

  it("resolves eight ticks in a second of game time", () => {
    game.update(1);
    expect(game.ticks).toBe(8);
  });

  it("reaches the same state however the second was divided", () => {
    const divided = new Game(new RecordingBus());
    divided.startRound();
    divided.sim.clearPellet();
    for (let i = 0; i < 60; i++) divided.update(1 / 60);
    game.update(1);
    expect(divided.ticks).toBe(game.ticks);
    expect(divided.sim.snake).toEqual(game.sim.snake);
  });

  it("resolves no tick for an update shorter than one, and carries it", () => {
    const before = game.sim.snake.map((cell) => ({ ...cell }));
    game.update(TICK_SECONDS / 2);
    expect(game.ticks).toBe(0);
    expect(game.sim.snake).toEqual(before);
    game.update(TICK_SECONDS / 2);
    expect(game.ticks).toBe(1);
  });

  it("advances at the same rate however long the snake is", () => {
    game.sim.setSnake(chain(20, 8, 15));
    game.sim.dir = "up";
    game.update(1);
    expect(game.ticks).toBe(8);
  });

  it("accumulates simTime on the playing screen alone", () => {
    game.update(0.5);
    expect(game.simTime).toBeCloseTo(0.5, 10);
    game.goTo("paused");
    game.update(2);
    expect(game.simTime).toBeCloseTo(0.5, 10);
  });
});

describe("the screens", () => {
  it("starts a round from the title's mode entry", () => {
    game.handleAction("confirm");
    expect(game.screen).toBe("playing");
    expect(game.sim.snake).toEqual(START_CELLS.map((cell) => ({ ...cell })));
    expect(game.sim.pellet).not.toBeNull();
    expect(game.sim.score).toBe(0);
    expect(game.sim.combo).toBe(1);
    expect(game.sim.comboWindow).toBe(0);
  });

  it("reaches how to play, and returns from it", () => {
    game.handleAction("down");
    expect(game.menuIndex).toBe(1);
    game.handleAction("confirm");
    expect(game.screen).toBe("howto");
    expect(game.menuIndex).toBe(0);
    game.handleAction("back");
    expect(game.screen).toBe("title");
  });

  it("pauses with either back or pause, and resumes with either", () => {
    game.startRound();
    game.handleAction("back");
    expect(game.screen).toBe("paused");
    game.handleAction("pause");
    expect(game.screen).toBe("playing");
    game.handleAction("pause");
    expect(game.screen).toBe("paused");
    game.handleAction("back");
    expect(game.screen).toBe("playing");
  });

  it("freezes the round behind the pause screen", () => {
    game.startRound();
    game.sim.clearPellet();
    game.update(0.5);
    const before = game.sim.snake.map((cell) => ({ ...cell }));
    const ticks = game.ticks;
    game.goTo("paused");
    game.update(3);
    expect(game.ticks).toBe(ticks);
    expect(game.sim.snake).toEqual(before);
    game.handleAction("confirm");
    expect(game.screen).toBe("playing");
    expect(game.sim.snake).toEqual(before);
  });

  it("restarts and quits from the pause menu", () => {
    game.startRound();
    game.sim.score = 90;
    game.goTo("paused");
    game.handleAction("down");
    game.handleAction("confirm");
    expect(game.screen).toBe("playing");
    expect(game.sim.score).toBe(0);

    game.goTo("paused");
    game.handleAction("down");
    game.handleAction("down");
    game.handleAction("confirm");
    expect(game.screen).toBe("title");
  });

  it("ends on gameover when the head enters a fatal cell", () => {
    game.startRound();
    game.sim.clearPellet();
    game.sim.setSnake(chain(28, 8, 3));
    game.sim.dir = "right";
    game.update(TICK_SECONDS);
    expect(game.screen).toBe("gameover");
    expect(game.menuIndex).toBe(0);
  });

  it("advances nothing once the round has ended", () => {
    game.startRound();
    game.sim.clearPellet();
    game.sim.setSnake(chain(28, 8, 3));
    game.sim.dir = "right";
    game.update(TICK_SECONDS);
    const ticks = game.ticks;
    const snake = game.sim.snake.map((cell) => ({ ...cell }));
    game.update(5);
    expect(game.ticks).toBe(ticks);
    expect(game.sim.snake).toEqual(snake);
  });

  it("plays again and returns to the title from game over", () => {
    game.goTo("gameover");
    game.handleAction("confirm");
    expect(game.screen).toBe("playing");
    game.goTo("gameover");
    game.handleAction("down");
    game.handleAction("confirm");
    expect(game.screen).toBe("title");
    game.goTo("gameover");
    game.handleAction("back");
    expect(game.screen).toBe("title");
  });

  it("highlights the first item of every screen it arrives at", () => {
    game.handleAction("down");
    expect(game.menuIndex).toBe(1);
    game.handleAction("confirm");
    expect(game.menuIndex).toBe(0);
  });
});

describe("the menus", () => {
  it("wraps the highlight at both ends", () => {
    const items = menuItems("title");
    game.handleAction("up");
    expect(game.menuIndex).toBe(items.length - 1);
    game.handleAction("down");
    expect(game.menuIndex).toBe(0);
  });

  it("leaves the highlight where it is on left and right", () => {
    game.handleAction("left");
    game.handleAction("right");
    expect(game.menuIndex).toBe(0);
    expect(game.screen).toBe("title");
  });
});

describe("steering", () => {
  it("buffers a request rather than turning at the press", () => {
    game.startRound();
    game.sim.clearPellet();
    game.handleAction("up");
    expect(game.sim.dir).toBe("right");
    expect(game.sim.turns).toEqual(["up"]);
    game.update(TICK_SECONDS);
    expect(game.sim.dir).toBe("up");
  });

  it("takes no steering request on a menu screen", () => {
    game.handleAction("up");
    expect(game.sim.turns).toEqual([]);
  });
});

describe("the best score", () => {
  it("rises the instant the live score passes it", () => {
    game.startRound();
    game.sim.setSnake(chain(10, 8, 3));
    game.sim.dir = "right";
    game.sim.setPellet(11, 8);
    game.update(TICK_SECONDS);
    expect(game.sim.score).toBe(PELLET_POINTS);
    expect(game.best).toBe(PELLET_POINTS);
  });

  it("carries from one round into the next", () => {
    game.startRound();
    game.sim.score = 250;
    game.update(0);
    expect(game.best).toBe(250);
    game.startRound();
    expect(game.sim.score).toBe(0);
    expect(game.best).toBe(250);
  });

  it("is raised back to the live score when it is posed below it", () => {
    game.startRound();
    game.sim.score = 120;
    game.best = 10;
    game.update(0);
    expect(game.best).toBe(120);
  });
});

describe("audio", () => {
  it("plays the music when a round begins, and on no update before", () => {
    game.update(1);
    expect(audio.loops).toEqual([]);
    game.startRound();
    expect(audio.loops).toEqual([CUES.music]);
  });

  it("starts the bed again on every menu item that lays a fresh round", () => {
    // Title -> RESTART from the pause menu -> PLAY AGAIN from the game over.
    game.handleAction("confirm");
    game.handleAction("pause");
    game.handleAction("down");
    game.handleAction("confirm");
    game.goTo("gameover");
    game.handleAction("confirm");
    expect(audio.loops.filter((cue) => cue === CUES.music)).toHaveLength(3);
  });

  it("sounds nothing for a screen posed onto playing", () => {
    game.setScreen("playing");
    game.update(TICK_SECONDS);
    expect(audio.loops).toEqual([]);
  });

  it("stops the music when the round ends", () => {
    game.startRound();
    game.sim.clearPellet();
    game.sim.setSnake(chain(28, 8, 3));
    game.sim.dir = "right";
    game.update(TICK_SECONDS);
    expect(audio.stopped).toContain(CUES.music);
  });

  it("plays the eat cue once on the tick a pellet is eaten", () => {
    game.startRound();
    game.sim.setSnake(chain(10, 8, 3));
    game.sim.dir = "right";
    game.sim.setPellet(11, 8);
    game.sim.pelletRespawn = false;
    game.update(TICK_SECONDS);
    expect(audio.played).toEqual([CUES.eat]);
  });

  it("plays eat and combo-up once each on a tick that does both", () => {
    game.startRound();
    game.sim.setSnake(chain(10, 8, 3));
    game.sim.dir = "right";
    game.sim.setPellet(11, 8);
    game.sim.pelletRespawn = false;
    game.sim.combo = 2;
    game.sim.comboWindow = COMBO_WINDOW;
    game.update(TICK_SECONDS);
    expect(audio.played).toEqual([CUES.eat, CUES.comboUp]);
  });

  it("plays the death cue once on the fatal tick", () => {
    game.startRound();
    game.sim.clearPellet();
    game.sim.setSnake(chain(28, 8, 3));
    game.sim.dir = "right";
    game.update(TICK_SECONDS);
    expect(audio.played).toEqual([CUES.death]);
  });

  it("mirrors the runtime's mute bit, and toggles it from any screen", () => {
    game.handleAction("mute");
    expect(game.muted).toBe(true);
    expect(audio.muted).toBe(true);
    game.startRound();
    game.handleAction("mute");
    expect(game.muted).toBe(false);
  });
});

describe("the bite", () => {
  it("leaves the head at rest until a pellet is eaten", () => {
    game.startRound();
    game.sim.clearPellet();
    game.update(0.5);
    expect(game.biteFrame()).toBe(0);
  });

  it("plays the three bite frames and returns to rest", () => {
    game.startRound();
    game.sim.setSnake(chain(10, 8, 3));
    game.sim.dir = "right";
    game.sim.setPellet(11, 8);
    game.sim.pelletRespawn = false;
    game.update(TICK_SECONDS);
    expect(game.biteFrame()).toBeGreaterThan(0);
    game.update(BITE_SECONDS - TICK_SECONDS);
    expect(game.biteFrame()).toBe(0);
  });

  it("returns to rest after BITE_SECONDS however it was divided", () => {
    game.startRound();
    game.sim.setSnake(chain(10, 8, 3));
    game.sim.dir = "right";
    game.sim.setPellet(11, 8);
    game.sim.pelletRespawn = false;
    game.update(TICK_SECONDS);
    for (let i = 0; i < 60; i++)
      game.update((BITE_SECONDS - TICK_SECONDS) / 60);
    expect(game.biteFrame()).toBe(0);
  });
});

describe("reset", () => {
  it("returns the whole session to its opening values", () => {
    game.startRound();
    game.sim.score = 300;
    game.update(0.5);
    game.goTo("paused");
    game.reset(1);
    expect(game.screen).toBe("title");
    expect(game.menuIndex).toBe(0);
    expect(game.best).toBe(0);
    expect(game.ticks).toBe(0);
    expect(game.simTime).toBe(0);
    expect(game.sim.pellet).toBeNull();
  });

  it("leaves the mute bit as it stands", () => {
    game.handleAction("mute");
    game.reset(1);
    expect(game.muted).toBe(true);
  });
});
