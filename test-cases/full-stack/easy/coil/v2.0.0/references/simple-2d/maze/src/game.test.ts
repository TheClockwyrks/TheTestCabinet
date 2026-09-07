// Coil's screens and its tick accumulator, driven through the game's own
// `update`.
//
// Nothing here reimplements the frame: `advance` calls the very function the
// engine calls, against a stand-in `UpdateApi` that reports no press and records
// the cues a frame played. What the engine adds around it — the clock, the real
// keyboard, and a canvas — is checked in `src/engine.test.ts`.

import { describe, expect, it } from "vitest";
import { NO_SPRITES } from "./assets";
import {
  BITE_SECONDS,
  CUES,
  OVER_ITEMS,
  PAUSE_ITEMS,
  TICK_SECONDS,
  TITLE_ITEMS,
  type ActionName,
  type Cell,
} from "./constants";
import {
  biteFrame,
  createInitialState,
  game,
  goTo,
  handleAction,
  startRound,
  type CoilState,
} from "./game";
import { HOWTO_ITEMS, menuItems } from "./menus";
import { menuItemRect } from "./menus";
import type { PointerSample, UpdateApi } from "@clockwyrks/simple-2d";

function opening(): CoilState {
  return createInitialState(NO_SPRITES, false);
}

/** What a frame did to the bus, for the cue checks to read. */
interface Bus {
  readonly played: string[];
  readonly looping: Set<string>;
  /** Every `loop` the frame asked for, so a restarted bed is told from a running one. */
  readonly looped: string[];
  muted: boolean;
}

/** A stand-in for the slice of `UpdateApi` Coil's `update` reaches. */
function stubApi(
  bus: Bus,
  pressed: readonly ActionName[] = [],
  samples: readonly PointerSample[] = [],
): UpdateApi {
  const armed = new Set<string>(pressed);
  return {
    input: {
      value: (name) => (armed.has(name) ? 1 : 0),
      // Consumed on read, exactly as the engine's edges are.
      pressed: (name) => armed.delete(name),
      pointer: () => ({
        x: 0,
        y: 0,
        down: false,
        device: "mouse",
        buttons: [],
      }),
      pointerPressed: () => false,
      pointerReleased: () => false,
      pointerSamples: () => [...samples],
      pointerContacts: () => [],
      wheel: () => ({ x: 0, y: 0 }),
    },
    audio: {
      play: (cue) => bus.played.push(cue),
      loop: (cue) => {
        bus.looped.push(cue);
        bus.looping.add(cue);
      },
      stop: (cue) => void bus.looping.delete(cue),
      looping: (cue) => bus.looping.has(cue),
      setMuted: (muted) => {
        bus.muted = muted;
      },
      muted: () => bus.muted,
    },
    frame: () => ({ count: 0, timeMs: 0, lastDeltaMs: 0 }),
    viewport: () => ({
      width: 1280,
      height: 720,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }),
  };
}

function newBus(): Bus {
  return { played: [], looping: new Set(), looped: [], muted: false };
}

/** `HOW TO PLAY` is the second item of the title menu (specs/ui.md). */
const HOWTO_INDEX = 1;

/** One pointer sample, as the engine delivers it in the game's own units. */
function sample(
  type: PointerSample["type"],
  x: number,
  y: number,
): PointerSample {
  return {
    type,
    x,
    y,
    id: 1,
    primary: true,
    device: "mouse",
    button: type === "move" ? null : "primary",
    buttons: type === "down" ? ["primary"] : [],
  };
}

/** Run one frame of no elapsed time carrying `samples`, through the game's own update. */
function drive(state: CoilState, ...samples: PointerSample[]): CoilState {
  return game.update(state, stubApi(newBus(), [], samples), 0);
}

/** Run `frames` frames covering `seconds`, through the game's own `update`. */
function advance(
  state: CoilState,
  seconds: number,
  frames = 1,
  bus: Bus = newBus(),
): CoilState {
  const dt = seconds / frames;
  let next = state;
  for (let frame = 0; frame < frames; frame++) {
    next = game.update(next, stubApi(bus), dt);
  }
  return next;
}

function press(state: CoilState, ...actions: ActionName[]): CoilState {
  let next = state;
  for (const action of actions) next = handleAction(next, action).state;
  return next;
}

/** One frame of no elapsed time in which `actions` were pressed. */
function tap(state: CoilState, bus: Bus, ...actions: ActionName[]): CoilState {
  return game.update(state, stubApi(bus, actions), 0);
}

/** A live round holding its chain still, so a scenario is about one thing. */
function held(chain: readonly Cell[] = [{ col: 14, row: 8 }]): CoilState {
  return {
    ...startRound(opening()),
    snake: [...chain],
    travel: false,
    pellet: null,
  };
}

