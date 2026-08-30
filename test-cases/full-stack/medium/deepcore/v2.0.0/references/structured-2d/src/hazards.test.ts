// Gas, lava, impact, and the unstable Core Sample (specs/hazards.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CORE_BLAST_TILES,
  CORE_TIMER,
  GAS_BLAST_TILES,
  GAS_DAMAGE_MAX,
  GAS_DAMAGE_MIN,
  GAS_KNOCKBACK,
  IMPACT_DAMAGE_RATE,
  IMPACT_SAFE_SPEED,
  LAVA_CONTACT_DPS,
  LAVA_DRILL_CORESHELL,
  LAVA_DRILL_DEEPSTONE,
  MINER_H,
  MINER_W,
  NOTICE_DELAY,
  NOTICE_FADE,
  RADIATOR_TIERS,
  TILE,
} from "./constants";
import { maxHull } from "./figures";
import { detonateGas, landImpact } from "./hazards";
import { writeTile } from "./state";
import { makeTile } from "./world";
import {
  bareState,
  createHarness,
  posing,
  installStorage,
  openScene,
  placeAt,
  posedAt,
  standOn,
  type Harness,
} from "./test-support";
import { depthFraction, gasDamageAt } from "./tuning";

const DEEPSTONE = 300;
const CORESHELL = 450;
const GAS_ROW = 250;

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  openScene(h);
});

afterEach(() => {
  h.dispose();
});

/** A miner with the deepest hull, so a blast leaves it alive to read. */
function toughen(): void {
  h.debug.setTier("hull", 5);
  h.debug.setHull(maxHull(h.state.tiers));
}

/**
 * Break a posed gas pocket with the drill, which is the one path a detonation
 * takes in play.
 */
async function drillIntoGas(col: number, row: number): Promise<void> {
  h.debug.setTile(col, row, "gas");
  h.debug.setTile(col, row + 1, "rock");
  standOn(h, col, row);
  h.debug.setFuel(100);
  h.debug.setTier("drill", 5);
  h.hold("down");
  await h.seconds(1);
  h.release("down");
}

describe("gas", () => {
  it("deals GAS_DAMAGE_MIN where it first appears and GAS_DAMAGE_MAX at the bottom", () => {
    expect(gasDamageAt(0.25)).toBeCloseTo(GAS_DAMAGE_MIN, 6);
    expect(gasDamageAt(1)).toBeCloseTo(GAS_DAMAGE_MAX, 6);
    expect(gasDamageAt(0.625)).toBeCloseTo(
      (GAS_DAMAGE_MIN + GAS_DAMAGE_MAX) / 2,
      6,
    );
  });

  it("hits a miner standing over the pocket and clears the cell", async () => {
    toughen();
    const before = h.debug.snapshot().miner.hull;
    await drillIntoGas(6, GAS_ROW);
    const snapshot = h.debug.snapshot();
    expect(h.debug.tileAt(6, GAS_ROW).kind).toBe("tunnel");
    expect(snapshot.miner.hull).toBeLessThan(before);
  });

  it("hits a miner one tile from the pocket for the depth's damage", () => {
    const posed = posing(bareState(), (d) => {
      d.tiers.hull = 5;
      d.miner.hull = maxHull(d.tiers);
      d.grid = writeTile(d.grid, 6, GAS_ROW, makeTile("gas", "deepstone"));
      // The miner's center one tile above the pocket's center.
      posedAt(
        d,
        6 * TILE + (TILE - MINER_W) / 2,
        GAS_ROW * TILE - TILE / 2 - MINER_H / 2,
      );
    });
    const before = posed.miner.hull;
    const after = posing(posed, (d) => detonateGas(d, 6, GAS_ROW));
    expect(after.grid[GAS_ROW][6].kind).toBe("tunnel");
    expect(before - after.miner.hull).toBeCloseTo(
      gasDamageAt(depthFraction(GAS_ROW, after.coreRow)),
      4,
    );
  });

  it("leaves a miner beyond GAS_BLAST_TILES untouched", () => {
    const posed = posing(bareState(), (d) => {
      d.grid = writeTile(d.grid, 6, GAS_ROW, makeTile("gas", "deepstone"));
      posedAt(d, 6 * TILE, (GAS_ROW - GAS_BLAST_TILES - 1) * TILE);
    });
    const before = posed.miner.hull;
    const after = posing(posed, (d) => detonateGas(d, 6, GAS_ROW));
    expect(after.miner.hull).toBe(before);
    expect(after.miner.vx).toBe(0);
    expect(after.miner.vy).toBe(0);
  });

  it("shoves the miner directly away at GAS_KNOCKBACK", () => {
    const posed = posing(bareState(), (d) => {
      d.tiers.hull = 5;
      d.miner.hull = maxHull(d.tiers);
      d.grid = writeTile(d.grid, 6, GAS_ROW, makeTile("gas", "deepstone"));
      // Directly above the pocket, half a tile clear of it.
      posedAt(
        d,
        6 * TILE + (TILE - MINER_W) / 2,
        GAS_ROW * TILE - TILE - MINER_H / 2,
      );
    });
    const after = posing(posed, (d) => detonateGas(d, 6, GAS_ROW));
    expect(Math.hypot(after.miner.vx, after.miner.vy)).toBeCloseTo(
      GAS_KNOCKBACK,
      3,
    );
    expect(after.miner.vy).toBeLessThan(0);
  });

  it("is reduced by nothing, the radiator included", () => {
    const posed = posing(bareState(), (d) => {
      d.tiers.hull = 5;
      d.tiers.radiator = 5;
      d.miner.hull = maxHull(d.tiers);
      d.grid = writeTile(d.grid, 6, GAS_ROW, makeTile("gas", "deepstone"));
      posedAt(
        d,
        6 * TILE + (TILE - MINER_W) / 2,
        GAS_ROW * TILE - TILE / 2 - MINER_H / 2,
      );
    });
    const before = posed.miner.hull;
    const after = posing(posed, (d) => detonateGas(d, 6, GAS_ROW));
    expect(before - after.miner.hull).toBeCloseTo(
      gasDamageAt(depthFraction(GAS_ROW, after.coreRow)),
      4,
    );
  });
});

