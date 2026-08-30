// The camera, the camp, the screens, and how an expedition ends
// (specs/world.md, specs/ui.md, specs/modes.md, specs/rocket.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILDING_GAP,
  CAM_LEAD_MAX,
  CAM_LEAD_RAMP,
  CAM_STILL_SPEED,
  CAM_UNWIND_MULT,
  CAVE_MOUTH_COL,
  METERS_PER_ROW,
  MINER_H,
  MINER_W,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  ROCKET_TOTAL_CREDITS,
  ROCKET_COMPONENTS,
  SPAWN_COL,
  SURFACE_Y,
  TILE,
  VIEW_H,
  WORLD_SIZES,
} from "./constants";
import { buildings, nearbyBuilding } from "./flow";
import { depthMeters } from "./figures";
import { writeTile } from "./state";
import {
  bareState,
  createHarness,
  holding,
  inDraft,
  installStorage,
  openScene,
  placeAt,
  posedAt,
  runFrames,
  standOn,
  type Harness,
} from "./test-support";
import {
  coreDepthMetersFor,
  coreRowFor,
  depthFraction,
  bandAtFraction,
} from "./tuning";
import { colCenterX, makeTile } from "./world";

/** A state falling at a fixed speed, with the body pinned so it keeps it. */
function travellingAt(vy: number): ReturnType<typeof bareState> {
  return holding(
    inDraft(bareState(), (d) => {
      posedAt(d, colCenterX(8, MINER_W), 200 * TILE);
      d.miner.vy = vy;
      d.miner.travel = false;
      d.miner.drill = false;
      d.camLead = 0;
    }),
    {},
  );
}

describe("the camera's lead", () => {
  it("builds toward CAM_LEAD_MAX over CAM_LEAD_RAMP seconds of travel", () => {
    const run = runFrames(travellingAt(600), CAM_LEAD_RAMP, 120);
    expect(run.state.camLead).toBeCloseTo(CAM_LEAD_MAX, 3);
    const half = runFrames(travellingAt(600), CAM_LEAD_RAMP / 2, 60);
    expect(half.state.camLead).toBeCloseTo(CAM_LEAD_MAX / 2, 3);
  });

  it("leads the other way on a climb", () => {
    const run = runFrames(travellingAt(-600), CAM_LEAD_RAMP, 120);
    expect(run.state.camLead).toBeCloseTo(-CAM_LEAD_MAX, 3);
  });

  it("is driven by time rather than by speed", () => {
    const slow = runFrames(travellingAt(CAM_STILL_SPEED + 1), 1, 60);
    const fast = runFrames(travellingAt(1500), 1, 60);
    expect(slow.state.camLead).toBeCloseTo(fast.state.camLead, 3);
  });

  it("unwinds toward zero at CAM_UNWIND_MULT times the ramp rate", () => {
    const carried = inDraft(travellingAt(0), (d) => {
      d.camLead = CAM_LEAD_MAX;
    });
    const span = CAM_LEAD_RAMP / CAM_UNWIND_MULT;
    const run = runFrames(holding(carried, {}), span, 60);
    expect(run.state.camLead).toBeCloseTo(0, 3);
  });

  it("holds the lead at zero while the miner counts as still", () => {
    const run = runFrames(travellingAt(CAM_STILL_SPEED), 1, 60);
    expect(run.state.camLead).toBe(0);
  });

  it("stops the view at the bottom of the Core chamber", () => {
    const state = inDraft(bareState(), (d) => {
      posedAt(d, colCenterX(8, MINER_W), (d.coreRow - 1) * TILE);
      d.camLead = CAM_LEAD_MAX;
    });
    const run = runFrames(holding(state, {}), 0.5, 30);
    expect(run.state.camY).toBeLessThanOrEqual(
      (run.state.coreRow + 1) * TILE - VIEW_H + 0.001,
    );
  });

  it("follows the miner up into the open sky with no upper clamp", () => {
    const state = inDraft(bareState(), (d) => {
      posedAt(d, colCenterX(8, MINER_W), -20 * TILE);
      d.miner.travel = false;
    });
    const run = runFrames(holding(state, {}), 0.2, 10);
    expect(run.state.camY).toBeLessThan(0);
  });
});

