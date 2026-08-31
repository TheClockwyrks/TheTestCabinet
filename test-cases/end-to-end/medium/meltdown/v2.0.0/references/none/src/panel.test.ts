// The build panel's layout.
//
// `specs/hud.md` fixes WHAT the panel holds and leaves WHERE to the build, with
// two requirements that survive that freedom: every control is at least
// MIN_TOUCH_TARGET on both sides, and every control lies inside the panel's
// strip (specs/floor.md). The snapshot then reports where the panel actually put
// each one (specs/instrumentation.md), which is what a scripted scenario taps.

import { describe, expect, it } from "vitest";
import {
  MIN_TOUCH_TARGET,
  PANEL_X,
  STAGE_H,
  STAGE_W,
  TOWER_TYPES,
} from "./constants";
import {
  INFO_RECT,
  STATUS_RECT,
  everyControlRect,
  isTouchTarget,
  panelControls,
  shopRects,
} from "./panel";
import { addTower, arm } from "./build";
import { createState, type MeltdownState } from "./state";
import { inRect, type Rect } from "./types";

function scene(): MeltdownState {
  const state = createState();
  state.screen = "playing";
  state.phase = "building";
  state.money = 1000;
  return state;
}

/** Whether two rectangles share no pixel. */
function apart(a: Rect, b: Rect): boolean {
  return (
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/** Whether a rectangle lies wholly inside the panel's strip. */
function insideStrip(rect: Rect): boolean {
  return (
    rect.x >= PANEL_X &&
    rect.x + rect.w <= STAGE_W &&
    rect.y >= 0 &&
    rect.y + rect.h <= STAGE_H
  );
}

describe("the shop", () => {
  it("lists all eight types, in shop order", () => {
    expect(shopRects().map((entry) => entry.type)).toEqual([...TOWER_TYPES]);
  });

  it("gives every entry its own rectangle, none overlapping another", () => {
    const rects = shopRects();
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(apart(rects[i], rects[j])).toBe(true);
      }
    }
  });
});

describe("every control", () => {
  it("is at least the minimum touch target on both sides", () => {
    for (const rect of everyControlRect()) {
      expect(isTouchTarget(rect)).toBe(true);
      expect(rect.w).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(rect.h).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it("lies inside the panel's strip, so nothing is drawn on the floor", () => {
    for (const rect of everyControlRect()) expect(insideStrip(rect)).toBe(true);
    expect(insideStrip(INFO_RECT)).toBe(true);
    expect(insideStrip(STATUS_RECT)).toBe(true);
  });

  // The information area and the status area are drawn EARLIER than the controls
  // and are full of text, so a control laid over either does not sit beside that
  // text — it paints it out, and a readout a player cannot read is a readout the
  // panel does not have (specs/overview.md's legibility rule). This is the
  // arithmetic guard on that: the two reading areas keep clear of every control.
  it("keeps clear of the two areas the panel reads out in", () => {
    for (const rect of everyControlRect()) {
      expect(apart(rect, INFO_RECT)).toBe(true);
      expect(apart(rect, STATUS_RECT)).toBe(true);
    }
    expect(apart(INFO_RECT, STATUS_RECT)).toBe(true);
  });
});

describe("what the panel is drawing", () => {
  it("offers the wave controls at all times", () => {
    const controls = panelControls(scene());
    expect(controls.send).toBeTruthy();
    expect(controls.speed).toBeTruthy();
    expect(controls.pause).toBeTruthy();
    expect(controls.mute).toBeTruthy();
  });

  it("draws rotate and cancel only while a placement is armed", () => {
    const state = scene();
    expect(panelControls(state).rotate).toBeNull();
    expect(panelControls(state).cancel).toBeNull();
    arm(state, "arc");
    expect(panelControls(state).rotate).not.toBeNull();
    expect(panelControls(state).cancel).not.toBeNull();
    arm(state, null);
    expect(panelControls(state).rotate).toBeNull();
  });

  it("draws upgrade and sell only while a tower is selected", () => {
    const state = scene();
    expect(panelControls(state).upgrade).toBeNull();
    expect(panelControls(state).sell).toBeNull();
    const tower = addTower(state, "arc", 4, 4, 0);
    state.selected = tower.id;
    expect(panelControls(state).upgrade).not.toBeNull();
    expect(panelControls(state).sell).not.toBeNull();
  });

  it("puts no two live controls on the same point", () => {
    const state = scene();
    arm(state, "arc");
    const tower = addTower(state, "arc", 4, 4, 0);
    state.selected = tower.id;
    const controls = panelControls(state);
    const live: Rect[] = [
      ...controls.shop,
      controls.rotate as Rect,
      controls.cancel as Rect,
      controls.upgrade as Rect,
      controls.sell as Rect,
      controls.send,
      controls.speed,
      controls.pause,
      controls.mute,
    ];
    for (const rect of live) {
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      const hits = live.filter((other) => inRect(other, centre.x, centre.y));
      expect(hits).toHaveLength(1);
    }
  });

  it("hands out copies, so a caller cannot move the panel by writing to one", () => {
    const state = scene();
    const first = panelControls(state);
    first.send.x = -1;
    expect(panelControls(state).send.x).toBeGreaterThan(PANEL_X);
  });
});
