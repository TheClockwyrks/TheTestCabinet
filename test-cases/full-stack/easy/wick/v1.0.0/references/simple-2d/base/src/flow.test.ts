import { describe, expect, it } from "vitest";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  ENEMY_IDS,
  TICK_DT,
  TITLE_ITEMS,
  WHEEL_ROW,
  type ActionName,
  type CueName,
} from "./constants";
import { entriesOf } from "./almanac";
import { wantedLoops } from "./audio";
import {
  NO_POINTER,
  applyPointer,
  choose,
  consumeTime,
  endRun,
  handleAction,
  openLevelUpOverlay,
  pause,
  runFrame,
  startRun,
  toAlmanac,
  toHowto,
  type PointerInput,
} from "./flow";
import type { WickRect } from "./game";
import { menuRects, tabRects } from "./menus";
import { idleRun, initialState, type Draft } from "./state";
import { NOTHING_HELD } from "./sim/context";

interface World {
  state: Draft;
  mute: { on: boolean };
  cues: Set<CueName>;
  press(action: ActionName): void;
  point(pointer: PointerInput): void;
  drain(): CueName[];
  update(dt: number): void;
}

/** The middle of a rectangle, which is where a pointer test aims. */
function center(rect: WickRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** A device resting, out of contact, on the middle of `rect`. */
function at(rect: WickRect): PointerInput {
  return { at: center(rect), presses: [], releases: [], wheel: 0 };
}

/** A whole click on the middle of `rect`: the press arms it, the lift takes it. */
function click(rect: WickRect): PointerInput {
  const point = center(rect);
  return { at: null, presses: [point], releases: [point], wheel: 0 };
}

/** A press on the middle of `rect`, with the button left down. */
function press(rect: WickRect): PointerInput {
  return { at: null, presses: [center(rect)], releases: [], wheel: 0 };
}

/** A lift at a stage point, with no press before it on the same frame. */
function lift(point: { x: number; y: number }): PointerInput {
  return { at: null, presses: [], releases: [point], wheel: 0 };
}

/** A frame carrying wheel travel and nothing else. */
function turn(travel: number): PointerInput {
  return { at: null, presses: [], releases: [], wheel: travel };
}

/** One frame of nothing but the press edges `pressed`, in order. */
function edges(state: Draft, pressed: ActionName[]): Draft {
  return runFrame(state, {
    dt: 0,
    pressed,
    held: NOTHING_HELD,
    pointer: NO_POINTER,
    toggleMute: () => {},
  }).draft;
}

/** A run held under the pause screen, the state a pause menu is read from. */
function pausedRun(): Draft {
  const state = initialState();
  startRun(state);
  pause(state);
  return state;
}

function world(): World {
  const state = initialState();
  const mute = { on: false };
  const cues = new Set<CueName>();
  return {
    state,
    mute,
    cues,
    press: (action) =>
      handleAction(state, action, cues, () => {
        mute.on = !mute.on;
      }),
    point: (pointer) => applyPointer(state, pointer, cues),
    drain: () => {
      const out = [...cues];
      cues.clear();
      return out;
    },
    update: (dt) => consumeTime(state, dt, NOTHING_HELD, cues),
  };
}

describe("the title screen", () => {
  it("opens on title with the idle run", () => {
    const { state } = world();
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
    expect(state.run).toEqual(idleRun());
  });

  it("wraps the highlight both ways and sounds menu-move", () => {
    const w = world();
    w.press("up");
    expect(w.state.menuIndex).toBe(2);
    w.press("down");
    expect(w.state.menuIndex).toBe(0);
    w.press("down");
    expect(w.state.menuIndex).toBe(1);
    expect(w.drain()).toEqual(["menu-move"]);
  });

  it("starts a fresh run on LIGHT THE LAMP", () => {
    const w = world();
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.weapons).toEqual([
      { id: "taper", level: 1, cooldown: 0, cooldownSet: 0 },
    ]);
    expect(w.state.run.player).toEqual({
      x: 0,
      y: 0,
      facing: "right",
      hp: 100,
    });
    expect(w.drain()).toEqual(["menu-confirm"]);
    expect(wantedLoops(w.state)).toContain("music");
  });

  it("opens howto on HOW TO PLAY and back returns", () => {
    const w = world();
    w.press("down");
    w.press("down");
    w.press("confirm");
    expect(w.state.screen).toBe("howto");
    expect(w.state.menuIndex).toBe(0);
    w.press("back");
    expect(w.state.screen).toBe("title");
    expect(wantedLoops(w.state)).toEqual([]);
  });

  it("ignores back and pause on title", () => {
    const w = world();
    w.press("back");
    w.press("pause");
    expect(w.state.screen).toBe("title");
  });
});

