// The screens over the bare state: the menus, the transitions, the tick
// accumulator, and the cues each answers with, with no engine behind them.

import { describe, expect, it } from "vitest";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  BASE_WEAPON_IDS,
  EVOLUTION_IDS,
  TICK_DT,
  TITLE_ITEMS,
  type ActionName,
  type CueName,
} from "./constants";
import {
  choose,
  endRun,
  handleAction,
  openLevelUpNow,
  pause,
  runFrame,
  scrollAlmanac,
  startRun,
  toAlmanac,
  wantedLoops,
} from "./flow";
import { idleRun, initialState, resetState, type WickState } from "./state";

/** The tools tab's entries: the ten base weapons, then the six evolutions. */
const WEAPON_COUNT = BASE_WEAPON_IDS.length + EVOLUTION_IDS.length;

interface Bench {
  state: WickState;
  cues: CueName[];
  act(action: ActionName): void;
}

function bench(seed = 1): Bench {
  const state = initialState(seed);
  const cues: CueName[] = [];
  return {
    state,
    cues,
    act: (action) =>
      handleAction(state, action, state.screen, (cue) => cues.push(cue)),
  };
}

function drain(b: Bench): CueName[] {
  return b.cues.splice(0, b.cues.length);
}

describe("the title screen", () => {
  it("opens on title with the idle run", () => {
    const { state } = bench();
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
    expect(state.run).toEqual(idleRun());
  });

  it("wraps the highlight both ways and sounds menu-move", () => {
    const b = bench();
    b.act("up");
    expect(b.state.menuIndex).toBe(2);
    b.act("down");
    expect(b.state.menuIndex).toBe(0);
    b.act("down");
    expect(b.state.menuIndex).toBe(1);
    expect(drain(b)).toEqual(["menu-move", "menu-move", "menu-move"]);
  });

  it("starts a fresh run on LIGHT THE LAMP", () => {
    const b = bench();
    b.act("confirm");
    expect(b.state.screen).toBe("playing");
    expect(b.state.run.weapons).toEqual([
      { id: "taper", level: 1, cooldown: 0, cooldownSet: 0 },
    ]);
    expect(b.state.run.player).toEqual({
      x: 0,
      y: 0,
      facing: "right",
      hp: 100,
    });
    expect(drain(b)).toEqual(["menu-confirm"]);
    expect(wantedLoops(b.state)).toEqual(["music"]);
  });

  it("opens the almanac on THE ALMANAC and back returns", () => {
    const b = bench();
    b.act("down");
    b.act("confirm");
    expect(b.state.screen).toBe("almanac");
    expect(b.state.menuIndex).toBe(0);
    expect(b.state.almanacTab).toBe(0);
    expect(b.state.almanacScroll).toBe(0);
    expect(b.state.run).toEqual(idleRun());
    expect(wantedLoops(b.state)).toEqual([]);
    b.act("back");
    expect(b.state.screen).toBe("title");
    // Returning selects the entry that led away (specs/ui.md, `almanac`).
    expect(b.state.menuIndex).toBe(TITLE_ITEMS.indexOf("THE ALMANAC"));
  });

  it("opens howto on HOW TO PLAY and back returns", () => {
    const b = bench();
    b.act("down");
    b.act("down");
    b.act("confirm");
    expect(b.state.screen).toBe("howto");
    expect(b.state.menuIndex).toBe(0);
    b.act("back");
    expect(b.state.screen).toBe("title");
    // Returning selects the entry that led away (specs/ui.md, `howto`).
    expect(b.state.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
    expect(wantedLoops(b.state)).toEqual([]);
  });

  it("ignores back and pause on title", () => {
    const b = bench();
    b.act("back");
    b.act("pause");
    expect(b.state.screen).toBe("title");
  });
});

describe("the almanac", () => {
  function almanac(): Bench {
    const b = bench();
    toAlmanac(b.state);
    return b;
  }

  it("wraps the entry highlight over the shown tab", () => {
    const b = almanac();
    b.act("up");
    expect(b.state.menuIndex).toBe(WEAPON_COUNT - 1);
    b.act("down");
    expect(b.state.menuIndex).toBe(0);
    expect(drain(b)).toEqual(["menu-move", "menu-move"]);
  });

  it("wraps the tab both ways, resetting the entry and the scroll", () => {
    const b = almanac();
    b.act("down");
    b.act("down");
    expect(b.state.menuIndex).toBe(2);
    b.act("right");
    expect(b.state.almanacTab).toBe(1);
    expect(b.state.menuIndex).toBe(0);
    expect(b.state.almanacScroll).toBe(0);
    b.act("left");
    expect(b.state.almanacTab).toBe(0);
    b.act("left");
    expect(b.state.almanacTab).toBe(ALMANAC_TABS.length - 1);
    b.act("right");
    expect(b.state.almanacTab).toBe(0);
    expect(drain(b)).toEqual(Array(6).fill("menu-move"));
  });

  it("follows the highlight with the scroll and clamps it at both ends", () => {
    const b = almanac();
    for (let i = 0; i < ALMANAC_ROWS; i += 1) b.act("down");
    expect(b.state.menuIndex).toBe(ALMANAC_ROWS);
    expect(b.state.almanacScroll).toBe(1);
    b.act("up");
    expect(b.state.almanacScroll).toBe(1);
    for (let i = 0; i < ALMANAC_ROWS - 1; i += 1) b.act("up");
    expect(b.state.menuIndex).toBe(0);
    expect(b.state.almanacScroll).toBe(0);
    b.act("up");
    expect(b.state.menuIndex).toBe(WEAPON_COUNT - 1);
    expect(b.state.almanacScroll).toBe(WEAPON_COUNT - ALMANAC_ROWS);
  });

  it("holds the scroll at zero on a tab that fits", () => {
    const b = almanac();
    b.act("right");
    b.act("right");
    b.act("right");
    expect(ALMANAC_TABS[b.state.almanacTab]).toBe("PICKUPS");
    b.act("up");
    expect(b.state.menuIndex).toBe(5);
    expect(b.state.almanacScroll).toBe(0);
  });

  it("takes nothing on confirm and ticks nothing", () => {
    const b = almanac();
    b.act("confirm");
    b.act("pause");
    expect(b.state.screen).toBe("almanac");
    runFrame(b.state, 1, () => undefined);
    expect(b.state.run.tick).toBe(0);
    expect(b.state.accumulator).toBe(0);
  });

  it("scrolls by whole rows of wheel travel, holding the list", () => {
    const b = almanac();
    scrollAlmanac(b.state, 1);
    expect(b.state.almanacScroll).toBe(1);
    expect(b.state.menuIndex).toBe(0);
    scrollAlmanac(b.state, 99);
    expect(b.state.almanacScroll).toBe(WEAPON_COUNT - ALMANAC_ROWS);
    scrollAlmanac(b.state, -99);
    expect(b.state.almanacScroll).toBe(0);
  });
});

describe("pause", () => {
  it("holds the run under paused and resumes it untouched", () => {
    const b = bench();
    startRun(b.state);
    runFrame(b.state, 0.5, () => undefined);
    b.state.accumulator = 0.01;
    b.act("pause");
    expect(b.state.screen).toBe("paused");
    expect(b.state.accumulator).toBe(0);
    const tick = b.state.run.tick;
    runFrame(b.state, 1, () => undefined);
    expect(b.state.run.tick).toBe(tick);
    expect(wantedLoops(b.state)).toEqual(["music"]);
    b.act("pause");
    expect(b.state.screen).toBe("playing");
    expect(b.state.run.tick).toBe(tick);
  });

  it("resumes on back as on pause, the run untouched", () => {
    const b = bench();
    startRun(b.state);
    runFrame(b.state, 0.5, () => undefined);
    const tick = b.state.run.tick;
    pause(b.state);
    b.act("back");
    expect(b.state.screen).toBe("playing");
    expect(b.state.run.tick).toBe(tick);
    expect(drain(b)).toEqual([]);
  });

  it("opens paused on back from playing, as pause does", () => {
    const b = bench();
    startRun(b.state);
    b.act("back");
    expect(b.state.screen).toBe("paused");
    expect(b.state.menuIndex).toBe(0);
  });

  it("wraps the two-item menu and takes each item", () => {
    const b = bench();
    startRun(b.state);
    pause(b.state);
    b.act("up");
    expect(b.state.menuIndex).toBe(1);
    b.act("down");
    expect(b.state.menuIndex).toBe(0);
    b.act("confirm");
    expect(b.state.screen).toBe("playing");
    expect(drain(b)).toEqual(["menu-move", "menu-move", "menu-confirm"]);
    pause(b.state);
    b.act("down");
    b.act("confirm");
    expect(b.state.screen).toBe("title");
    expect(b.state.run).toEqual(idleRun());
    expect(drain(b).slice(-1)).toEqual(["menu-confirm"]);
  });
});

describe("the end screens", () => {
  it("keeps the run, and TRY AGAIN or TITLE leave it", () => {
    const b = bench();
    startRun(b.state);
    runFrame(b.state, 1, () => undefined);
    b.state.run.kills = 4;
    endRun(b.state, "fallen", (cue) => b.cues.push(cue));
    expect(b.state.screen).toBe("fallen");
    expect(b.state.run.kills).toBe(4);
    expect(drain(b)).toEqual(["fallen"]);
    expect(wantedLoops(b.state)).toEqual([]);
    b.act("confirm");
    expect(b.state.screen).toBe("playing");
    expect(b.state.run.kills).toBe(0);
    endRun(b.state, "dawn", () => undefined);
    b.act("down");
    b.act("confirm");
    expect(b.state.screen).toBe("title");
    startRun(b.state);
    endRun(b.state, "dawn", () => undefined);
    b.act("back");
    expect(b.state.screen).toBe("title");
  });

  it("ends nothing off a run screen", () => {
    const b = bench();
    endRun(b.state, "fallen", (cue) => b.cues.push(cue));
    expect(b.state.screen).toBe("title");
    expect(drain(b)).toEqual([]);
  });
});

describe("the overlays", () => {
  it("opens the level-up overlay and chooses through the menu", () => {
    const b = bench();
    startRun(b.state);
    b.state.run.pendingLevelUps = 1;
    expect(openLevelUpNow(b.state, (cue) => b.cues.push(cue))).toBe(true);
    expect(b.state.screen).toBe("levelup");
    expect(drain(b)).toEqual(["level-up"]);
    b.act("down");
    expect(b.state.menuIndex).toBe(1);
    b.act("up");
    b.act("up");
    expect(b.state.menuIndex).toBe(2);
    b.act("back");
    b.act("pause");
    expect(b.state.screen).toBe("levelup");
    const chosen = b.state.run.offers[2];
    b.act("confirm");
    expect(b.state.screen).toBe("playing");
    expect(drain(b).slice(-1)).toEqual(["choose"]);
    expect(
      [...b.state.run.weapons, ...b.state.run.passives].some(
        (held) => held.id === chosen,
      ),
    ).toBe(true);
  });

  it("refuses to open with nothing pending or off playing", () => {
    const b = bench();
    startRun(b.state);
    expect(openLevelUpNow(b.state, () => undefined)).toBe(false);
    b.state.run.pendingLevelUps = 1;
    pause(b.state);
    expect(openLevelUpNow(b.state, () => undefined)).toBe(false);
    expect(choose(b.state, 0, () => undefined)).toBe(false);
  });

  it("closes the chest overlay on confirm alone", () => {
    const b = bench();
    startRun(b.state);
    b.state.screen = "chest";
    b.state.run.chestResult = { kind: "heal" };
    b.act("up");
    b.act("back");
    b.act("pause");
    expect(b.state.screen).toBe("chest");
    b.act("confirm");
    expect(b.state.screen).toBe("playing");
    expect(b.state.run.chestResult).toBeNull();
  });

  it("wants the hum while Halo or Corona is held on playing alone", () => {
    const b = bench();
    startRun(b.state);
    b.state.run.weapons.push({
      id: "corona",
      level: 1,
      cooldown: 0,
      cooldownSet: 0,
    });
    expect(wantedLoops(b.state)).toEqual(["music", "hum"]);
    pause(b.state);
    expect(wantedLoops(b.state)).toEqual(["music"]);
  });
});

describe("the accumulator", () => {
  it("consumes whole ticks and keeps the remainder on playing", () => {
    const { state } = bench();
    startRun(state);
    runFrame(state, 0.04, () => undefined);
    expect(state.run.tick).toBe(2);
    expect(state.accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 12);
    runFrame(state, 0.5, () => undefined);
    expect(state.run.tick).toBe(32);
    expect(state.simTime).toBeCloseTo(0.54, 12);
  });

  it("reaches the same tick however the time is divided", () => {
    const a = bench().state;
    const b = bench().state;
    startRun(a);
    startRun(b);
    runFrame(a, 0.5, () => undefined);
    for (let i = 0; i < 50; i += 1) runFrame(b, 0.01, () => undefined);
    expect(a.run.tick).toBe(30);
    expect(b.run.tick).toBe(30);
  });

  it("discards the remainder when a tick leaves playing", () => {
    const { state } = bench();
    startRun(state);
    state.run.pendingLevelUps = 1;
    runFrame(state, 0.025, () => undefined);
    expect(state.screen).toBe("levelup");
    expect(state.run.tick).toBe(1);
    expect(state.accumulator).toBe(0);
    runFrame(state, 1, () => undefined);
    expect(state.run.tick).toBe(1);
  });

  it("stays at zero off playing while simTime still rises", () => {
    const { state } = bench();
    runFrame(state, 0.3, () => undefined);
    expect(state.accumulator).toBe(0);
    expect(state.run.tick).toBe(0);
    expect(state.simTime).toBeCloseTo(0.3, 12);
  });
});

describe("reset", () => {
  it("returns to the title with a seeded generator, keeping muted", () => {
    const { state } = bench();
    startRun(state);
    runFrame(state, 1, () => undefined);
    state.spawning = false;
    state.muted = true;
    state.simTime = 5;
    resetState(state, 42);
    expect(state.screen).toBe("title");
    expect(state.run).toEqual(idleRun());
    expect(state.spawning).toBe(true);
    expect(state.simTime).toBe(0);
    expect(state.rngState).toBe(42);
    expect(state.muted).toBe(true);
  });

  it("replays the same run from the same seed", () => {
    const a = initialState(9);
    const b = initialState(9);
    for (const state of [a, b]) {
      startRun(state);
      state.run.pendingLevelUps = 3;
      runFrame(state, TICK_DT, () => undefined);
      choose(state, 1, () => undefined);
      choose(state, 0, () => undefined);
    }
    expect(a.run.offers).toEqual(b.run.offers);
    expect(a.rngState).toBe(b.rngState);
  });
});
