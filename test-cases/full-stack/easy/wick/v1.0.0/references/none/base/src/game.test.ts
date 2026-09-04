import { describe, expect, it } from "vitest";
import { ALMANAC_ROWS, TICK_DT, TITLE_ITEMS, WHEEL_ROW } from "./constants";
import { almanacEntries } from "./almanac";
import { Game } from "./game";
import {
  almanacRowRects,
  almanacTabRects,
  chestRects,
  endRects,
  howtoRects,
  levelUpLayout,
  menuRects,
  pauseRects,
  titleRects,
  type Rect,
} from "./layout";
import { idleRun } from "./state";
import type { StagePoint } from "./viewport";

/** The middle of a rectangle, which is where a pointer test aims. */
function middle(rect: Rect): StagePoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function hover(g: Game, at: StagePoint): void {
  g.handlePointer({ at, presses: [], releases: [], wheel: 0 });
}

/** A whole click on one frame: the press arms the item and the lift takes it. */
function click(g: Game, at: StagePoint): void {
  g.handlePointer({ at: null, presses: [at], releases: [at], wheel: 0 });
}

/** A press held across the frame, with no lift. */
function press(g: Game, at: StagePoint): void {
  g.handlePointer({ at: null, presses: [at], releases: [], wheel: 0 });
}

/** A lift at a point, with no press before it on this frame. */
function lift(g: Game, at: StagePoint): void {
  g.handlePointer({ at: null, presses: [], releases: [at], wheel: 0 });
}

function wheel(g: Game, travel: number): void {
  g.handlePointer({ at: null, presses: [], releases: [], wheel: travel });
}

function game(): { game: Game; mute: { on: boolean } } {
  const mute = { on: false };
  const built = new Game({
    toggleMute: () => {
      mute.on = !mute.on;
    },
    isMuted: () => mute.on,
  });
  return { game: built, mute };
}

describe("the title screen", () => {
  it("opens on title with the idle run", () => {
    const { game: g } = game();
    expect(g.state.screen).toBe("title");
    expect(g.state.menuIndex).toBe(0);
    expect(g.state.run).toEqual(idleRun());
  });

  it("wraps the highlight both ways over three items and sounds menu-move", () => {
    const { game: g } = game();
    g.handleAction("up");
    expect(g.state.menuIndex).toBe(2);
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(0);
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(1);
    expect(g.drainCues()).toEqual(["menu-move"]);
  });

  it("starts a fresh run on LIGHT THE LAMP", () => {
    const { game: g } = game();
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.weapons).toEqual([
      { id: "taper", level: 1, cooldown: 0, cooldownSet: 0 },
    ]);
    expect(g.state.run.player).toEqual({
      x: 0,
      y: 0,
      facing: "right",
      hp: 100,
    });
    expect(g.drainCues()).toEqual(["menu-confirm"]);
    expect(g.wantedLoops().has("music")).toBe(true);
  });

  it("opens the almanac on THE ALMANAC with every index at zero", () => {
    const { game: g } = game();
    g.handleAction("down");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("almanac");
    expect(g.state.menuIndex).toBe(0);
    expect(g.state.almanacTab).toBe(0);
    expect(g.state.almanacScroll).toBe(0);
    expect(g.state.run).toEqual(idleRun());
  });

  it("opens howto on HOW TO PLAY and back returns", () => {
    const { game: g } = game();
    g.handleAction("down");
    g.handleAction("down");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("howto");
    expect(g.state.menuIndex).toBe(0);
    g.handleAction("back");
    expect(g.state.screen).toBe("title");
    expect(g.state.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
    expect(g.wantedLoops().size).toBe(0);
  });

  it("ignores back and pause on title", () => {
    const { game: g } = game();
    g.handleAction("back");
    g.handleAction("pause");
    expect(g.state.screen).toBe("title");
  });
});

describe("pause", () => {
  it("holds the run under paused and resumes it untouched", () => {
    const { game: g } = game();
    g.startRun();
    g.update(0.5);
    g.state.accumulator = 0.01;
    g.handleAction("pause");
    expect(g.state.screen).toBe("paused");
    expect(g.state.accumulator).toBe(0);
    const tick = g.state.run.tick;
    g.update(1);
    expect(g.state.run.tick).toBe(tick);
    expect(g.wantedLoops().has("music")).toBe(true);
    g.handleAction("pause");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.tick).toBe(tick);
  });

  it("opens on back as it does on pause, and both resume", () => {
    const { game: g } = game();
    g.startRun();
    g.update(0.5);
    const tick = g.state.run.tick;
    g.handleAction("back");
    expect(g.state.screen).toBe("paused");
    expect(g.state.menuIndex).toBe(0);
    g.handleAction("back");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.tick).toBe(tick);
    expect(g.drainCues()).toEqual([]);
  });

  it("carries a two-item menu that wraps, resumes, and abandons", () => {
    const { game: g } = game();
    g.startRun();
    g.update(0.5);
    const tick = g.state.run.tick;
    g.pause();
    g.handleAction("up");
    expect(g.state.menuIndex).toBe(1);
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(0);
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.tick).toBe(tick);
    expect(g.drainCues()).toEqual(["menu-move", "menu-confirm"]);
    g.pause();
    g.handleAction("down");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("title");
    expect(g.state.run).toEqual(idleRun());
  });
});