describe("pause", () => {
  it("holds the run under paused and resumes it untouched", () => {
    const w = world();
    startRun(w.state);
    w.update(0.5);
    w.state.accumulator = 0.01;
    w.press("pause");
    expect(w.state.screen).toBe("paused");
    expect(w.state.accumulator).toBe(0);
    const tick = w.state.run.tick;
    w.update(1);
    expect(w.state.run.tick).toBe(tick);
    expect(wantedLoops(w.state)).toContain("music");
    w.press("pause");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.tick).toBe(tick);
  });

  it("resumes on back as it does on pause", () => {
    const w = world();
    startRun(w.state);
    w.update(TICK_DT);
    pause(w.state);
    w.press("back");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.tick).toBe(1);
  });

  it("carries a menu that resumes or abandons the night", () => {
    const w = world();
    startRun(w.state);
    pause(w.state);
    expect(w.state.menuIndex).toBe(0);
    w.press("up");
    expect(w.state.menuIndex).toBe(1);
    w.press("down");
    expect(w.state.menuIndex).toBe(0);
    w.drain();
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(w.drain()).toEqual(["menu-confirm"]);
    pause(w.state);
    w.press("down");
    w.press("confirm");
    expect(w.state.screen).toBe("title");
    expect(w.state.run).toEqual(idleRun());
  });
});

describe("the almanac", () => {
  it("opens from the title with the idle run and every index at zero", () => {
    const w = world();
    w.press("down");
    w.press("confirm");
    expect(w.state.screen).toBe("almanac");
    expect(w.state.menuIndex).toBe(0);
    expect(w.state.almanacTab).toBe(0);
    expect(w.state.almanacScroll).toBe(0);
    expect(w.state.run).toEqual(idleRun());
    expect(wantedLoops(w.state)).toEqual([]);
  });

  it("moves the entry highlight over the tab's entries, wrapping", () => {
    const w = world();
    toAlmanac(w.state);
    const tools = entriesOf(0).length;
    w.press("down");
    expect(w.state.menuIndex).toBe(1);
    w.press("up");
    expect(w.state.menuIndex).toBe(0);
    w.press("up");
    expect(w.state.menuIndex).toBe(tools - 1);
    expect(w.drain()).toEqual(["menu-move"]);
  });

  it("carries the window with the highlight and back to the top", () => {
    const w = world();
    toAlmanac(w.state);
    // The window holds while the highlight is inside it, and follows it out.
    for (let i = 0; i < ALMANAC_ROWS - 1; i += 1) w.press("down");
    expect(w.state.almanacScroll).toBe(0);
    w.press("down");
    expect(w.state.menuIndex).toBe(ALMANAC_ROWS);
    expect(w.state.almanacScroll).toBe(1);
    w.press("up");
    expect(w.state.almanacScroll).toBe(1);
    for (let i = 0; i < ALMANAC_ROWS - 1; i += 1) w.press("up");
    expect(w.state.menuIndex).toBe(0);
    expect(w.state.almanacScroll).toBe(0);
    // Wrapping to the last entry shows the end of the list.
    w.press("up");
    expect(w.state.almanacScroll).toBe(entriesOf(0).length - ALMANAC_ROWS);
  });

  it("moves the tab both ways, wrapping, and restarts the list", () => {
    const w = world();
    toAlmanac(w.state);
    w.press("down");
    w.press("right");
    expect(w.state.almanacTab).toBe(1);
    expect(w.state.menuIndex).toBe(0);
    expect(w.state.almanacScroll).toBe(0);
    w.press("left");
    expect(w.state.almanacTab).toBe(0);
    w.press("left");
    expect(w.state.almanacTab).toBe(ALMANAC_TABS.length - 1);
    w.press("right");
    expect(w.state.almanacTab).toBe(0);
    expect(w.drain()).toEqual(["menu-move"]);
  });

  it("lists the entries of every tab in the order the tables give them", () => {
    expect(entriesOf(0).map((entry) => entry.name)).toHaveLength(16);
    expect(entriesOf(1).map((entry) => entry.name)).toHaveLength(10);
    expect(entriesOf(2).map((entry) => entry.name)).toHaveLength(
      ENEMY_IDS.length,
    );
    expect(entriesOf(3).map((entry) => entry.name)).toEqual([
      "Small Gem",
      "Medium Gem",
      "Large Gem",
      "Chest",
      "Bread",
      "Draft",
    ]);
  });

  it("answers back alone, ticks nothing, and ignores confirm", () => {
    const w = world();
    toAlmanac(w.state);
    w.press("confirm");
    w.press("pause");
    w.update(1);
    expect(w.state.screen).toBe("almanac");
    expect(w.state.run.tick).toBe(0);
    expect(w.state.accumulator).toBe(0);
    w.press("back");
    expect(w.state.screen).toBe("title");
    // Returning selects the entry that led away (specs/ui.md, `almanac`).
    expect(w.state.menuIndex).toBe(TITLE_ITEMS.indexOf("THE ALMANAC"));
  });
});