describe("the surface camp", () => {
  it("stands six buildings on the ground line, clear of each other", () => {
    const boxes = buildings();
    expect(boxes).toHaveLength(6);
    for (const box of boxes) {
      expect(box.y + box.h).toBe(SURFACE_Y);
    }
    const sorted = [...boxes].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w);
      expect(gap).toBeGreaterThanOrEqual(BUILDING_GAP);
    }
    for (const box of boxes) {
      // Inside the playable columns, and clear of the cell the camp leads down
      // through.
      expect(box.x).toBeGreaterThanOrEqual(PLAYABLE_COL_MIN * TILE);
      expect(box.x + box.w).toBeLessThanOrEqual((PLAYABLE_COL_MAX + 1) * TILE);
      const overlapsMouth =
        box.x < (CAVE_MOUTH_COL + 1) * TILE &&
        box.x + box.w > CAVE_MOUTH_COL * TILE &&
        box.y < 2 * TILE &&
        box.y + box.h > TILE;
      expect(overlapsMouth).toBe(false);
    }
  });

  it("names the building the miner is standing at, and none away from one", () => {
    const boxes = buildings();
    const depot = boxes.find((box) => box.id === "fuel-depot");
    expect(depot).toBeDefined();
    if (!depot) return;
    const at = inDraft(bareState(), (d) => {
      posedAt(d, depot.x + depot.w / 2 - MINER_W / 2, SURFACE_Y - MINER_H);
    });
    expect(nearbyBuilding(at.miner)).toBe("fuel-depot");
    const below = inDraft(at, (d) => {
      posedAt(d, d.miner.x, 40 * TILE);
    });
    expect(nearbyBuilding(below.miner)).toBeNull();
  });

  it("spawns the miner standing on the camp ground at SPAWN_COL", () => {
    const state = bareState();
    expect(state.miner.x).toBe(colCenterX(SPAWN_COL, MINER_W));
    expect(state.miner.y + MINER_H).toBe(SURFACE_Y);
  });
});

describe("depth", () => {
  it("reads METERS_PER_ROW per row below the ground line", () => {
    const state = inDraft(bareState(), (d) => {
      posedAt(d, 4 * TILE, 11 * TILE - MINER_H);
    });
    expect(depthMeters(state.miner)).toBeCloseTo(10 * METERS_PER_ROW, 6);
  });

  it("never reads below zero above the ground line", () => {
    const state = inDraft(bareState(), (d) => {
      posedAt(d, 4 * TILE, -5 * TILE);
    });
    expect(depthMeters(state.miner)).toBe(0);
  });
});

describe("world size", () => {
  it("scales only the Core's row", () => {
    expect(coreRowFor("quick")).toBe(250);
    expect(coreRowFor("standard")).toBe(500);
    expect(coreRowFor("marathon")).toBe(1000);
  });

  it("keeps the depth fraction identical in shape at every size", () => {
    for (const size of WORLD_SIZES) {
      const core = coreRowFor(size);
      expect(depthFraction(1, core)).toBe(0);
      expect(depthFraction(core, core)).toBe(1);
      // The deepest minable row sits one row above the Core chamber.
      expect(depthFraction(core - 1, core)).toBeCloseTo(1, 1);
      // The four bands are equal quarters of the descent at every size.
      expect(bandAtFraction(depthFraction(1, core))).toBe("topsoil");
      expect(bandAtFraction(depthFraction(Math.round(core * 0.3), core))).toBe(
        "rockbed",
      );
      expect(bandAtFraction(depthFraction(Math.round(core * 0.6), core))).toBe(
        "deepstone",
      );
      expect(bandAtFraction(depthFraction(Math.round(core * 0.9), core))).toBe(
        "coreshell",
      );
    }
  });

  it("states each size's Core depth the way the size menu reads it", () => {
    expect(coreDepthMetersFor("quick")).toBe(1250);
    expect(coreDepthMetersFor("standard")).toBe(2500);
    expect(coreDepthMetersFor("marathon")).toBe(5000);
  });
});

describe("the rocket", () => {
  it("sums the five components to ROCKET_TOTAL_CREDITS", () => {
    const total = ROCKET_COMPONENTS.reduce(
      (sum, component) => sum + component.credits,
      0,
    );
    expect(total).toBe(ROCKET_TOTAL_CREDITS);
  });
});

