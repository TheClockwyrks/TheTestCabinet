// Wireworm — the three support foes (specs/foes.md).
//
// Each check gates the faculty it is not about: a foe posed with `travel` off is
// a scenario with no motion in it at all, so what it DOES to the tile it stands
// on is read from one tile; a foe posed with `mind` off travels without touching
// the field, so how far it went is read as a distance.

import { describe, expect, test } from "vitest";
import {
  CHARGE_MAX,
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_SPEED,
  CUES,
  DROPPER_CHECK_INTERVAL,
  DROPPER_FROM_LEVEL,
  DROPPER_SPEED,
  GLITCH_DART_INTERVAL,
  GLITCH_FROM_LEVEL,
  GLITCH_H_SPEED,
  GLITCH_MAX_INTERVAL,
  GLITCH_MAX_ON_BOARD,
  GLITCH_V_SPEED,
  SCATTER_BOTTOM_ROW,
  SCATTER_TOP_ROW,
  STAGE_H,
  STAGE_W,
  tileCX,
  tileCY,
} from "./constants";
import { chargeAt, hasNode, setCharge } from "./field";
import { makeFoe, restingVelocity, updateFoes } from "./foes";
import { CueLog, posedState } from "./harness.test-support";
import type { FoeKind, WirewormState } from "./types";

/** Add one foe of `kind` at a tile's center, with the faculties a check wants. */
function foeOn(
  state: WirewormState,
  kind: FoeKind,
  c: number,
  r: number,
  faculties: { mind?: boolean; travel?: boolean } = {},
): ReturnType<typeof makeFoe> {
  const foe = makeFoe(state, kind, tileCX(c), tileCY(r));
  foe.mind = faculties.mind ?? true;
  foe.travel = faculties.travel ?? true;
  state.foes.push(foe);
  return foe;
}

/** Run `frames` frames of foe time. */
function runFoes(
  state: WirewormState,
  seconds: number,
  frames: number,
): CueLog {
  const cues = new CueLog();
  for (let i = 0; i < frames; i += 1) updateFoes(state, seconds / frames, cues);
  return cues;
}

/**
 * Run the foes as {@link runFoes} does, holding every foe's travel off after
 * each update so a foe that entered stays on the board: what these tests read
 * is the entry, and a glitch let travel would skitter off the bottom before the
 * stretch ends.
 */
function runFoesHolding(
  state: WirewormState,
  seconds: number,
  frames: number,
): void {
  const cues = new CueLog();
  for (let i = 0; i < frames; i += 1) {
    updateFoes(state, seconds / frames, cues);
    for (const foe of state.foes) foe.travel = false;
  }
}

describe("the glitch", () => {
  test("it eats the node on its tile, whatever its charge", () => {
    for (const charge of [0, 1, 2, CHARGE_MAX]) {
      const state = posedState();
      setCharge(state.field, 9, 9, charge);
      foeOn(state, "glitch", 9, 9, { travel: false });
      runFoes(state, 0.05, 1);
      expect(hasNode(state.field, 9, 9)).toBe(false);
    }
  });

  test("eating a critical node fires no discharge", () => {
    const state = posedState();
    setCharge(state.field, 9, 9, CHARGE_MAX);
    setCharge(state.field, 11, 9, 2);
    foeOn(state, "glitch", 9, 9, { travel: false });
    const cues = runFoes(state, 0.05, 1);
    expect(chargeAt(state.field, 11, 9)).toBe(2);
    expect(state.arcs).toEqual([]);
    expect(cues.count(CUES.discharge)).toBe(0);
  });

  test("it descends at its own rate as it skitters", () => {
    const state = posedState();
    const foe = foeOn(state, "glitch", 20, 8);
    const from = foe.y;
    runFoes(state, 2, 120);
    expect(foe.y - from).toBeCloseTo(GLITCH_V_SPEED * 2, 0);
  });

  test("its horizontal direction reverses at each dart interval", () => {
    const state = posedState();
    const foe = foeOn(state, "glitch", 20, 8);
    const start = Math.sign(foe.vx);
    let reversals = 0;
    let sign = start;
    const frames = 300;
    for (let i = 0; i < frames; i += 1) {
      updateFoes(state, 3 / frames, new CueLog());
      const now = Math.sign(foe.vx);
      if (now !== sign) {
        reversals += 1;
        sign = now;
      }
    }
    // Three seconds carries nine whole dart intervals.
    expect(reversals).toBe(Math.floor(3 / GLITCH_DART_INTERVAL));
    // Each dart sweeps the same distance, so it stays near where it started.
    expect(Math.abs(foe.x - tileCX(20))).toBeLessThan(
      GLITCH_H_SPEED * GLITCH_DART_INTERVAL * 1.5,
    );
  });

  test("a side edge turns it back rather than letting it leave", () => {
    const state = posedState();
    const foe = foeOn(state, "glitch", 1, 8, { mind: false });
    foe.vx = -GLITCH_H_SPEED;
    runFoes(state, 0.5, 30);
    expect(foe.x).toBeGreaterThanOrEqual(0);
    expect(foe.vx).toBeGreaterThan(0);
  });

  test("it leaves once its center passes below the board", () => {
    const state = posedState();
    const foe = foeOn(state, "glitch", 20, 19, { mind: false });
    foe.y = STAGE_H - 4;
    runFoes(state, 0.5, 10);
    expect(state.foes).toEqual([]);
    expect(foe.y).toBeGreaterThan(STAGE_H);
  });

  test("mind off leaves the field untouched while it travels", () => {
    const state = posedState();
    for (let c = 4; c < 30; c += 1) setCharge(state.field, c, 9, 0);
    const foe = foeOn(state, "glitch", 4, 9, { mind: false });
    const from = foe.x;
    runFoes(state, 1, 60);
    expect(Math.abs(foe.x - from)).toBeGreaterThan(100);
    for (let c = 4; c < 30; c += 1)
      expect(hasNode(state.field, c, 9)).toBe(true);
  });

  test("travel off holds it on the tile it was posed on", () => {
    const state = posedState();
    const foe = foeOn(state, "glitch", 12, 9, { travel: false });
    const at: [number, number] = [foe.x, foe.y];
    runFoes(state, 1, 60);
    expect([foe.x, foe.y]).toEqual(at);
  });
});