describe("the pointer", () => {
  it("moves the title highlight to the item it rests in, once", () => {
    const w = world();
    const rects = menuRects(w.state);
    w.point(at(rects[1]));
    expect(w.state.menuIndex).toBe(1);
    expect(w.drain()).toEqual(["menu-move"]);
    w.point(at(rects[1]));
    expect(w.drain()).toEqual([]);
  });

  it("changes nothing while it rests in no rectangle", () => {
    const w = world();
    w.point({
      at: null,
      presses: [{ x: 4, y: 4 }],
      releases: [{ x: 4, y: 4 }],
      wheel: 0,
    });
    expect(w.state.menuIndex).toBe(0);
    expect(w.state.screen).toBe("title");
    expect(w.drain()).toEqual([]);
  });

  it("takes the item it clicks, moving the highlight there first", () => {
    const w = world();
    w.point(click(menuRects(w.state)[2]));
    expect(w.state.screen).toBe("howto");
    expect(w.state.menuIndex).toBe(0);
    expect(w.drain()).toEqual(["menu-move", "menu-confirm"]);
    const fresh = world();
    fresh.point(click(menuRects(fresh.state)[0]));
    expect(fresh.state.screen).toBe("playing");
    expect(fresh.state.run.weapons).toHaveLength(1);
  });

  it("accepts a level-up offer it clicks", () => {
    const w = world();
    startRun(w.state);
    w.state.run.pendingLevelUps = 1;
    openLevelUpOverlay(w.state, w.cues);
    const chosen = w.state.run.offers[1];
    w.point(click(menuRects(w.state)[1]));
    expect(w.state.menuIndex).toBe(0);
    expect(w.state.screen).toBe("playing");
    expect(
      [...w.state.run.weapons, ...w.state.run.passives].some(
        (held) => held.id === chosen,
      ),
    ).toBe(true);
  });

  it("resumes and abandons the night from the pause menu", () => {
    const w = world();
    startRun(w.state);
    pause(w.state);
    w.point(click(menuRects(w.state)[0]));
    expect(w.state.screen).toBe("playing");
    pause(w.state);
    w.point(click(menuRects(w.state)[1]));
    expect(w.state.screen).toBe("title");
    expect(w.state.run).toEqual(idleRun());
  });

  it("takes an end screen's item", () => {
    const w = world();
    startRun(w.state);
    endRun(w.state, "fallen", w.cues);
    w.point(at(menuRects(w.state)[1]));
    expect(w.state.menuIndex).toBe(1);
    w.point(click(menuRects(w.state)[0]));
    expect(w.state.screen).toBe("playing");
  });

  it("highlights an almanac entry without leaving the screen", () => {
    const w = world();
    toAlmanac(w.state);
    w.point(click(menuRects(w.state)[2]));
    expect(w.state.menuIndex).toBe(2);
    expect(w.state.screen).toBe("almanac");
  });

  it("reads a hovered row through the window the list shows", () => {
    const w = world();
    toAlmanac(w.state);
    w.state.almanacScroll = 3;
    w.point(at(menuRects(w.state)[2]));
    expect(w.state.menuIndex).toBe(5);
  });

  it("selects the tab it clicks, restarting the list", () => {
    const w = world();
    toAlmanac(w.state);
    w.state.menuIndex = 4;
    w.state.almanacScroll = 2;
    w.point(click(tabRects(w.state)[2]));
    expect(w.state.almanacTab).toBe(2);
    expect(w.state.menuIndex).toBe(0);
    expect(w.state.almanacScroll).toBe(0);
    expect(w.drain()).toEqual(["menu-move"]);
  });

  it("takes nothing when the lift falls outside the box the press armed", () => {
    const w = world();
    const rects = menuRects(w.state);
    w.point(press(rects[2]));
    expect(w.state.menuIndex).toBe(2);
    expect(w.state.screen).toBe("title");
    w.point(lift(center(rects[0])));
    expect(w.state.screen).toBe("title");
    expect(w.state.menuIndex).toBe(2);
  });

  it("takes the item when the lift falls back inside the armed box", () => {
    const w = world();
    const rects = menuRects(w.state);
    w.point(press(rects[2]));
    w.point(lift(center(rects[2])));
    expect(w.state.screen).toBe("howto");
  });

  it("leaves the how-to screen on a click in its one box", () => {
    const w = world();
    toHowto(w.state);
    const rects = menuRects(w.state);
    expect(rects).toHaveLength(1);
    w.point(click(rects[0]));
    expect(w.state.screen).toBe("title");
    expect(w.state.menuIndex).toBe(2);
  });

  it("closes the chest overlay on a click in its one box", () => {
    const w = world();
    startRun(w.state);
    w.state.screen = "chest";
    const rects = menuRects(w.state);
    expect(rects).toHaveLength(1);
    w.point(click(rects[0]));
    expect(w.state.screen).toBe("playing");
  });

  it("scrolls the almanac's list by whole rows, held within the list", () => {
    const w = world();
    toAlmanac(w.state);
    w.point(turn(WHEEL_ROW));
    expect(w.state.almanacScroll).toBe(1);
    expect(w.state.menuIndex).toBe(0);
    w.point(turn(WHEEL_ROW - 1));
    expect(w.state.almanacScroll).toBe(1);
    w.point(turn(WHEEL_ROW * 40));
    expect(w.state.almanacScroll).toBe(entriesOf(0).length - ALMANAC_ROWS);
    w.point(turn(-WHEEL_ROW * 40));
    expect(w.state.almanacScroll).toBe(0);
  });

  it("leaves every other screen's wheel alone", () => {
    const w = world();
    w.point(turn(WHEEL_ROW * 4));
    expect(w.state.almanacScroll).toBe(0);
    expect(w.state.menuIndex).toBe(0);
  });
});