describe("the almanac", () => {
  function almanac(): Game {
    const { game: g } = game();
    g.toAlmanac();
    return g;
  }

  it("advances nothing and carries no music", () => {
    const g = almanac();
    g.update(1);
    expect(g.state.run.tick).toBe(0);
    expect(g.state.accumulator).toBe(0);
    expect(g.wantedLoops().size).toBe(0);
  });

  it("moves the entry highlight over the tab and wraps at both ends", () => {
    const g = almanac();
    const tools = almanacEntries(0).length;
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(1);
    g.handleAction("up");
    g.handleAction("up");
    expect(g.state.menuIndex).toBe(tools - 1);
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(0);
  });

  it("moves the tab, wraps it, and returns to the first entry", () => {
    const g = almanac();
    g.handleAction("down");
    g.handleAction("down");
    g.handleAction("right");
    expect(g.state.almanacTab).toBe(1);
    expect(g.state.menuIndex).toBe(0);
    expect(g.state.almanacScroll).toBe(0);
    g.handleAction("left");
    expect(g.state.almanacTab).toBe(0);
    g.handleAction("left");
    expect(g.state.almanacTab).toBe(3);
    g.handleAction("right");
    expect(g.state.almanacTab).toBe(0);
  });

  it("follows the highlight with the list's window", () => {
    const g = almanac();
    for (let i = 0; i < ALMANAC_ROWS - 1; i += 1) g.handleAction("down");
    expect(g.state.menuIndex).toBe(ALMANAC_ROWS - 1);
    expect(g.state.almanacScroll).toBe(0);
    g.handleAction("down");
    expect(g.state.almanacScroll).toBe(1);
    g.handleAction("up");
    expect(g.state.almanacScroll).toBe(1);
    for (let i = 0; i < ALMANAC_ROWS - 1; i += 1) g.handleAction("up");
    expect(g.state.menuIndex).toBe(0);
    expect(g.state.almanacScroll).toBe(0);
  });

  it("holds the window at the end when the highlight wraps to the last entry", () => {
    const g = almanac();
    const tools = almanacEntries(0).length;
    g.handleAction("up");
    expect(g.state.menuIndex).toBe(tools - 1);
    expect(g.state.almanacScroll).toBe(tools - ALMANAC_ROWS);
  });

  it("answers no confirm and returns to the title on back", () => {
    const g = almanac();
    g.handleAction("confirm");
    g.handleAction("pause");
    expect(g.state.screen).toBe("almanac");
    g.handleAction("back");
    expect(g.state.screen).toBe("title");
    expect(g.state.menuIndex).toBe(TITLE_ITEMS.indexOf("THE ALMANAC"));
    expect(g.state.almanacTab).toBe(0);
    expect(g.state.almanacScroll).toBe(0);
  });
});

