// The three pointer rules over the bare state, and the rectangles they act
// on: a hover moves the highlight, a click moves it and takes the item, and
// the wheel scrolls the almanac's list. The rectangles are the renderer's own,
// so a hit test that agreed with nothing drawn would fail here first.

import { describe, expect, it } from "vitest";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  STAGE_H,
  STAGE_W,
  WHEEL_ROW,
  type CueName,
} from "./constants";
import { pause, startRun, toAlmanac, toHowto } from "./flow";
import type { PointerFrame } from "./input";
import { menuRects, tabRects, type WickRect } from "./menus";
import { applyPointer } from "./pointer";
import { initialState, type WickState } from "./state";

interface Bench {
  state: WickState;
  cues: CueName[];
  /** Rest the pointer at the center of the rectangle `rects[index]`. */
  hover(rects: readonly WickRect[], index: number): void;
  click(rects: readonly WickRect[], index: number): void;
  /** Rest the pointer at a stage point, pressing nothing. */
  at(x: number, y: number): void;
  clickAt(x: number, y: number): void;
  /** Press at a stage point and leave the button down. */
  pressAt(x: number, y: number): void;
  /** Lift at a stage point, with no press before it on the same frame. */
  liftAt(x: number, y: number): void;
  scroll(travel: number): void;
}