describe("the opening state", () => {
  it("opens on the title with nothing advanced", () => {
    const state = opening();
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
    expect(state.score).toBe(0);
    expect(state.best).toBe(0);
    expect(state.combo).toBe(1);
    expect(state.comboWindow).toBe(0);
    expect(state.ticks).toBe(0);
    expect(state.simTime).toBe(0);
    expect(state.pellet).toBeNull();
    expect(state.steering && state.travel && state.pelletRespawn).toBe(true);
  });

  it("advances nothing on the title however much time passes", () => {
    const state = advance(opening(), 10, 600);
    expect(state.ticks).toBe(0);
    expect(state.simTime).toBe(0);
    expect(state.screen).toBe("title");
  });
});

describe("the tick", () => {
  it("resolves eight ticks in a second of game time", () => {
    expect(advance(held(), 1).ticks).toBe(8);
  });

  it("reaches the same state however the second was divided", () => {
    const one = advance(held(), 1, 1);
    const sixty = advance(held(), 1, 60);
    expect(sixty.ticks).toBe(one.ticks);
    expect(sixty.simTime).toBeCloseTo(one.simTime, 9);
  });

  it("resolves no tick for an update shorter than one, and carries it", () => {
    let state = advance(held(), TICK_SECONDS / 2);
    expect(state.ticks).toBe(0);
    state = advance(state, TICK_SECONDS / 2);
    expect(state.ticks).toBe(1);
  });

  it("advances at the same rate however long the snake is", () => {
    const short = advance(held([{ col: 14, row: 8 }]), 2);
    const long = advance(
      held(Array.from({ length: 20 }, (_, i) => ({ col: 20 - i, row: 8 }))),
      2,
    );
    expect(long.ticks).toBe(short.ticks);
  });

  it("accumulates simTime on the playing screen alone", () => {
    const playing = advance(held(), 1);
    expect(playing.simTime).toBeCloseTo(1, 9);
    const paused = advance(goTo(playing, "paused"), 1);
    expect(paused.simTime).toBeCloseTo(1, 9);
  });
});

describe("the screens", () => {
  it("starts a round from the title's mode entry", () => {
    const state = press(opening(), "confirm");
    expect(state.screen).toBe("playing");
    expect(state.snake.length).toBe(3);
    expect(state.pellet).not.toBeNull();
  });

  it("reaches how to play, and returns from it", () => {
    let state = press(opening(), "down", "confirm");
    expect(state.screen).toBe("howto");
    expect(state.menuIndex).toBe(0);
    state = press(state, "back");
    expect(state.screen).toBe("title");
  });

  it("pauses with either back or pause, and resumes with either", () => {
    for (const enter of ["back", "pause"] as const) {
      for (const leave of ["back", "pause"] as const) {
        const paused = press(startRound(opening()), enter);
        expect(paused.screen).toBe("paused");
        expect(press(paused, leave).screen).toBe("playing");
      }
    }
  });

  it("freezes the round behind the pause screen", () => {
    const playing = advance(held(), 1);
    const paused = advance(press(playing, "pause"), 5, 300);
    expect(paused.ticks).toBe(playing.ticks);
    expect(paused.snake).toEqual(playing.snake);
    expect(press(paused, "confirm").screen).toBe("playing");
  });

  it("restarts and quits from the pause menu", () => {
    const paused = press(advance(held(), 1), "pause");
    const restarted = press(paused, "down", "confirm");
    expect(restarted.screen).toBe("playing");
    expect(restarted.snake.length).toBe(3);
    const quit = press(paused, "down", "down", "confirm");
    expect(quit.screen).toBe("title");
  });

  it("ends on gameover when the head enters a fatal cell", () => {
    const state = advance(
      { ...startRound(opening()), snake: [{ col: 27, row: 8 }], dir: "right" },
      1,
    );
    expect(state.screen).toBe("gameover");
  });

  it("advances nothing once the round has ended", () => {
    const dead = advance(
      { ...startRound(opening()), snake: [{ col: 27, row: 8 }], dir: "right" },
      1,
    );
    const later = advance(dead, 5, 300);
    expect(later.ticks).toBe(dead.ticks);
    expect(later.snake).toEqual(dead.snake);
  });

  it("plays again and returns to the title from game over", () => {
    const over = goTo(opening(), "gameover");
    expect(press(over, "confirm").screen).toBe("playing");
    expect(press(over, "down", "confirm").screen).toBe("title");
    expect(press(over, "back").screen).toBe("title");
  });
});