describe("through the engine", () => {
  let h: Harness;

  beforeEach(async () => {
    installStorage();
    h = await createHarness();
    h.pose((debug, state) => debug.reset(state));
  });

  afterEach(() => {
    h.dispose();
  });

  it("walks the title menu with the keyboard and starts an expedition", async () => {
    // A fresh reset leaves no save, so the menu leads with NEW EXPEDITION.
    h.tap("down");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).menuIndex).toBe(1);
    h.tap("up");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).menuIndex).toBe(0);
    h.tap("activate");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).screen).toBe("mode-select");
    h.tap("activate");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).screen).toBe("size-select");
    h.tap("activate");
    await h.advance(1);
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.screen).toBe("in-mine");
    expect(snapshot.mode).toBe("standard");
    expect(snapshot.worldSize).toBe("quick");
  });

  it("wraps the menu at both ends", async () => {
    h.tap("up");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).menuIndex).toBe(1);
  });

  it("goes back from the mode screen with pause", async () => {
    h.pose((debug, state) => debug.setScreen(state, "mode-select"));
    h.tap("pause");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).screen).toBe("title");
  });

  it("pauses the mine and freezes it", async () => {
    openScene(h);
    placeAt(h, 8 * TILE, 200 * TILE);
    h.tap("pause");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).screen).toBe("paused");
    const frozen = h.debug.snapshot(h.state).miner.y;
    await h.seconds(1);
    expect(h.debug.snapshot(h.state).miner.y).toBe(frozen);
    h.tap("pause");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).screen).toBe("in-mine");
  });

  it("opens a building's panel by standing at it and pressing activate", async () => {
    openScene(h);
    const depot = buildings().find((box) => box.id === "fuel-depot");
    expect(depot).toBeDefined();
    if (!depot) return;
    placeAt(h, depot.x + depot.w / 2 - MINER_W / 2, SURFACE_Y - MINER_H);
    h.tap("activate");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).panel).toBe("fuel-depot");
    h.tap("pause");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).panel).toBeNull();
  });

  it("opens the inventory anywhere, and closes it again", async () => {
    openScene(h);
    placeAt(h, 8 * TILE, 300 * TILE);
    h.tap("inventory");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).panel).toBe("inventory");
    h.tap("inventory");
    await h.advance(1);
    expect(h.debug.snapshot(h.state).panel).toBeNull();
  });

  it("takes the Victory screen once the launch has played out", async () => {
    openScene(h);
    standOn(h, 4, 1);
    h.pose((debug, state) => debug.setRocketInstalled(state, 5));
    h.pose((debug, state) => debug.launch(state));
    await h.seconds(4);
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.screen).toBe("victory");
    expect(snapshot.summary?.componentsInstalled).toBe(5);
    expect(snapshot.summary?.deathCause).toBeNull();
  });

  it("ends at Game Over when the fuel runs out below the ground line", async () => {
    openScene(h);
    placeAt(h, 8 * TILE, 200 * TILE);
    h.pose((debug, state) => debug.setFuel(state, 0));
    await h.seconds(2);
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.screen).toBe("game-over");
    expect(snapshot.summary?.deathCause).toBe("fuel-out");
  });

  it("ends at Game Over when the hull stands at zero", async () => {
    openScene(h);
    placeAt(h, 8 * TILE, 200 * TILE);
    h.pose((debug, state) => debug.setHull(state, 0));
    await h.seconds(2);
    expect(h.debug.snapshot(h.state).summary?.deathCause).toBe(
      "hull-destroyed",
    );
  });

  it("records the deepest depth reached, not the depth at the end", async () => {
    openScene(h);
    placeAt(h, 8 * TILE, 300 * TILE);
    await h.seconds(0.2);
    const deep = h.debug.snapshot(h.state).deepestDepthMeters;
    placeAt(h, 8 * TILE, 10 * TILE);
    await h.seconds(0.2);
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.deepestDepthMeters).toBeCloseTo(deep, 5);
    expect(snapshot.depthMeters).toBeLessThan(deep);
  });

  it("dismisses the hazard notice with a click on the card", async () => {
    openScene(h);
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 8 * TILE, 200 * TILE),
    );
    h.pose((debug, state) => debug.setMinerTravel(state, false));
    h.pose((debug, state) => debug.setTile(state, 8, 202, "lava"));
    h.pose((debug, state) =>
      debug.setMinerPosition(state, 8 * TILE, 202 * TILE - MINER_H + 4),
    );
    await h.seconds(2);
    expect(h.debug.snapshot(h.state).notice?.shown).toBe(true);
    h.click(640, 640);
    await h.advance(1);
    expect(h.debug.snapshot(h.state).notice).toBeNull();
  });
});

describe("what a reset restores", () => {
  it("leaves an empty mine, with the border, the camp, and the Core standing", () => {
    const state = inDraft(bareState(), (d) => {
      d.grid = writeTile(d.grid, 5, 200, makeTile("rock", "rockbed"));
    });
    expect(state.grid[200][5].kind).toBe("rock");
    const fresh = bareState();
    expect(fresh.grid[200][5].kind).toBe("tunnel");
    expect(fresh.grid[200][0].kind).toBe("bedrock");
    expect(fresh.grid[fresh.coreRow][16].kind).toBe("core");
  });
});
