// Coil's screens, and what one press edge does on each of them.
//
// Every check here routes an already-resolved action onto a live state, which is
// exactly what the player controller does with each edge it reads. What the
// engine adds around it — the clock, the real keyboard, the cue bus and a canvas
// — is checked in `src/engine.test.ts`.

import { describe, expect, it } from "vitest";
import {
  OVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
  type ActionName,
  type Cell,
} from "./constants";
import { goTo, handleAction, resetSession, startRound } from "./flow";
import { CoilState } from "./game";
import { HOWTO_ITEMS, menuItems } from "./menus";

function opening(seed = 1): CoilState {
  const state = new CoilState();
  resetSession(state, seed);
  return state;
}

function press(state: CoilState, ...actions: ActionName[]): CoilState {
  for (const action of actions) handleAction(state, action);
  return state;
}

/** A live round holding its chain still, so a scenario is about one thing. */
function held(chain: readonly Cell[] = [{ col: 14, row: 8 }]): CoilState {
  const state = opening();
  startRound(state);
  state.snake = chain.map((cell) => ({ col: cell.col, row: cell.row }));
  state.travel = false;
  state.pellet = null;
  return state;
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

  it("is what a freshly built state already holds", () => {
    // The state's field initializers and `resetSession` are the same opening
    // board, so a reset and a fresh session leave the game in the same place.
    const fresh = new CoilState();
    const reset = opening();
    expect(JSON.stringify(reset)).toBe(JSON.stringify(fresh));
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
    const state = press(opening(), "down", "confirm");
    expect(state.screen).toBe("howto");
    expect(state.menuIndex).toBe(0);
    expect(press(state, "back").screen).toBe("title");
  });

  it("pauses with either back or pause, and resumes with either", () => {
    for (const enter of ["back", "pause"] as const) {
      for (const leave of ["back", "pause"] as const) {
        const state = opening();
        startRound(state);
        expect(press(state, enter).screen).toBe("paused");
        expect(press(state, leave).screen).toBe("playing");
      }
    }
  });

  it("restarts and quits from the pause menu", () => {
    const restarted = press(held(), "pause", "down", "confirm");
    expect(restarted.screen).toBe("playing");
    expect(restarted.snake.length).toBe(3);
    const quit = press(held(), "pause", "down", "down", "confirm");
    expect(quit.screen).toBe("title");
  });

  it("plays again and returns to the title from game over", () => {
    const over = (): CoilState => {
      const state = opening();
      goTo(state, "gameover");
      return state;
    };
    expect(press(over(), "confirm").screen).toBe("playing");
    expect(press(over(), "down", "confirm").screen).toBe("title");
    expect(press(over(), "back").screen).toBe("title");
  });
});

describe("the menus", () => {
  it("highlights the first item of every screen it arrives at", () => {
    const state = press(opening(), "down");
    expect(state.menuIndex).toBe(1);
    expect(press(state, "confirm").menuIndex).toBe(0);
  });

  it("wraps the highlight at both ends", () => {
    expect(press(opening(), "up").menuIndex).toBe(TITLE_ITEMS.length - 1);
    const state = opening();
    for (let i = 0; i < TITLE_ITEMS.length; i++) press(state, "down");
    expect(state.menuIndex).toBe(0);
  });

  it("leaves the highlight where it is on left and right", () => {
    expect(press(opening(), "down", "left", "right").menuIndex).toBe(1);
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

describe("steering", () => {
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
  it("carries from one round into the next", () => {
    const state = held();
    state.best = 320;
    startRound(state);
    expect(state.best).toBe(320);
    expect(state.score).toBe(0);
  });
});