describe("the pointer", () => {
  it("highlights the item it rests in and sounds menu-move once", () => {
    const { game: g } = game();
    const rects = titleRects();
    hover(g, middle(rects[1]));
    expect(g.state.menuIndex).toBe(1);
    expect(g.drainCues()).toEqual(["menu-move"]);
    hover(g, middle(rects[1]));
    expect(g.drainCues()).toEqual([]);
  });

  it("leaves the highlight alone inside no rectangle", () => {
    const { game: g } = game();
    hover(g, { x: 20, y: 20 });
    expect(g.state.menuIndex).toBe(0);
    click(g, { x: 20, y: 20 });
    expect(g.state.screen).toBe("title");
    expect(g.state.menuIndex).toBe(0);
    expect(g.drainCues()).toEqual([]);
  });

  it("moves the highlight and then takes the item on a click", () => {
    const { game: g } = game();
    click(g, middle(titleRects()[2]));
    expect(g.state.screen).toBe("howto");
    expect(g.drainCues()).toEqual(["menu-move", "menu-confirm"]);
    g.toTitle();
    click(g, middle(titleRects()[0]));
    expect(g.state.screen).toBe("playing");
  });

  it("accepts a level-up offer and takes a pause item", () => {
    const { game: g } = game();
    g.startRun();
    g.state.run.pendingLevelUps = 1;
    g.openLevelUp();
    const offer = g.state.run.offers[1];
    click(g, middle(levelUpLayout(g.state.run.offers.length).offers[1]));
    expect(g.state.screen).toBe("playing");
    expect(
      [...g.state.run.weapons, ...g.state.run.passives].some(
        (held) => held.id === offer,
      ),
    ).toBe(true);
    g.pause();
    hover(g, middle(pauseRects()[1]));
    expect(g.state.menuIndex).toBe(1);
    click(g, middle(pauseRects()[1]));
    expect(g.state.screen).toBe("title");
  });

  it("takes an end screen's item", () => {
    const { game: g } = game();
    g.startRun();
    g.endRun("fallen");
    hover(g, middle(endRects()[1]));
    expect(g.state.menuIndex).toBe(1);
    click(g, middle(endRects()[0]));
    expect(g.state.screen).toBe("playing");
  });

  it("moves the almanac's highlight without leaving the screen", () => {
    const { game: g } = game();
    g.toAlmanac();
    const rows = almanacRowRects(almanacEntries(0).length);
    click(g, middle(rows[2]));
    expect(g.state.menuIndex).toBe(2);
    expect(g.state.screen).toBe("almanac");
  });

  it("reads an almanac row through the list's window", () => {
    const { game: g } = game();
    g.toAlmanac();
    g.state.almanacScroll = 3;
    const rows = almanacRowRects(almanacEntries(0).length);
    hover(g, middle(rows[2]));
    expect(g.state.menuIndex).toBe(5);
  });

  it("selects a tab exactly as right reaching it does", () => {
    const { game: g } = game();
    g.toAlmanac();
    g.handleAction("down");
    g.drainCues();
    click(g, middle(almanacTabRects()[2]));
    expect(g.state.almanacTab).toBe(2);
    expect(g.state.menuIndex).toBe(0);
    expect(g.state.almanacScroll).toBe(0);
    expect(g.drainCues()).toEqual(["menu-move"]);
  });

  it("takes nothing when the lift falls outside the box the press armed", () => {
    const { game: g } = game();
    const rects = titleRects();
    press(g, middle(rects[2]));
    expect(g.state.menuIndex).toBe(2);
    expect(g.state.screen).toBe("title");
    lift(g, middle(rects[0]));
    expect(g.state.screen).toBe("title");
    expect(g.state.menuIndex).toBe(2);
  });

  it("takes the item when the lift falls back inside the armed box", () => {
    const { game: g } = game();
    const rects = titleRects();
    press(g, middle(rects[2]));
    lift(g, middle(rects[2]));
    expect(g.state.screen).toBe("howto");
  });

  it("leaves the how-to screen on a click in its one box", () => {
    const { game: g } = game();
    g.toHowto();
    expect(menuRects(g.state)).toHaveLength(1);
    click(g, middle(howtoRects()[0]));
    expect(g.state.screen).toBe("title");
    expect(g.state.menuIndex).toBe(2);
  });

  it("closes the chest overlay on a click in its one box", () => {
    const { game: g } = game();
    g.startRun();
    g.state.screen = "chest";
    expect(menuRects(g.state)).toHaveLength(1);
    click(g, middle(chestRects()[0]));
    expect(g.state.screen).toBe("playing");
  });

  it("scrolls the almanac's list by the wheel, clamped, and nowhere else", () => {
    const { game: g } = game();
    g.toAlmanac();
    const tools = almanacEntries(0).length;
    wheel(g, WHEEL_ROW);
    expect(g.state.almanacScroll).toBe(1);
    expect(g.state.menuIndex).toBe(0);
    wheel(g, WHEEL_ROW / 2);
    expect(g.state.almanacScroll).toBe(1);
    wheel(g, WHEEL_ROW * 40);
    expect(g.state.almanacScroll).toBe(tools - ALMANAC_ROWS);
    wheel(g, -WHEEL_ROW * 40);
    expect(g.state.almanacScroll).toBe(0);
    g.toTitle();
    wheel(g, WHEEL_ROW * 3);
    expect(g.state.almanacScroll).toBe(0);
  });
});

describe("the end screens", () => {
  it("keeps the run, and TRY AGAIN or TITLE leave it", () => {
    const { game: g } = game();
    g.startRun();
    g.update(1);
    g.state.run.kills = 4;
    g.endRun("fallen");
    expect(g.state.screen).toBe("fallen");
    expect(g.state.run.kills).toBe(4);
    expect(g.wantedLoops().size).toBe(0);
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.kills).toBe(0);
    g.endRun("dawn");
    g.handleAction("down");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("title");
    g.startRun();
    g.endRun("dawn");
    g.handleAction("back");
    expect(g.state.screen).toBe("title");
  });
});