describe("lava", () => {
  /** Sink the miner's box a little into a posed lava cell. */
  function stand_in_lava(row: number): void {
    h.debug.setTile(5, row, "lava");
    standOn(h, 5, row);
    h.debug.setMinerPosition(
      5 * TILE + (TILE - MINER_W) / 2,
      row * TILE - MINER_H + 4,
    );
    h.debug.setMinerTravel(false);
    h.debug.setMinerDrill(false);
  }

  it("drains LAVA_CONTACT_DPS per second on contact", async () => {
    toughen();
    stand_in_lava(DEEPSTONE);
    const before = h.debug.snapshot().miner.hull;
    await h.seconds(1);
    expect(before - h.debug.snapshot().miner.hull).toBeCloseTo(
      LAVA_CONTACT_DPS,
      2,
    );
  });

  it("cuts the contact drain by the radiator's effectiveness", async () => {
    toughen();
    h.debug.setTier("radiator", 3);
    stand_in_lava(DEEPSTONE);
    const before = h.debug.snapshot().miner.hull;
    await h.seconds(1);
    expect(before - h.debug.snapshot().miner.hull).toBeCloseTo(
      LAVA_CONTACT_DPS * (1 - RADIATOR_TIERS[2]),
      2,
    );
  });

  it("burns the band's lump once when a lava cell is drilled through", async () => {
    for (const [row, lump] of [
      [DEEPSTONE, LAVA_DRILL_DEEPSTONE],
      [CORESHELL, LAVA_DRILL_CORESHELL],
    ] as const) {
      const one = await createHarness();
      openScene(one);
      one.debug.setTier("hull", 5);
      one.debug.setHull(maxHull(one.state.tiers));
      one.debug.setTier("drill", 5);
      one.debug.setTile(5, row, "lava");
      one.debug.setTile(5, row + 1, "rock");
      one.debug.setMinerPosition(
        5 * TILE + (TILE - MINER_W) / 2,
        row * TILE - MINER_H,
      );
      one.debug.setMinerVelocity(0, 0);
      one.debug.setFuel(100);
      const before = one.debug.snapshot().miner.hull;
      one.hold("down");
      await one.seconds(1);
      one.release("down");
      expect(one.debug.tileAt(5, row).kind).toBe("tunnel");
      // The cell being cut is not charged the contact drain as well, so the
      // lump is the whole of the burn.
      expect(before - one.debug.snapshot().miner.hull).toBeCloseTo(lump, 2);
      one.dispose();
    }
  });
});

describe("fall impact", () => {
  it("costs nothing at or below IMPACT_SAFE_SPEED", () => {
    const posed = bareState();
    const before = posed.miner.hull;
    const after = posing(posed, (d) => landImpact(d, IMPACT_SAFE_SPEED));
    expect(after.miner.hull).toBe(before);
  });

  it("costs IMPACT_DAMAGE_RATE per unit above it", () => {
    const posed = posing(bareState(), (d) => {
      d.tiers.hull = 5;
      d.miner.hull = maxHull(d.tiers);
    });
    const before = posed.miner.hull;
    const after = posing(posed, (d) => landImpact(d, IMPACT_SAFE_SPEED + 300));
    expect(before - after.miner.hull).toBeCloseTo(300 * IMPACT_DAMAGE_RATE, 6);
  });
});