function center(rect: WickRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function bench(): Bench {
  const state = initialState();
  const cues: CueName[] = [];
  const drive = (frame: PointerFrame): void => {
    applyPointer(state, frame, (cue) => cues.push(cue));
  };
  const b: Bench = {
    state,
    cues,
    at: (x, y) => drive({ at: { x, y }, presses: [], releases: [], wheel: 0 }),
    clickAt: (x, y) =>
      drive({
        at: null,
        presses: [{ x, y }],
        releases: [{ x, y }],
        wheel: 0,
      }),
    pressAt: (x, y) =>
      drive({ at: null, presses: [{ x, y }], releases: [], wheel: 0 }),
    liftAt: (x, y) =>
      drive({ at: null, presses: [], releases: [{ x, y }], wheel: 0 }),
    hover: (rects, index) => {
      const { x, y } = center(rects[index]);
      b.at(x, y);
    },
    click: (rects, index) => {
      const { x, y } = center(rects[index]);
      b.clickAt(x, y);
    },
    scroll: (travel) =>
      drive({ at: null, presses: [], releases: [], wheel: travel }),
  };
  return b;
}

function drain(b: Bench): CueName[] {
  return b.cues.splice(0, b.cues.length);
}

describe("hover", () => {
  it("highlights the item the pointer rests on, once", () => {
    const b = bench();
    b.hover(menuRects(b.state), 1);
    expect(b.state.menuIndex).toBe(1);
    expect(drain(b)).toEqual(["menu-move"]);
    b.hover(menuRects(b.state), 1);
    expect(drain(b)).toEqual([]);
  });

  it("changes nothing inside no rectangle", () => {
    const b = bench();
    b.hover(menuRects(b.state), 2);
    drain(b);
    b.at(STAGE_W - 2, 2);
    expect(b.state.menuIndex).toBe(2);
    expect(drain(b)).toEqual([]);
  });

  it("changes nothing on a screen with no menu", () => {
    const b = bench();
    startRun(b.state);
    expect(menuRects(b.state)).toEqual([]);
    b.at(STAGE_W / 2, STAGE_H / 2);
    expect(b.state.menuIndex).toBe(0);
    expect(drain(b)).toEqual([]);
  });
});

describe("click", () => {
  it("takes the item it lands on, moving the highlight first", () => {
    const b = bench();
    b.click(menuRects(b.state), 2);
    expect(b.state.screen).toBe("howto");
    expect(drain(b)).toEqual(["menu-move", "menu-confirm"]);
  });

  it("takes the highlighted item with no move of its own", () => {
    const b = bench();
    b.click(menuRects(b.state), 0);
    expect(b.state.screen).toBe("playing");
    expect(drain(b)).toEqual(["menu-confirm"]);
  });

  it("takes nothing inside no rectangle", () => {
    const b = bench();
    b.clickAt(STAGE_W - 2, STAGE_H - 2);
    expect(b.state.screen).toBe("title");
    expect(b.state.menuIndex).toBe(0);
    expect(drain(b)).toEqual([]);
  });

  it("resumes and abandons from the pause menu", () => {
    const b = bench();
    startRun(b.state);
    pause(b.state);
    b.click(menuRects(b.state), 0);
    expect(b.state.screen).toBe("playing");
    pause(b.state);
    b.click(menuRects(b.state), 1);
    expect(b.state.screen).toBe("title");
    expect(b.state.run.weapons).toEqual([]);
  });
});

describe("the almanac", () => {
  function almanac(): Bench {
    const b = bench();
    toAlmanac(b.state);
    return b;
  }

  it("highlights and takes an entry without leaving the screen", () => {
    const b = almanac();
    b.click(menuRects(b.state), 2);
    expect(b.state.screen).toBe("almanac");
    expect(b.state.menuIndex).toBe(2);
    expect(drain(b)).toEqual(["menu-move"]);
  });

  it("resolves a row through the window the list shows", () => {
    const b = almanac();
    b.state.almanacScroll = 4;
    b.hover(menuRects(b.state), 2);
    expect(b.state.menuIndex).toBe(6);
    expect(b.state.almanacScroll).toBe(4);
  });

  it("selects a tab on a click, from the top of its list", () => {
    const b = almanac();
    b.state.menuIndex = 12;
    b.state.almanacScroll = 6;
    b.click(tabRects(b.state), 2);
    expect(ALMANAC_TABS[b.state.almanacTab]).toBe("ENEMIES");
    expect(b.state.menuIndex).toBe(0);
    expect(b.state.almanacScroll).toBe(0);
    expect(drain(b)).toEqual(["menu-move"]);
  });

  it("scrolls by whole rows of travel, leaving the highlight alone", () => {
    const b = almanac();
    b.scroll(WHEEL_ROW - 1);
    expect(b.state.almanacScroll).toBe(0);
    b.scroll(WHEEL_ROW);
    expect(b.state.almanacScroll).toBe(1);
    expect(b.state.menuIndex).toBe(0);
    b.scroll(WHEEL_ROW * 100);
    expect(b.state.almanacScroll).toBe(16 - ALMANAC_ROWS);
    b.scroll(-WHEEL_ROW * 100);
    expect(b.state.almanacScroll).toBe(0);
    expect(drain(b)).toEqual([]);
  });

  it("leaves the wheel inert on every other screen", () => {
    const b = bench();
    b.scroll(WHEEL_ROW * 4);
    expect(b.state.almanacScroll).toBe(0);
    expect(b.state.menuIndex).toBe(0);
  });
});

describe("press and release", () => {
  it("takes nothing when the lift falls outside the box the press armed", () => {
    const b = bench();
    const rects = menuRects(b.state);
    const armed = center(rects[2]);
    const elsewhere = center(rects[0]);
    b.pressAt(armed.x, armed.y);
    expect(b.state.menuIndex).toBe(2);
    expect(b.state.screen).toBe("title");
    b.liftAt(elsewhere.x, elsewhere.y);
    expect(b.state.screen).toBe("title");
    expect(b.state.menuIndex).toBe(2);
  });

  it("takes the item when the lift falls back inside the armed box", () => {
    const b = bench();
    const armed = center(menuRects(b.state)[2]);
    b.pressAt(armed.x, armed.y);
    b.liftAt(armed.x, armed.y);
    expect(b.state.screen).toBe("howto");
  });

  it("leaves the how-to screen from its one box", () => {
    const b = bench();
    toHowto(b.state);
    const rects = menuRects(b.state);
    expect(rects).toHaveLength(1);
    b.click(rects, 0);
    expect(b.state.screen).toBe("title");
    expect(b.state.menuIndex).toBe(2);
  });

  it("closes the chest overlay from its one box", () => {
    const b = bench();
    startRun(b.state);
    b.state.screen = "chest";
    const rects = menuRects(b.state);
    expect(rects).toHaveLength(1);
    b.click(rects, 0);
    expect(b.state.screen).toBe("playing");
  });
});
