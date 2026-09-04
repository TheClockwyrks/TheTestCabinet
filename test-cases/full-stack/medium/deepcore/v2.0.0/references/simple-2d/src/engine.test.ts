// Deepcore under the engine, in process: does it boot, run, and pose.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAM_LEAD_MAX,
  DEEPCORE_DEBUG_VERSION,
  MINER_H,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  STAGE_H,
  SURFACE_Y,
  TILE,
  VIEW_H,
  VIEW_W,
  WORLD_COLS,
} from "./constants";
import { createHarness, installStorage, type Harness } from "./test-support";

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  h.pose((debug, state) => debug.reset(state));
});

afterEach(() => {
  h.dispose();
});

describe("initialization", () => {
  it("returns the debug surface beside the state", () => {
    expect(h.debug.version).toBe(DEEPCORE_DEBUG_VERSION);
  });

  it("opens on the title screen with nothing in progress", () => {
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.credits).toBe(0);
    expect(snapshot.coreTimer).toBeNull();
    expect(snapshot.summary).toBeNull();
    expect(snapshot.miner.travel).toBe(true);
    expect(snapshot.miner.drill).toBe(true);
    expect(snapshot.simTime).toBe(0);
  });

  it("stands the miner on the camp ground at the spawn column", () => {
    const { miner } = h.debug.snapshot(h.state);
    expect(miner.col).toBe(SPAWN_COL);
    expect(miner.y).toBeCloseTo(SURFACE_Y - MINER_H, 6);
    expect(miner.facing).toBe("east");
    expect(miner.vx).toBe(0);
    expect(miner.vy).toBe(0);
  });
});

describe("the frame", () => {
  it("accumulates game time on every screen", async () => {
    await h.seconds(1);
    expect(h.debug.snapshot(h.state).simTime).toBeCloseTo(1, 2);
  });

  it("reaches the same state however the interval was divided", async () => {
    const scene = async (frames: number, perFrame: number): Promise<number> => {
      const one = await createHarness();
      one.pose((debug, state) => debug.reset(state));
      one.pose((debug, state) => debug.clearMine(state));
      one.pose((debug, state) => debug.setScreen(state, "in-mine"));
      one.pose((debug, state) =>
        debug.setMinerPosition(state, SPAWN_COL * TILE, SURFACE_Y),
      );
      for (let i = 0; i < frames; i += 1) await one.advance(perFrame);
      const y = one.debug.snapshot(one.state).miner.y;
      one.dispose();
      return y;
    };
    const coarse = await scene(6, 5);
    const fine = await scene(30, 1);
    expect(coarse).toBeCloseTo(fine, 0);
  });

  it("draws without touching the state", async () => {
    h.pose((debug, state) => debug.setScreen(state, "in-mine"));
    const before = h.debug.snapshot(h.state);
    await h.advance(0);
    expect(h.debug.snapshot(h.state)).toEqual(before);
  });
});

describe("the camera", () => {
  it("centers the miner horizontally, clamped to the world", () => {
    h.pose((debug, state) => debug.clearMine(state));
    h.pose((debug, state) => debug.setScreen(state, "in-mine"));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 16 * TILE, 40 * TILE),
    );
    h.pose((debug, state) => debug.setCameraLead(state, 0));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.camera.x).toBeCloseTo(16 * TILE + 28 - VIEW_W / 2, 0);
  });

  it("never scrolls past the bedrock border", () => {
    h.pose((debug, state) => debug.clearMine(state));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, PLAYABLE_COL_MIN * TILE, 40 * TILE),
    );
    h.pose((debug, state) => debug.setCameraLead(state, 0));
    expect(h.debug.snapshot(h.state).camera.x).toBe(0);
    h.pose((debug, state) =>
      debug.setMinerPosition(state, (WORLD_COLS - 2) * TILE, 40 * TILE),
    );
    h.pose((debug, state) => debug.setCameraLead(state, 0));
    expect(h.debug.snapshot(h.state).camera.x).toBeCloseTo(
      WORLD_COLS * TILE - VIEW_W,
      6,
    );
  });

  it("carries the lead the pose gave it", () => {
    h.pose((debug, state) => debug.clearMine(state));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 8 * TILE, 40 * TILE),
    );
    h.pose((debug, state) => debug.setCameraLead(state, CAM_LEAD_MAX));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.camera.lead).toBe(CAM_LEAD_MAX);
    expect(snapshot.camera.y).toBeCloseTo(
      40 * TILE + MINER_H / 2 - VIEW_H / 2 + CAM_LEAD_MAX,
      0,
    );
  });

  it("refuses a lead outside its range", () => {
    expect(() =>
      h.pose((debug, state) => debug.setCameraLead(state, CAM_LEAD_MAX + 1)),
    ).toThrow(RangeError);
  });
});

describe("rendering", () => {
  it("fills the whole stage", async () => {
    h.pose((debug, state) => debug.setScreen(state, "in-mine"));
    await h.advance(1);
    const corner = h.ctx.getImageData(1, STAGE_H - 2, 1, 1).data;
    expect(corner[3]).toBe(255);
  });
});