describe("the dropper", () => {
  test("it falls straight down its column at its own rate", () => {
    const state = posedState();
    const foe = foeOn(state, "dropper", 15, 2, { mind: false });
    const from: [number, number] = [foe.x, foe.y];
    runFoes(state, 1, 60);
    expect(foe.x).toBe(from[0]);
    expect(foe.y - from[1]).toBeCloseTo(DROPPER_SPEED, 3);
  });

  test("it lays an inert node on the empty tile it stands on", () => {
    const state = posedState();
    foeOn(state, "dropper", 15, 9, { travel: false });
    runFoes(state, 0.05, 1);
    expect(chargeAt(state.field, 15, 9)).toBe(0);
  });

  test("it leaves a tile that already holds a node exactly as it was", () => {
    const state = posedState();
    setCharge(state.field, 15, 9, 2);
    foeOn(state, "dropper", 15, 9, { travel: false });
    runFoes(state, 0.05, 1);
    expect(chargeAt(state.field, 15, 9)).toBe(2);
  });

  test("it lays nothing in the entry row or in the player band", () => {
    for (const r of [0, SCATTER_TOP_ROW - 1, SCATTER_BOTTOM_ROW + 1, 19]) {
      const state = posedState();
      foeOn(state, "dropper", 15, r, { travel: false });
      runFoes(state, 0.05, 1);
      expect(hasNode(state.field, 15, r)).toBe(
        r >= SCATTER_TOP_ROW && r <= SCATTER_BOTTOM_ROW,
      );
    }
  });

  test("it leaves once its center passes below the board", () => {
    const state = posedState();
    const foe = foeOn(state, "dropper", 20, 19, { mind: false });
    foe.y = STAGE_H - 2;
    runFoes(state, 0.2, 4);
    expect(state.foes).toEqual([]);
  });
});

describe("the corruptor", () => {
  test("it crawls at its own rate and never descends", () => {
    const state = posedState();
    const foe = foeOn(state, "corruptor", 4, 3, { mind: false });
    const from: [number, number] = [foe.x, foe.y];
    runFoes(state, 3, 180);
    expect(foe.y).toBe(from[1]);
    expect(foe.x - from[0]).toBeCloseTo(CORRUPTOR_SPEED * 3, 3);
  });

  test("it slams the node it stands on straight to critical", () => {
    for (const charge of [0, 1, 2]) {
      const state = posedState();
      setCharge(state.field, 9, 3, charge);
      foeOn(state, "corruptor", 9, 3, { travel: false });
      const cues = runFoes(state, 0.05, 1);
      expect(chargeAt(state.field, 9, 3)).toBe(CHARGE_MAX);
      expect(cues.count(CUES.critical)).toBe(1);
    }
  });

  test("it lays nothing on an empty tile", () => {
    const state = posedState();
    foeOn(state, "corruptor", 9, 3, { travel: false });
    runFoes(state, 0.05, 1);
    expect(hasNode(state.field, 9, 3)).toBe(false);
  });

  test("a node already critical is not sounded again", () => {
    const state = posedState();
    setCharge(state.field, 9, 3, CHARGE_MAX);
    foeOn(state, "corruptor", 9, 3, { travel: false });
    const cues = runFoes(state, 0.5, 10);
    expect(cues.count(CUES.critical)).toBe(0);
  });

  test("it leaves once its center passes a side edge", () => {
    const state = posedState();
    const foe = foeOn(state, "corruptor", 39, 3, { mind: false });
    foe.x = STAGE_W - 2;
    runFoes(state, 0.2, 4);
    expect(state.foes).toEqual([]);
  });
});