describe("the overlays", () => {
  it("opens the level-up overlay and chooses through the menu", () => {
    const { game: g } = game();
    g.startRun();
    g.state.run.pendingLevelUps = 1;
    expect(g.openLevelUp()).toBe(true);
    expect(g.state.screen).toBe("levelup");
    g.handleAction("down");
    expect(g.state.menuIndex).toBe(1);
    g.handleAction("up");
    g.handleAction("up");
    expect(g.state.menuIndex).toBe(2);
    g.handleAction("back");
    g.handleAction("pause");
    expect(g.state.screen).toBe("levelup");
    const chosen = g.state.run.offers[2];
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(
      [...g.state.run.weapons, ...g.state.run.passives].some(
        (held) => held.id === chosen,
      ),
    ).toBe(true);
  });

  it("refuses to open with nothing pending or off playing", () => {
    const { game: g } = game();
    g.startRun();
    expect(g.openLevelUp()).toBe(false);
    g.state.run.pendingLevelUps = 1;
    g.pause();
    expect(g.openLevelUp()).toBe(false);
    expect(g.choose(0)).toBe(false);
  });

  it("closes the chest overlay on confirm alone", () => {
    const { game: g } = game();
    g.startRun();
    g.state.screen = "chest";
    g.state.run.chestResult = { kind: "heal" };
    g.handleAction("up");
    g.handleAction("back");
    g.handleAction("pause");
    expect(g.state.screen).toBe("chest");
    g.handleAction("confirm");
    expect(g.state.screen).toBe("playing");
    expect(g.state.run.chestResult).toBeNull();
  });
});

describe("mute", () => {
  it("toggles the runtime bit from any screen and mirrors it", () => {
    const { game: g, mute } = game();
    g.handleAction("mute");
    expect(mute.on).toBe(true);
    g.mirrorMuted();
    expect(g.state.muted).toBe(true);
    g.startRun();
    g.handleAction("mute");
    g.mirrorMuted();
    expect(g.state.muted).toBe(false);
  });
});

describe("the accumulator", () => {
  it("consumes whole ticks and keeps the remainder on playing", () => {
    const { game: g } = game();
    g.startRun();
    g.update(0.04);
    expect(g.state.run.tick).toBe(2);
    expect(g.state.accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 12);
    g.update(0.5);
    expect(g.state.run.tick).toBe(32);
  });

  it("reaches the same tick however the time is divided", () => {
    const a = game().game;
    const b = game().game;
    a.startRun();
    b.startRun();
    a.update(0.5);
    for (let i = 0; i < 50; i += 1) b.update(0.01);
    expect(a.state.run.tick).toBe(30);
    expect(b.state.run.tick).toBe(30);
  });

  it("discards the remainder when a tick leaves playing", () => {
    const { game: g } = game();
    g.startRun();
    g.state.run.pendingLevelUps = 1;
    g.update(0.025);
    expect(g.state.screen).toBe("levelup");
    expect(g.state.run.tick).toBe(1);
    expect(g.state.accumulator).toBe(0);
    g.update(1);
    expect(g.state.run.tick).toBe(1);
  });

  it("stays at zero off playing", () => {
    const { game: g } = game();
    g.update(0.3);
    expect(g.state.accumulator).toBe(0);
    expect(g.state.run.tick).toBe(0);
  });
});

describe("reset", () => {
  it("returns to the title with a seeded generator, keeping muted", () => {
    const { game: g, mute } = game();
    g.startRun();
    g.update(1);
    g.state.switches.spawning = false;
    g.handleAction("mute");
    g.mirrorMuted();
    g.state.simTime = 5;
    g.autoStep = false;
    g.reset(42);
    expect(g.state.screen).toBe("title");
    expect(g.state.run).toEqual(idleRun());
    expect(g.state.switches.spawning).toBe(true);
    expect(g.state.simTime).toBe(0);
    expect(g.state.rngState).toBe(42);
    expect(g.state.muted).toBe(true);
    expect(mute.on).toBe(true);
    expect(g.autoStep).toBe(false);
    g.rng.next();
    expect(g.state.rngState).not.toBe(42);
  });

  it("replays the same run from the same seed", () => {
    const a = game().game;
    const b = game().game;
    a.reset(9);
    b.reset(9);
    for (const g of [a, b]) {
      g.startRun();
      g.state.run.pendingLevelUps = 3;
      g.update(TICK_DT);
      g.choose(1);
      g.choose(0);
    }
    expect(a.state.run.offers).toEqual(b.state.run.offers);
    expect(a.state.rngState).toBe(b.state.rngState);
  });
});
