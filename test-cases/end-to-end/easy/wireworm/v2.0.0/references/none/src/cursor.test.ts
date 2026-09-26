// Wireworm — the cursor: its band, its rate, its firing, and what reaching it
// costs (specs/cursor.md).
//
// Every probe here is sized to the band, and that sizing is load-bearing: the
// band is 32 units tall, which the cursor crosses in 0.074 s, so a vertical
// probe over any useful window measures the CLAMP rather than the rate. The rate
// is therefore read from two HORIZONTAL holds, and the diagonal from its
// horizontal component.

import { describe, expect, test } from "vitest";
import {
  CURSOR_HALF,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  CUES,
  FIRE_INTERVAL,
  MAX_BOLTS,
  RESPAWN_INVULN,
  tileCX,
  tileCY,
} from "./constants";
import { checkContact, clampCursor, moveCursor, updateFiring } from "./cursor";
import { makeFoe } from "./foes";
import { BAND_CENTER_X, BAND_CENTER_Y } from "./progression";
import {
  CueLog,
  layWorm,
  posedState,
  run,
  stubApi,
} from "./harness.test-support";
import type { WirewormState } from "./types";

/** Hold a direction for one second, in sixty frames. */
function hold(state: WirewormState, x: number, y: number): void {
  for (let i = 0; i < 60; i += 1) moveCursor(state, { x, y }, 1 / 60);
}

describe("moving in the band", () => {
  test("a held movement travels at the cursor's own rate", () => {
    for (const direction of [-1, 1]) {
      const state = posedState();
      state.cursor.x = BAND_CENTER_X;
      hold(state, direction, 0);
      expect(Math.abs(state.cursor.x - BAND_CENTER_X)).toBeCloseTo(
        CURSOR_SPEED,
        1,
      );
    }
  });

  test("a diagonal is no faster: each axis carries the rate over root two", () => {
    const state = posedState();
    state.cursor.x = BAND_CENTER_X;
    state.cursor.y = CURSOR_Y_MAX;
    hold(state, 1, -1);
    expect(state.cursor.x - BAND_CENTER_X).toBeCloseTo(
      CURSOR_SPEED / Math.SQRT2,
      1,
    );
    // The vertical component clamps out after 32 units, as the band is that tall.
    expect(state.cursor.y).toBe(CURSOR_Y_MIN);
  });

  test("opposite movements held together cancel", () => {
    const state = posedState();
    state.cursor.x = BAND_CENTER_X;
    hold(state, 0, 0);
    expect(state.cursor.x).toBe(BAND_CENTER_X);
  });

  test("the cursor rests exactly on the bound it is driven into", () => {
    const inset = 120;
    const left = posedState();
    left.cursor.x = CURSOR_X_MIN + inset;
    hold(left, -1, 0);
    expect(left.cursor.x).toBe(CURSOR_X_MIN);

    const right = posedState();
    right.cursor.x = CURSOR_X_MAX - inset;
    hold(right, 1, 0);
    expect(right.cursor.x).toBe(CURSOR_X_MAX);

    // The band cannot hold a 120-unit inset, so the vertical pair is driven from
    // the OPPOSITE bound, which is thirteen times the crossing time away.
    const up = posedState();
    up.cursor.y = CURSOR_Y_MAX;
    hold(up, 0, -1);
    expect(up.cursor.y).toBe(CURSOR_Y_MIN);

    const down = posedState();
    down.cursor.y = CURSOR_Y_MIN;
    hold(down, 0, 1);
    expect(down.cursor.y).toBe(CURSOR_Y_MAX);
  });

  test("a pose outside the band is clamped into it", () => {
    const cursor = { x: -900, y: 0, invulnerable: 0, contact: true };
    clampCursor(cursor);
    expect(cursor).toEqual({
      x: CURSOR_X_MIN,
      y: CURSOR_Y_MIN,
      invulnerable: 0,
      contact: true,
    });
    cursor.x = 9000;
    cursor.y = 9000;
    clampCursor(cursor);
    expect([cursor.x, cursor.y]).toEqual([CURSOR_X_MAX, CURSOR_Y_MAX]);
  });
});