describe("explosives", () => {
  it("clears the 3x3 block around the miner's cell", () => {
    for (let r = 199; r <= 201; r += 1) {
      for (let c = 4; c <= 6; c += 1) {
        h.debug.setTile(c, r, "rock");
      }
    }
    h.debug.setTile(4, 199, "stone");
    standOn(h, 5, 201);
    h.debug.setItemCount("dynamite", 1);
    h.debug.useItem("dynamite");
    for (let r = 199; r <= 201; r += 1) {
      for (let c = 4; c <= 6; c += 1) {
        expect(h.debug.tileAt(c, r).kind).toBe("tunnel");
      }
    }
  });

  it("leaves bedrock, a material node, and the Core standing", () => {
    h.debug.setMaterialTile(5, 200, "resonite");
    standOn(h, 5, 201);
    h.debug.setItemCount("plastic-explosives", 1);
    h.debug.useItem("plastic-explosives");
    expect(h.debug.tileAt(5, 200).kind).toBe("material");
    expect(h.debug.tileAt(0, 200).kind).toBe("bedrock");
    const core = h.debug.findTile("core");
    expect(core).not.toBeNull();
  });

  it("detonates a gas pocket caught in the block", () => {
    toughen();
    h.debug.setTile(5, 250, "gas");
    placeAt(h, 5 * TILE + (TILE - MINER_W) / 2, 251 * TILE - MINER_H);
    h.debug.setMinerTravel(false);
    h.debug.setItemCount("plastic-explosives", 1);
    const before = h.debug.snapshot().miner.hull;
    h.debug.useItem("plastic-explosives");
    expect(h.debug.tileAt(5, 250).kind).toBe("tunnel");
    expect(h.debug.snapshot().miner.hull).toBeLessThan(before);
  });
});

describe("the Core Sample", () => {
  it("kills the miner outright when it detonates in hand", async () => {
    h.debug.setCoreCarried(true);
    h.debug.setCoreTimer(0.5);
    await h.seconds(2.5);
    expect(h.debug.snapshot().summary?.deathCause).toBe("core-detonation");
  });

  it("kills a miner within CORE_BLAST_TILES of a jettisoned Sample", async () => {
    placeAt(h, 5 * TILE, 200 * TILE - TILE);
    h.debug.setMinerTravel(false);
    h.debug.placeCoreSample(5, 200);
    h.debug.setCoreTimer(0.1);
    await h.seconds(2);
    expect(h.debug.snapshot().summary?.deathCause).toBe("core-detonation");
  });

  it("leaves a miner beyond CORE_BLAST_TILES unharmed", async () => {
    placeAt(h, 5 * TILE, (200 - CORE_BLAST_TILES - 2) * TILE);
    h.debug.setMinerTravel(false);
    h.debug.placeCoreSample(5, 200);
    h.debug.setCoreTimer(0.1);
    await h.seconds(0.5);
    const snapshot = h.debug.snapshot();
    expect(snapshot.summary).toBeNull();
    expect(snapshot.coreTimer).toBeNull();
    expect(snapshot.coreGround).toBeNull();
  });

  it("runs the timer down wherever the expedition is, a panel included", async () => {
    h.debug.setCoreCarried(true);
    h.debug.setPanel("ore-market");
    await h.seconds(3);
    expect(h.debug.snapshot().coreTimer).toBeCloseTo(CORE_TIMER - 3, 2);
  });
});

describe("the one-time hazard notices", () => {
  it("raises the card after NOTICE_DELAY and fades it after NOTICE_FADE", async () => {
    toughen();
    await drillIntoGas(6, GAS_ROW);
    expect(h.debug.snapshot().notice).toEqual({
      hazard: "gas",
      shown: false,
    });
    await h.seconds(NOTICE_DELAY + 0.1);
    expect(h.debug.snapshot().notice?.shown).toBe(true);
    await h.seconds(NOTICE_FADE + 0.2);
    expect(h.debug.snapshot().notice).toBeNull();
  });

  it("fires at most once per expedition", async () => {
    toughen();
    await drillIntoGas(6, GAS_ROW);
    h.debug.dismissNotice();
    await drillIntoGas(8, GAS_ROW);
    const snapshot = h.debug.snapshot();
    expect(snapshot.notice).toBeNull();
    expect(snapshot.noticesFired.gas).toBe(true);
    expect(snapshot.noticesFired.lava).toBe(false);
  });
});
