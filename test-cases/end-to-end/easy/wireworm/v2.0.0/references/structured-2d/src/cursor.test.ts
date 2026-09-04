import { describe, expect, it } from "vitest";
import { noCues } from "./audio";
import {
  CURSOR_HALF,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  FIRE_INTERVAL,
  MAX_BOLTS,
  tileCX,
} from "./constants";
import {
  clampToBand,
  cursorTouched,
  placeCursor,
  resolveCursorIntent,
  type CursorIntent,
} from "./cursor";
import { playingState, poseFoe, poseWorm } from "./fixtures";

const STILL: CursorIntent = {
  left: false,
  right: false,
  up: false,
  down: false,
  fire: false,
};

const SECOND = 1;

describe("moving in the band", () => {
  it("clamps the center to the band's four bounds", () => {
    expect(clampToBand(-500, 0)).toEqual({ x: CURSOR_X_MIN, y: CURSOR_Y_MIN });
    expect(clampToBand(5000, 5000)).toEqual({
      x: CURSOR_X_MAX,
      y: CURSOR_Y_MAX,
    });
  });

  it("travels at the cursor's own rate while a movement is held", () => {
    const state = playingState();
    placeCursor(state, 400, 688);
    resolveCursorIntent(state, SECOND, { ...STILL, right: true }, noCues());
    expect(state.cursor.x).toBeCloseTo(400 + CURSOR_SPEED, 6);
  });

  it("splits that same rate between two axes held together", () => {
    const state = playingState();
    placeCursor(state, 400, CURSOR_Y_MAX);
    resolveCursorIntent(
      state,
      SECOND,
      { ...STILL, right: true, up: true },
      noCues(),
    );
    expect(state.cursor.x - 400).toBeCloseTo(CURSOR_SPEED / Math.SQRT2, 4);
    // The band is only 32 units tall, so the vertical half lands on the bound.
    expect(state.cursor.y).toBe(CURSOR_Y_MIN);
  });

  it("cancels opposite movements on an axis", () => {
    const state = playingState();
    placeCursor(state, 400, 688);
    resolveCursorIntent(
      state,
      SECOND,
      { ...STILL, left: true, right: true },
      noCues(),
    );
    expect(state.cursor.x).toBe(400);
  });

  it("rests exactly on the bound a movement is held against", () => {
    const state = playingState();
    placeCursor(state, CURSOR_X_MAX - 120, 688);
    resolveCursorIntent(state, SECOND, { ...STILL, right: true }, noCues());
    expect(state.cursor.x).toBe(CURSOR_X_MAX);
  });
});

describe("firing", () => {
  it("places a bolt above the cursor and starts the cooldown", () => {
    const state = playingState();
    placeCursor(state, 500, 688);
    const cues = noCues();
    resolveCursorIntent(state, 1 / 60, { ...STILL, fire: true }, cues);
    expect(state.bolts).toHaveLength(1);
    expect(state.bolts[0].x).toBe(500);
    expect(state.bolts[0].y).toBe(688 - CURSOR_HALF);
    expect(state.fireCooldown).toBe(FIRE_INTERVAL);
    expect(cues.fire).toBe(true);
  });

  it("fires nothing while the cooldown is still running", () => {
    const state = playingState();
    state.fireCooldown = FIRE_INTERVAL / 2;
    resolveCursorIntent(state, 1 / 60, { ...STILL, fire: true }, noCues());
    expect(state.bolts).toHaveLength(0);
  });

  it("stops at the cap of bolts in flight", () => {
    const state = playingState();
    for (let shot = 0; shot < MAX_BOLTS + 2; shot += 1) {
      state.fireCooldown = 0;
      resolveCursorIntent(state, 1 / 60, { ...STILL, fire: true }, noCues());
    }
    expect(state.bolts).toHaveLength(MAX_BOLTS);
  });
});

describe("the contact test", () => {
  it("is reached by a worm segment whose tile overlaps the cursor's box", () => {
    const state = playingState();
    placeCursor(state, tileCX(9), CURSOR_Y_MAX);
    poseWorm(state, 9, 19);
    expect(cursorTouched(state)).toBe(true);
  });

  it("is reached by a foe whose box overlaps the cursor's", () => {
    const state = playingState();
    placeCursor(state, tileCX(9), CURSOR_Y_MAX);
    const foe = poseFoe(state, "glitch", 9, 19);
    expect(cursorTouched(state)).toBe(true);
    foe.x += 40;
    expect(cursorTouched(state)).toBe(false);
  });

  it("is not reached by what stands away from it", () => {
    const state = playingState();
    placeCursor(state, tileCX(2), CURSOR_Y_MIN);
    poseWorm(state, 20, 4);
    poseFoe(state, "dropper", 30, 3);
    expect(cursorTouched(state)).toBe(false);
  });
});