describe("the end screens", () => {
  it("keeps the run, and TRY AGAIN or TITLE leave it", () => {
    const w = world();
    startRun(w.state);
    w.update(1);
    w.state.run.kills = 4;
    endRun(w.state, "fallen", w.cues);
    expect(w.state.screen).toBe("fallen");
    expect(w.state.run.kills).toBe(4);
    expect(w.drain()).toEqual(["fallen"]);
    expect(wantedLoops(w.state)).toEqual([]);
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.kills).toBe(0);
    endRun(w.state, "dawn", w.cues);
    w.press("down");
    w.press("confirm");
    expect(w.state.screen).toBe("title");
    startRun(w.state);
    endRun(w.state, "dawn", w.cues);
    w.press("back");
    expect(w.state.screen).toBe("title");
  });
});

describe("the overlays", () => {
  it("opens the level-up overlay and chooses through the menu", () => {
    const w = world();
    startRun(w.state);
    w.state.run.pendingLevelUps = 1;
    expect(openLevelUpOverlay(w.state, w.cues)).toBe(true);
    expect(w.state.screen).toBe("levelup");
    w.press("down");
    expect(w.state.menuIndex).toBe(1);
    w.press("up");
    w.press("up");
    expect(w.state.menuIndex).toBe(2);
    w.press("back");
    w.press("pause");
    expect(w.state.screen).toBe("levelup");
    const chosen = w.state.run.offers[2];
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(
      [...w.state.run.weapons, ...w.state.run.passives].some(
        (held) => held.id === chosen,
      ),
    ).toBe(true);
  });

  it("refuses to open with nothing pending or off playing", () => {
    const w = world();
    startRun(w.state);
    expect(openLevelUpOverlay(w.state, w.cues)).toBe(false);
    w.state.run.pendingLevelUps = 1;
    pause(w.state);
    expect(openLevelUpOverlay(w.state, w.cues)).toBe(false);
    expect(choose(w.state, 0, w.cues)).toBe(false);
  });

  it("closes the chest overlay on confirm alone", () => {
    const w = world();
    startRun(w.state);
    w.state.screen = "chest";
    w.state.run.chestResult = { kind: "heal" };
    w.press("up");
    w.press("back");
    w.press("pause");
    expect(w.state.screen).toBe("chest");
    w.press("confirm");
    expect(w.state.screen).toBe("playing");
    expect(w.state.run.chestResult).toBeNull();
  });
});

describe("mute", () => {
  it("toggles the engine's bit from any screen", () => {
    const w = world();
    w.press("mute");
    expect(w.mute.on).toBe(true);
    startRun(w.state);
    w.press("mute");
    expect(w.mute.on).toBe(false);
    w.state.screen = "chest";
    w.press("mute");
    expect(w.mute.on).toBe(true);
  });
});

