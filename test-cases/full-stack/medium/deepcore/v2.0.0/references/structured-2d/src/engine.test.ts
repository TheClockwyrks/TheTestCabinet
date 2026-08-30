// Deepcore under the engine, in process: does it boot, run, and pose.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAM_LEAD_MAX,
  DEEPCORE_DEBUG_VERSION,
  HUD_H,
  MINER_H,
  MINER_W,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  STAGE_H,
  SURFACE_Y,
  TILE,
  VIEW_H,
  VIEW_W,
  WORLD_COLS,
} from "./constants";
import { deepcoreState, DeepcoreState } from "./game";
import { Mine } from "./mine";
import { Prospector } from "./prospector";
import {
  createHarness,
  installStorage,
  standOn,
  type Harness,
} from "./test-support";

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  h.debug.reset();
});

afterEach(() => {
  h.dispose();
});

describe("initialization", () => {
  it("returns the debug surface beside the state", () => {
    expect(h.debug.version).toBe(DEEPCORE_DEBUG_VERSION);
  });

  it("opens on the title screen with nothing in progress", () => {
    const snapshot = h.debug.snapshot();
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
    const { miner } = h.debug.snapshot();
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
    expect(h.debug.snapshot().simTime).toBeCloseTo(1, 2);
  });

  it("reaches the same state however the interval was divided", async () => {
    const scene = async (frames: number, perFrame: number): Promise<number> => {
      const one = await createHarness();
      one.debug.reset();
      one.debug.clearMine();
      one.debug.setScreen("in-mine");
      one.debug.setMinerPosition(SPAWN_COL * TILE, SURFACE_Y);
      for (let i = 0; i < frames; i += 1) await one.advance(perFrame);
      const y = one.debug.snapshot().miner.y;
      one.dispose();
      return y;
    };
    const coarse = await scene(6, 5);
    const fine = await scene(30, 1);
    expect(coarse).toBeCloseTo(fine, 0);
  });

  it("draws without touching the state", async () => {
    h.debug.setScreen("in-mine");
    const before = h.debug.snapshot();
    await h.advance(0);
    expect(h.debug.snapshot()).toEqual(before);
  });
});

describe("the camera", () => {
  it("centers the miner horizontally, clamped to the world", () => {
    h.debug.clearMine();
    h.debug.setScreen("in-mine");
    h.debug.setMinerPosition(16 * TILE, 40 * TILE);
    h.debug.setCameraLead(0);
    const snapshot = h.debug.snapshot();
    expect(snapshot.camera.x).toBeCloseTo(16 * TILE + 28 - VIEW_W / 2, 0);
  });

  it("never scrolls past the bedrock border", () => {
    h.debug.clearMine();
    h.debug.setMinerPosition(PLAYABLE_COL_MIN * TILE, 40 * TILE);
    h.debug.setCameraLead(0);
    expect(h.debug.snapshot().camera.x).toBe(0);
    h.debug.setMinerPosition((WORLD_COLS - 2) * TILE, 40 * TILE);
    h.debug.setCameraLead(0);
    expect(h.debug.snapshot().camera.x).toBeCloseTo(
      WORLD_COLS * TILE - VIEW_W,
      6,
    );
  });

  it("carries the lead the pose gave it", () => {
    h.debug.clearMine();
    h.debug.setMinerPosition(8 * TILE, 40 * TILE);
    h.debug.setCameraLead(CAM_LEAD_MAX);
    const snapshot = h.debug.snapshot();
    expect(snapshot.camera.lead).toBe(CAM_LEAD_MAX);
    expect(snapshot.camera.y).toBeCloseTo(
      40 * TILE + MINER_H / 2 - VIEW_H / 2 + CAM_LEAD_MAX,
      0,
    );
  });

  it("refuses a lead outside its range", () => {
    expect(() => h.debug.setCameraLead(CAM_LEAD_MAX + 1)).toThrow(RangeError);
  });
});