describe("the level's own arrivals", () => {
  test("the resting velocity of each kind is its own", () => {
    expect(restingVelocity("glitch")).toEqual({
      vx: GLITCH_H_SPEED,
      vy: GLITCH_V_SPEED,
    });
    expect(restingVelocity("dropper")).toEqual({ vx: 0, vy: DROPPER_SPEED });
    expect(restingVelocity("corruptor")).toEqual({
      vx: CORRUPTOR_SPEED,
      vy: 0,
    });
  });

  test("no foe arrives while the gate is closed", () => {
    const state = posedState(GLITCH_FROM_LEVEL + 4);
    state.foeSpawning = false;
    runFoes(state, 60, 600);
    expect(state.foes).toEqual([]);
  });

  test("no glitch arrives before its level, and one arrives at it", () => {
    const early = posedState(GLITCH_FROM_LEVEL - 1);
    early.foeSpawning = true;
    runFoes(early, 60, 600);
    expect(early.foes.filter((foe) => foe.kind === "glitch")).toEqual([]);

    const live = posedState(GLITCH_FROM_LEVEL);
    live.foeSpawning = true;
    runFoesHolding(live, GLITCH_MAX_INTERVAL, 300);
    expect(live.foes.some((foe) => foe.kind === "glitch")).toBe(true);
  });

  test("a glitch enters on the board, on a row it can skitter down from", () => {
    const state = posedState(GLITCH_FROM_LEVEL);
    state.foeSpawning = true;
    runFoesHolding(state, GLITCH_MAX_INTERVAL, 300);
    const glitch = state.foes.find((foe) => foe.kind === "glitch");
    expect(glitch).toBeDefined();
    expect(glitch?.x).toBeGreaterThanOrEqual(0);
    expect(glitch?.x).toBeLessThanOrEqual(STAGE_W);
    expect(Math.abs(glitch?.vx ?? 0)).toBe(GLITCH_H_SPEED);
  });

  test("no more than two glitches share the board", () => {
    const state = posedState(5);
    state.foeSpawning = true;
    let most = 0;
    for (let i = 0; i < 1200; i += 1) {
      updateFoes(state, 0.05, new CueLog());
      // Held on the board, so the cap is what limits them rather than the exit.
      for (const foe of state.foes) foe.travel = false;
      most = Math.max(
        most,
        state.foes.filter((foe) => foe.kind === "glitch").length,
      );
    }
    expect(most).toBe(GLITCH_MAX_ON_BOARD);
  });

  test("a sparse lower field draws a dropper in, a dense one draws none", () => {
    const sparse = posedState(DROPPER_FROM_LEVEL);
    sparse.foeSpawning = true;
    runFoes(sparse, DROPPER_CHECK_INTERVAL * 2, 200);
    expect(sparse.foes.some((foe) => foe.kind === "dropper")).toBe(true);

    const dense = posedState(DROPPER_FROM_LEVEL);
    dense.foeSpawning = true;
    for (let c = 0; c < 30; c += 1) setCharge(dense.field, c, 12, 0);
    for (let i = 0; i < 200; i += 1) {
      updateFoes(dense, 10 / 200, new CueLog());
      // Re-posed each frame, because a glitch may eat one out from under it.
      for (let c = 0; c < 30; c += 1) setCharge(dense.field, c, 12, 0);
    }
    expect(dense.foes.some((foe) => foe.kind === "dropper")).toBe(false);
  });

  test("no dropper arrives before its level", () => {
    for (const level of [1, DROPPER_FROM_LEVEL - 1]) {
      const state = posedState(level);
      state.foeSpawning = true;
      runFoes(state, 10, 200);
      expect(state.foes.some((foe) => foe.kind === "dropper")).toBe(false);
    }
  });

  test("no corruptor arrives before its level, and one arrives at it", () => {
    const early = posedState(CORRUPTOR_FROM_LEVEL - 1);
    early.foeSpawning = true;
    runFoes(early, 60, 600);
    expect(early.foes.some((foe) => foe.kind === "corruptor")).toBe(false);

    const live = posedState(CORRUPTOR_FROM_LEVEL);
    live.foeSpawning = true;
    runFoes(live, CORRUPTOR_MAX_INTERVAL, 600);
    expect(live.foes.some((foe) => foe.kind === "corruptor")).toBe(true);
  });
});