describe("firing", () => {
  test("a bolt appears at the muzzle, in the cursor's column", () => {
    const state = posedState();
    state.cursor.x = tileCX(20);
    const cues = new CueLog();
    updateFiring(state, true, 1 / 60, cues);
    expect(state.bolts).toHaveLength(1);
    expect(state.bolts[0].x).toBe(tileCX(20));
    expect(state.cursor.y - state.bolts[0].y).toBe(CURSOR_HALF);
    expect(cues.count(CUES.fire)).toBe(1);
  });

  test("a held fire produces a bolt every fire interval", () => {
    const state = posedState();
    const cues = new CueLog();
    const seen: number[] = [];
    const frames = 70;
    for (let i = 0; i < frames; i += 1) {
      const before = state.bolts.length;
      updateFiring(state, true, 0.35 / frames, cues);
      if (state.bolts.length > before) seen.push((i * 0.35) / frames);
    }
    expect(seen).toHaveLength(3);
    expect(seen[1] - seen[0]).toBeCloseTo(FIRE_INTERVAL, 1);
    expect(seen[2] - seen[1]).toBeCloseTo(FIRE_INTERVAL, 1);
  });

  test("no more than three bolts are ever in flight", () => {
    const state = posedState();
    const cues = new CueLog();
    let most = 0;
    for (let i = 0; i < 400; i += 1) {
      updateFiring(state, true, 2 / 400, cues);
      most = Math.max(most, state.bolts.length);
    }
    expect(most).toBe(MAX_BOLTS);
  });

  test("the cooldown rests at zero and is counted down against the delta", () => {
    const state = posedState();
    state.fireCooldown = 0.1;
    updateFiring(state, false, 0.04, new CueLog());
    expect(state.fireCooldown).toBeCloseTo(0.06, 10);
    updateFiring(state, false, 1, new CueLog());
    expect(state.fireCooldown).toBe(0);
  });
});

describe("contact", () => {
  test("a worm segment reaching the cursor costs a life", () => {
    const state = posedState();
    state.cursor.contact = true;
    state.cursor.x = tileCX(20);
    state.cursor.y = tileCY(19);
    layWorm(state, [[20, 19]]);
    const cues = new CueLog();
    checkContact(state, cues);
    expect(state.lives).toBe(2);
    expect(state.phase).toBe("respawn");
    expect(cues.count(CUES.life)).toBe(1);
  });

  test("a foe reaching the cursor costs a life", () => {
    const state = posedState();
    state.cursor.contact = true;
    state.cursor.x = tileCX(20);
    state.cursor.y = tileCY(19);
    const foe = makeFoe(state, "glitch", tileCX(20), tileCY(19));
    state.foes.push(foe);
    checkContact(state, new CueLog());
    expect(state.lives).toBe(2);
  });

  test("the contact gate stops the loss without stopping anything else", () => {
    const state = posedState();
    state.cursor.contact = false;
    state.cursor.x = tileCX(20);
    state.cursor.y = tileCY(19);
    layWorm(state, [[20, 19]]);
    checkContact(state, new CueLog());
    expect(state.lives).toBe(3);
    expect(state.phase).toBe("active");
  });

  test("spawn-in invulnerability absorbs a contact", () => {
    const state = posedState();
    state.cursor.contact = true;
    state.cursor.invulnerable = RESPAWN_INVULN;
    state.cursor.x = tileCX(20);
    state.cursor.y = tileCY(19);
    layWorm(state, [[20, 19]]);
    checkContact(state, new CueLog());
    expect(state.lives).toBe(3);
    expect(state.worms).toHaveLength(1);
  });

  test("a segment a tile away does not reach the cursor", () => {
    const state = posedState();
    state.cursor.contact = true;
    state.cursor.x = tileCX(20);
    state.cursor.y = tileCY(19);
    layWorm(state, [[22, 19]]);
    checkContact(state, new CueLog());
    expect(state.lives).toBe(3);
  });

  test("the respawn puts the cursor back at the band's center", () => {
    const state = posedState();
    state.cursor.contact = true;
    state.cursor.x = CURSOR_X_MIN;
    state.cursor.y = CURSOR_Y_MIN;
    layWorm(state, [[0, 18]]);
    checkContact(state, new CueLog());
    expect([state.cursor.x, state.cursor.y]).toEqual([
      BAND_CENTER_X,
      BAND_CENTER_Y,
    ]);
  });
});

describe("through a whole frame", () => {
  test("a held movement action drives the cursor through the update", () => {
    const state = posedState();
    const cues = new CueLog();
    const api = stubApi(cues);
    state.cursor.x = BAND_CENTER_X;
    api.hold("right");
    run(state, api, cues, 0.2, 12);
    expect(state.cursor.x).toBeGreaterThan(BAND_CENTER_X);
    api.release();
    const rested = state.cursor.x;
    run(state, api, cues, 0.2, 12);
    expect(state.cursor.x).toBe(rested);
  });

  test("a held fire action puts bolts in the air through the update", () => {
    const state = posedState();
    const cues = new CueLog();
    const api = stubApi(cues);
    api.hold("a");
    run(state, api, cues, 0.05, 3);
    expect(state.bolts.length).toBeGreaterThan(0);
  });
});