describe("the world the engine built", () => {
  it("holds the game's own state, at the level the definition names", () => {
    expect(h.engine.world.level).toBe("mine");
    expect(h.engine.world.state).toBeInstanceOf(DeepcoreState);
    expect(deepcoreState(h.engine.world)).toBe(h.engine.world.state);
  });

  it("places the mine and adds one player possessing the prospector", () => {
    expect(h.engine.world.find(Mine)).not.toBeNull();
    const players = h.engine.world.players();
    expect(players).toHaveLength(1);
    expect(players[0].pawn).toBeInstanceOf(Prospector);
  });

  it("moves the prospector with the miner the simulation settled", async () => {
    h.debug.clearMine();
    h.debug.setScreen("in-mine");
    h.debug.setMinerPosition(9 * TILE, 44 * TILE);
    await h.advance(2);
    const pawn = h.engine.world.find(Prospector);
    const { miner } = h.debug.snapshot();
    expect(pawn?.transform.x).toBeCloseTo(miner.x, 6);
    expect(pawn?.transform.y).toBeCloseTo(miner.y, 6);
  });

  it("leaves the match phase alone, because the screens are the game's own", () => {
    expect(h.engine.world.state.phase).toBe("waiting");
    expect(h.engine.world.state.elapsed).toBe(0);
  });
});

describe("the engine's camera", () => {
  it("draws the world point the game asked for at the viewport's corner", () => {
    h.debug.clearMine();
    h.debug.setScreen("in-mine");
    h.debug.setMinerPosition(12 * TILE, 60 * TILE);
    h.debug.setCameraLead(0);
    const { camera } = h.debug.snapshot();
    const at = h.engine.world.camera.worldToLogical({
      x: camera.x,
      y: camera.y,
    });
    expect(at.x).toBeCloseTo(0, 6);
    expect(at.y).toBeCloseTo(HUD_H, 6);
  });

  it("is left at a zoom of one and no rotation, so a world unit is a stage unit", () => {
    const { zoom, rotation } = h.engine.world.camera.snapshot();
    expect(zoom).toBe(1);
    expect(rotation).toBe(0);
  });

  it("scrolls the mine by moving the camera rather than the world", async () => {
    h.debug.clearMine();
    h.debug.setScreen("in-mine");
    h.debug.setMinerPosition(4 * TILE, 40 * TILE);
    h.debug.setCameraLead(0);
    await h.advance(1);
    const first = h.engine.world.camera.snapshot().x;
    const mine = h.engine.world.find(Mine);
    const before = mine?.transform.x;
    h.debug.setMinerPosition(20 * TILE, 40 * TILE);
    await h.advance(1);
    expect(h.engine.world.camera.snapshot().x).toBeGreaterThan(first);
    expect(mine?.transform.x).toBe(before);
  });
});

describe("rendering", () => {
  it("fills the whole stage", async () => {
    h.debug.setScreen("in-mine");
    await h.advance(1);
    const corner = h.ctx.getImageData(1, STAGE_H - 2, 1, 1).data;
    expect(corner[3]).toBe(255);
  });

  it("draws the status bar over the mine rather than under it", async () => {
    h.debug.clearMine();
    h.debug.setScreen("in-mine");
    standOn(h, 8, 60);
    await h.advance(1);
    // A pixel inside the status bar and one just below it, in the mine.
    const bar = h.pixel(640, HUD_H / 2);
    const mine = h.pixel(640, HUD_H + 40);
    expect(bar).not.toEqual(mine);
  });

  it("draws the miner over the rock it is standing in", async () => {
    h.debug.clearMine();
    h.debug.setScreen("in-mine");
    for (let row = 58; row <= 62; row += 1) {
      for (let col = 6; col <= 10; col += 1) h.debug.setTile(col, row, "rock");
    }
    h.debug.setTile(8, 60, "tunnel");
    standOn(h, 8, 61);
    h.debug.setCameraLead(0);
    await h.advance(1);
    const { miner, camera } = h.debug.snapshot();
    // The middle of the miner's box, in logical stage units.
    const x = miner.x + MINER_W / 2 - camera.x;
    const y = miner.y + MINER_H / 2 - camera.y + HUD_H;
    const onMiner = h.pixel(x, y);
    const onRock = h.pixel(x, y + TILE);
    expect(onMiner).not.toEqual(onRock);
  });
});
