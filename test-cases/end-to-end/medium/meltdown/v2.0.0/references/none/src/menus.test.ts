// The menus, and where confirming a row leads (specs/screens.md).

import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_ITEMS,
  ENDING_ITEMS,
  MODE_ITEMS,
  PAUSE_ITEMS,
  REACTOR_W,
  TITLE_ITEMS,
} from "./constants";
import { NO_CUES } from "./build";
import {
  HOWTO_ITEMS,
  backFromScreen,
  confirmMenu,
  highlighted,
  menuItems,
  menuRects,
  moveMenu,
} from "./menus";
import { createState, type MeltdownState } from "./state";
import type { Screen } from "./types";

/** Every screen that shows a menu, with the rows it shows. */
const MENUS: Array<[Screen, readonly string[]]> = [
  ["title", TITLE_ITEMS],
  ["modeselect", MODE_ITEMS],
  ["difficultyselect", DIFFICULTY_ITEMS],
  ["howto", HOWTO_ITEMS],
  ["paused", PAUSE_ITEMS],
  ["victory", ENDING_ITEMS],
  ["gameover", ENDING_ITEMS],
];

function on(screen: Screen): MeltdownState {
  const state = createState();
  state.screen = screen;
  state.menuIndex = 0;
  return state;
}

describe("the rows", () => {
  it("are the ones the spec names, on every screen that shows a menu", () => {
    for (const [screen, items] of MENUS) {
      expect(menuItems(screen)).toEqual(items);
    }
  });

  it("are none at all on the playing screen", () => {
    expect(menuItems("playing")).toEqual([]);
    expect(menuRects("playing")).toEqual([]);
  });

  it("give every row a rectangle, so each is a pointer target", () => {
    for (const [screen, items] of MENUS) {
      const rects = menuRects(screen);
      expect(rects).toHaveLength(items.length);
      for (const rect of rects) {
        expect(rect.w).toBeGreaterThanOrEqual(32);
        expect(rect.h).toBeGreaterThanOrEqual(32);
        // Inside the reactor region, never over the build panel's strip.
        expect(rect.x + rect.w).toBeLessThanOrEqual(REACTOR_W);
      }
    }
  });

  it("stacks the rows in order, none overlapping the next", () => {
    for (const [screen] of MENUS) {
      const rects = menuRects(screen);
      for (let i = 1; i < rects.length; i += 1) {
        expect(rects[i].y).toBeGreaterThanOrEqual(
          rects[i - 1].y + rects[i - 1].h,
        );
      }
    }
  });
});

describe("the highlight", () => {
  it("wraps at both ends, on every menu in the game", () => {
    for (const [screen, items] of MENUS) {
      const state = on(screen);
      moveMenu(state, -1, NO_CUES);
      expect(state.menuIndex).toBe(items.length - 1);
      moveMenu(state, 1, NO_CUES);
      expect(state.menuIndex).toBe(0);
    }
  });

  it("plays the menu cue on every move", () => {
    const played: string[] = [];
    const state = on("title");
    moveMenu(state, 1, (cue) => played.push(cue));
    expect(played).toEqual(["menu"]);
  });

  it("changes nothing where the screen shows no menu", () => {
    const state = on("playing");
    state.menuIndex = 3;
    moveMenu(state, 1, NO_CUES);
    expect(state.menuIndex).toBe(3);
  });

  it("folds an out-of-range index into the menu for reading", () => {
    const state = on("title");
    state.menuIndex = 7;
    expect(highlighted(state)).toBe(7 % TITLE_ITEMS.length);
    state.screen = "playing";
    expect(highlighted(state)).toBe(0);
  });
});

describe("confirming a row", () => {
  it("takes PLAY to the mode select and starts no game of its own", () => {
    const state = on("title");
    confirmMenu(state);
    expect(state.screen).toBe("modeselect");
    expect(state.menuIndex).toBe(0);
    expect(state.towers).toEqual([]);
  });

  it("takes HOW TO PLAY to the how-to screen, and back again", () => {
    const state = on("title");
    state.menuIndex = 1;
    confirmMenu(state);
    expect(state.screen).toBe("howto");
    confirmMenu(state);
    expect(state.screen).toBe("title");
  });

  it("sends Containment to the difficulty select", () => {
    const state = on("modeselect");
    confirmMenu(state);
    expect(state.screen).toBe("difficultyselect");
    expect(state.mode).toBe("containment");
  });

  it("opens every other mode straight into its opening phase", () => {
    for (const [index, mode] of [
      [1, "hundred"],
      [2, "deeppockets"],
      [3, "bottleneck"],
      [4, "suddendeath"],
    ] as const) {
      const state = on("modeselect");
      state.menuIndex = index;
      confirmMenu(state);
      expect(state.mode).toBe(mode);
      expect(state.screen).toBe("playing");
      expect(state.phase).toBe("opening");
      expect(state.wave).toBe(1);
    }
  });

  it("opens Containment at the difficulty chosen, with its own money", () => {
    const state = on("difficultyselect");
    state.menuIndex = 0;
    confirmMenu(state);
    expect(state.difficulty).toBe("easy");
    expect(state.money).toBe(350);
    expect(state.lives).toBe(20);
  });

  it("resumes, restarts, and quits from the pause menu", () => {
    const resume = on("paused");
    confirmMenu(resume);
    expect(resume.screen).toBe("playing");

    const restart = on("paused");
    restart.money = 9;
    restart.wave = 6;
    restart.menuIndex = 1;
    confirmMenu(restart);
    expect(restart.screen).toBe("playing");
    expect(restart.phase).toBe("opening");
    expect(restart.wave).toBe(1);
    expect(restart.money).toBe(250);

    const quit = on("paused");
    quit.menuIndex = 2;
    confirmMenu(quit);
    expect(quit.screen).toBe("title");
  });

  it("plays again on the same pair, or returns to the title", () => {
    for (const screen of ["victory", "gameover"] as const) {
      const again = on(screen);
      again.mode = "bottleneck";
      confirmMenu(again);
      expect(again.screen).toBe("playing");
      expect(again.mode).toBe("bottleneck");
      expect(again.money).toBe(300);

      const menu = on(screen);
      menu.menuIndex = 1;
      confirmMenu(menu);
      expect(menu.screen).toBe("title");
    }
  });

  it("takes no row on the playing screen, which shows none", () => {
    const state = on("playing");
    confirmMenu(state);
    expect(state.screen).toBe("playing");
  });
});

describe("leaving a screen", () => {
  it("walks back the way the spec fixes", () => {
    for (const [from, to] of [
      ["modeselect", "title"],
      ["difficultyselect", "modeselect"],
      ["howto", "title"],
      ["paused", "playing"],
      ["victory", "title"],
      ["gameover", "title"],
    ] as const) {
      const state = on(from);
      backFromScreen(state);
      expect(state.screen).toBe(to);
    }
  });

  it("does nothing at the title, where the game starts", () => {
    const state = on("title");
    backFromScreen(state);
    expect(state.screen).toBe("title");
  });

  it("leaves the floor exactly as it was when it resumes", () => {
    const state = on("paused");
    state.money = 77;
    state.wave = 4;
    backFromScreen(state);
    expect(state.screen).toBe("playing");
    expect(state.money).toBe(77);
    expect(state.wave).toBe(4);
  });
});