describe("the accumulator", () => {
  it("consumes whole ticks and keeps the remainder on playing", () => {
    const w = world();
    startRun(w.state);
    w.update(0.04);
    expect(w.state.run.tick).toBe(2);
    expect(w.state.accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 12);
    w.update(0.5);
    expect(w.state.run.tick).toBe(32);
  });

  it("reaches the same tick however the time is divided", () => {
    const a = world();
    const b = world();
    startRun(a.state);
    startRun(b.state);
    a.update(0.5);
    for (let i = 0; i < 50; i += 1) b.update(0.01);
    expect(a.state.run.tick).toBe(30);
    expect(b.state.run.tick).toBe(30);
  });

  it("discards the remainder when a tick leaves playing", () => {
    const w = world();
    startRun(w.state);
    w.state.run.pendingLevelUps = 1;
    w.update(0.025);
    expect(w.state.screen).toBe("levelup");
    expect(w.state.run.tick).toBe(1);
    expect(w.state.accumulator).toBe(0);
    w.update(1);
    expect(w.state.run.tick).toBe(1);
  });

  it("stays at zero off playing", () => {
    const w = world();
    w.update(0.3);
    expect(w.state.accumulator).toBe(0);
    expect(w.state.run.tick).toBe(0);
  });
});

describe("a frame", () => {
  it("leaves the state it was handed as it was and returns a new one", () => {
    const before = initialState();
    const frozen = JSON.stringify(before);
    const { draft } = runFrame(before, {
      dt: TICK_DT,
      pressed: ["confirm"],
      held: NOTHING_HELD,
      pointer: NO_POINTER,
      toggleMute: () => {},
    });
    expect(JSON.stringify(before)).toBe(frozen);
    expect(draft).not.toBe(before);
    expect(draft.screen).toBe("playing");
    expect(draft.run.tick).toBe(1);
  });

  it("reads every edge against the screen it began on", () => {
    // `confirm` starts the run; the same frame's `pause` arrived on `title`,
    // which does not answer it, so the run is not paused on arrival.
    const { draft } = runFrame(initialState(), {
      dt: 0,
      pressed: ["confirm", "pause"],
      held: NOTHING_HELD,
      pointer: NO_POINTER,
      toggleMute: () => {},
    });
    expect(draft.screen).toBe("playing");
  });

  it("answers no later edge on the screen a press landed in", () => {
    // Both edges of each pair are answered by the screen the frame began on,
    // and the first of each changes it: the run `confirm` resumed is not
    // paused again by `back` or by `pause`, the pause `back` opened is not
    // resumed by `pause`, and the fresh run `TRY AGAIN` started is not paused
    // by `back`.
    expect(edges(pausedRun(), ["confirm", "back"]).screen).toBe("playing");
    expect(edges(pausedRun(), ["confirm", "pause"]).screen).toBe("playing");

    const running = initialState();
    startRun(running);
    expect(edges(running, ["back", "pause"]).screen).toBe("paused");

    const fallen = initialState();
    startRun(fallen);
    endRun(fallen, "fallen", new Set<CueName>());
    expect(edges(fallen, ["confirm", "back"]).screen).toBe("playing");
  });

  it("toggles mute on a frame whose earlier edge changed the screen", () => {
    // `mute` is read on every screen and moves none, so it is answered even
    // where the edge before it left the screen the frame began on.
    const mute = { on: false };
    const { draft } = runFrame(initialState(), {
      dt: 0,
      pressed: ["confirm", "mute"],
      held: NOTHING_HELD,
      pointer: NO_POINTER,
      toggleMute: () => {
        mute.on = !mute.on;
      },
    });
    expect(draft.screen).toBe("playing");
    expect(mute.on).toBe(true);
  });

  it("adds the delta to simTime on every screen and ticks on playing alone", () => {
    let state = initialState();
    const frame = (dt: number, held = NOTHING_HELD): void => {
      state = runFrame(state, {
        dt,
        pressed: [],
        held,
        pointer: NO_POINTER,
        toggleMute: () => {},
      }).draft;
    };
    frame(0.25);
    expect(state.simTime).toBeCloseTo(0.25, 12);
    expect(state.run.tick).toBe(0);
    startRun(state);
    frame(0.5, { up: 0, down: 0, left: 0, right: 1 });
    expect(state.simTime).toBeCloseTo(0.75, 12);
    expect(state.run.tick).toBe(30);
    expect(state.run.player.x).toBeCloseTo(90, 6);
  });
});