describe("the menus", () => {
  it("highlights the first item of every screen it arrives at", () => {
    let state = press(opening(), "down");
    expect(state.menuIndex).toBe(1);
    state = press(state, "confirm");
    expect(state.menuIndex).toBe(0);
  });

  it("wraps the highlight at both ends", () => {
    expect(press(opening(), "up").menuIndex).toBe(TITLE_ITEMS.length - 1);
    let state = opening();
    for (let i = 0; i < TITLE_ITEMS.length; i++) state = press(state, "down");
    expect(state.menuIndex).toBe(0);
  });

  it("leaves the highlight where it is on left and right", () => {
    const state = press(opening(), "down", "left", "right");
    expect(state.menuIndex).toBe(1);
  });

  it("lists the items specs/ui.md fixes for each screen", () => {
    expect(menuItems("title")).toEqual(TITLE_ITEMS);
    expect(menuItems("howto")).toEqual(HOWTO_ITEMS);
    expect(menuItems("paused")).toEqual(PAUSE_ITEMS);
    expect(menuItems("gameover")).toEqual(OVER_ITEMS);
    expect(menuItems("cleared")).toEqual(OVER_ITEMS);
    expect(menuItems("playing")).toEqual([]);
  });
});

describe("steering from the keyboard", () => {
  it("buffers a request rather than turning at the press", () => {
    const state = press(held(), "up");
    expect(state.turns).toEqual(["up"]);
    expect(state.dir).toBe("right");
  });

  it("takes no steering request on a menu screen", () => {
    expect(press(opening(), "up").turns).toEqual([]);
  });
});

describe("the best score", () => {
  it("rises the instant the live score passes it", () => {
    const state = advance({ ...held(), score: 250 }, TICK_SECONDS);
    expect(state.best).toBe(250);
  });

  it("carries from one round into the next", () => {
    const state = startRound({ ...held(), best: 320 });
    expect(state.best).toBe(320);
    expect(state.score).toBe(0);
  });

  it("is raised back to the live score when it is posed below it", () => {
    const state = advance({ ...held(), score: 400, best: 10 }, TICK_SECONDS);
    expect(state.best).toBe(400);
  });
});

describe("the head's bite", () => {
  it("leaves the head at rest until a pellet is eaten", () => {
    expect(biteFrame(held())).toBe(0);
  });

  it("starts a bite on the tick a pellet is eaten", () => {
    const eating: CoilState = {
      ...startRound(opening()),
      snake: [{ col: 14, row: 8 }],
      dir: "right",
      pellet: { col: 15, row: 8 },
      pelletRespawn: false,
    };
    expect(biteFrame(advance(eating, TICK_SECONDS))).toBeGreaterThan(0);
  });

  it("plays the three bite frames in order and returns to rest", () => {
    // Sampled a third of the way into each frame's own slice of the bite, so
    // the reading never sits on a boundary a rounding could move.
    const third = BITE_SECONDS / 3;
    let state: CoilState = { ...held(), biteRemaining: BITE_SECONDS };
    const frames: number[] = [];
    for (const spent of [third / 2, third * 1.5, third * 2.5]) {
      const at = { ...state, biteRemaining: BITE_SECONDS - spent };
      frames.push(biteFrame(at));
    }
    expect(frames).toEqual([1, 2, 3]);
    state = advance(state, BITE_SECONDS);
    expect(biteFrame(state)).toBe(0);
  });

  it("returns to rest after BITE_SECONDS however it was divided", () => {
    const one = advance(
      { ...held(), biteRemaining: BITE_SECONDS },
      BITE_SECONDS,
    );
    const many = advance(
      { ...held(), biteRemaining: BITE_SECONDS },
      BITE_SECONDS,
      60,
    );
    expect(biteFrame(one)).toBe(0);
    expect(biteFrame(many)).toBe(0);
  });
});

describe("the cues one frame plays", () => {
  it("plays the eat cue once on the tick a pellet is eaten", () => {
    const bus = newBus();
    advance(
      {
        ...startRound(opening()),
        snake: [{ col: 14, row: 8 }],
        dir: "right",
        pellet: { col: 15, row: 8 },
        pelletRespawn: false,
      },
      TICK_SECONDS,
      1,
      bus,
    );
    expect(bus.played.filter((cue) => cue === CUES.eat).length).toBe(1);
  });

  it("plays eat and combo-up once each on a tick that does both", () => {
    const bus = newBus();
    advance(
      {
        ...startRound(opening()),
        snake: [{ col: 14, row: 8 }],
        dir: "right",
        pellet: { col: 15, row: 8 },
        pelletRespawn: false,
        combo: 1,
        comboWindow: 1,
      },
      TICK_SECONDS,
      1,
      bus,
    );
    expect(bus.played).toEqual([CUES.eat, CUES.comboUp]);
  });

  it("plays the death cue once on the fatal tick", () => {
    const bus = newBus();
    advance(
      { ...startRound(opening()), snake: [{ col: 28, row: 8 }], dir: "right" },
      TICK_SECONDS,
      1,
      bus,
    );
    expect(bus.played).toEqual([CUES.death]);
  });

  it("loops the music from the frame a round begins and stops it when it ends", () => {
    const bus = newBus();
    // A round begun the way a player begins one: `confirm` on the title's entry.
    let state = tap(opening(), bus, "confirm");
    expect(bus.looping.has(CUES.music)).toBe(true);
    state = advance(press(state, "pause"), TICK_SECONDS, 1, bus);
    expect(bus.looping.has(CUES.music)).toBe(true);
    advance(goTo(state, "gameover"), TICK_SECONDS, 1, bus);
    expect(bus.looping.has(CUES.music)).toBe(false);
  });

  it("starts the bed again on every menu item that lays a fresh round", () => {
    const bus = newBus();
    // Title -> RESTART from the pause menu -> PLAY AGAIN from the game over.
    let state = tap(opening(), bus, "confirm");
    state = tap(press(state, "pause"), bus, "down", "confirm");
    tap(goTo(state, "gameover"), bus, "confirm");
    expect(bus.looped.filter((cue) => cue === CUES.music)).toHaveLength(3);
  });

  it("sounds nothing for a screen posed onto playing", () => {
    const bus = newBus();
    advance(goTo(opening(), "playing"), TICK_SECONDS, 1, bus);
    expect(bus.looped).toEqual([]);
  });

  it("plays nothing on a frame that resolved no tick", () => {
    const bus = newBus();
    advance(held(), TICK_SECONDS / 4, 1, bus);
    expect(bus.played).toEqual([]);
  });
});

describe("mute", () => {
  it("toggles the engine's bit from any screen and mirrors it back", () => {
    const bus = newBus();
    for (const screen of ["title", "playing", "paused", "gameover"] as const) {
      const before = bus.muted;
      const state = tap(goTo(opening(), screen), bus, "mute");
      expect(bus.muted).toBe(!before);
      expect(state.muted).toBe(bus.muted);
    }
  });

  it("changes nothing else about the game", () => {
    const bus = newBus();
    const before = held();
    const after = tap(before, bus, "mute");
    expect({ ...after, muted: before.muted }).toEqual(before);
  });
});

describe("the pointer and the touch contact over the menus", () => {
  /** The middle of item `index`'s region on the screen `state` is on. */
  function middleOf(state: CoilState, index: number): { x: number; y: number } {
    const rect = menuItemRect(state.screen, index);
    if (rect === null) throw new Error(`no item ${index} on ${state.screen}`);
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  it("selects the item a move arrives over, confirming nothing", () => {
    const state = opening();
    const at = middleOf(state, HOWTO_INDEX);
    const moved = drive(state, sample("move", at.x, at.y));
    expect(moved.menuIndex).toBe(HOWTO_INDEX);
    expect(moved.screen).toBe("title");
  });

  it("confirms the item a press and its release both fall inside", () => {
    const state = opening();
    const at = middleOf(state, HOWTO_INDEX);
    const clicked = drive(
      state,
      sample("down", at.x, at.y),
      sample("up", at.x, at.y),
    );
    expect(clicked.screen).toBe("howto");
  });

  it("confirms nothing when the two edges fall in different items", () => {
    const state = opening();
    const from = middleOf(state, HOWTO_INDEX);
    const to = middleOf(state, 0);
    const slid = drive(
      state,
      sample("down", from.x, from.y),
      sample("move", to.x, to.y),
      sample("up", to.x, to.y),
    );
    expect(slid.screen).toBe("title");
    expect(slid.menuIndex).toBe(0);
  });

  it("confirms nothing when an edge falls outside every region", () => {
    const state = opening();
    const at = middleOf(state, HOWTO_INDEX);
    const missed = drive(state, sample("down", at.x, at.y), sample("up", 0, 0));
    expect(missed.screen).toBe("title");
  });

  it("is not read on the playing screen, which shows no menu", () => {
    const state = opening();
    const at = middleOf(state, HOWTO_INDEX);
    const playing = startRound(state);
    const after = drive(
      playing,
      sample("down", at.x, at.y),
      sample("up", at.x, at.y),
    );
    expect(after.screen).toBe("playing");
    expect(after.menuIndex).toBe(0);
  });
});

describe("the remembered title selection", () => {
  it("opens at zero", () => {
    expect(opening().titleIndex).toBe(0);
  });

  it("follows the item the title confirmed, whichever input confirmed it", () => {
    const state = press(opening(), "down", "confirm");
    expect(state.screen).toBe("howto");
    expect(state.titleIndex).toBe(HOWTO_INDEX);
  });

  it("is where the title opens on the way back", () => {
    const state = press(opening(), "down", "confirm", "back");
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(HOWTO_INDEX);
  });

  it("leaves every other screen opening on its first item", () => {
    const state = press(opening(), "down", "confirm");
    expect(goTo(state, "paused").menuIndex).toBe(0);
  });
});
