// The drill: what it cuts, what it spends, and what a broken cell yields
// (specs/character.md, specs/mining.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BAND_HEALTH,
  DRILL_DAMAGE_TIERS,
  DRILL_HIT_FUEL,
  DRILL_HIT_INTERVAL,
  LIFE_SUPPORT_BURN,
  MINER_H,
  TILE,
} from "./constants";
import { cargoCap } from "./figures";
import {
  createHarness,
  installStorage,
  openScene,
  placeAt,
  standOn,
  type Harness,
} from "./test-support";

/** A topsoil row and a rockbed row of a Standard mine. */
const TOPSOIL = 20;
const ROCKBED = 200;

/** The hits one drill-tier-1 cut takes to break a topsoil cell. */
const TOPSOIL_HITS = Math.ceil(BAND_HEALTH.topsoil / DRILL_DAMAGE_TIERS[0]);

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  openScene(h);
});

afterEach(() => {
  h.dispose();
});

/** Stand the miner on `row` at `col`, with rock underfoot and fuel in the tank. */
function bore(col: number, row: number): void {
  h.pose((debug, state) => debug.setTile(state, col, row, "rock"));
  h.pose((debug, state) => debug.setTile(state, col, row + 1, "rock"));
  standOn(h, col, row);
  h.pose((debug, state) => debug.setFuel(state, 100));
}

describe("cutting down", () => {
  it("breaks a topsoil cell in ceil(BAND_HEALTH / damage) hits", async () => {
    bore(5, TOPSOIL);
    h.hold("down");
    // One frame's grace past the final interval, so the last hit lands.
    await h.seconds(TOPSOIL_HITS * DRILL_HIT_INTERVAL + 0.02);
    h.release("down");
    expect(h.debug.tileAt(h.state, 5, TOPSOIL).kind).toBe("tunnel");
  });

  it("spends DRILL_HIT_FUEL per hit and nothing more", async () => {
    bore(5, TOPSOIL);
    const span = TOPSOIL_HITS * DRILL_HIT_INTERVAL + 0.02;
    h.hold("down");
    await h.seconds(span);
    h.release("down");
    const spent = TOPSOIL_HITS * DRILL_HIT_FUEL + LIFE_SUPPORT_BURN * span;
    expect(h.debug.snapshot(h.state).miner.fuel).toBeCloseTo(100 - spent, 2);
  });

  it("takes twice as many hits in the rockbed as in the topsoil", async () => {
    expect(BAND_HEALTH.rockbed / BAND_HEALTH.topsoil).toBe(2);
    bore(5, ROCKBED);
    h.hold("down");
    await h.seconds(TOPSOIL_HITS * DRILL_HIT_INTERVAL + 0.02);
    h.release("down");
    const read = h.debug.tileAt(h.state, 5, ROCKBED);
    expect(read.kind).toBe("rock");
    expect(read.health).toBeCloseTo(BAND_HEALTH.rockbed / 2, 3);
  });

  it("sinks the miner into the cell in proportion to the cut", async () => {
    bore(5, TOPSOIL);
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL + 2, "rock"));
    h.hold("down");
    await h.seconds(DRILL_HIT_INTERVAL * 2 + 0.01);
    h.release("down");
    const read = h.debug.tileAt(h.state, 5, TOPSOIL);
    const progress = 1 - (read.health ?? 0) / (read.maxHealth ?? 1);
    expect(progress).toBeGreaterThan(0);
    expect(h.debug.snapshot(h.state).miner.y + MINER_H).toBeCloseTo(
      TOPSOIL * TILE + progress * TILE,
      0,
    );
  });

  it("keeps a partly cut cell's health when the cut is abandoned", async () => {
    bore(5, TOPSOIL);
    h.hold("down");
    await h.seconds(DRILL_HIT_INTERVAL * 2 + 0.01);
    h.release("down");
    const partial = h.debug.tileAt(h.state, 5, TOPSOIL).health;
    expect(partial).toBeLessThan(BAND_HEALTH.topsoil);
    await h.seconds(0.5);
    expect(h.debug.tileAt(h.state, 5, TOPSOIL).health).toBe(partial);
  });
});

describe("what a cut refuses", () => {
  it("starts no cut while the miner is not grounded", async () => {
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL + 4, "rock"));
    placeAt(h, 5 * TILE + 12, TOPSOIL * TILE);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("down");
    await h.seconds(0.3);
    h.release("down");
    expect(h.debug.snapshot(h.state).miner.drilling).toBeNull();
  });

  it("never breaks unbreakable stone", async () => {
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL, "stone"));
    standOn(h, 5, TOPSOIL);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("down");
    await h.seconds(5);
    h.release("down");
    expect(h.debug.tileAt(h.state, 5, TOPSOIL).kind).toBe("stone");
    expect(h.debug.snapshot(h.state).miner.drilling).toBeNull();
  });

  it("never cuts upward", async () => {
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL, "rock"));
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL - 2, "rock"));
    standOn(h, 5, TOPSOIL);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("up");
    await h.seconds(1);
    h.release("up");
    expect(h.debug.tileAt(h.state, 5, TOPSOIL - 2).kind).toBe("rock");
  });
});

describe("the drill faculty", () => {
  it("starts no cut and spends no drill fuel while it is held", async () => {
    bore(5, TOPSOIL);
    h.pose((debug, state) => debug.setMinerDrill(state, false));
    h.hold("down");
    await h.seconds(2);
    h.release("down");
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.drilling).toBeNull();
    expect(h.debug.tileAt(h.state, 5, TOPSOIL + 1).kind).toBe("rock");
    expect(snapshot.miner.fuel).toBeCloseTo(100 - LIFE_SUPPORT_BURN * 2, 3);
  });

  it("leaves the miner walking exactly as it does with the drill running", async () => {
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL, "rock"));
    standOn(h, 5, TOPSOIL);
    h.pose((debug, state) => debug.setMinerDrill(state, false));
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("right");
    await h.seconds(0.5);
    h.release("right");
    expect(h.debug.snapshot(h.state).miner.x).toBeGreaterThan(5 * TILE + 12);
  });
});

describe("what a broken cell yields", () => {
  it("banks one unit of an ore cell into the cargo bay", async () => {
    h.pose((debug, state) => debug.setOreTile(state, 5, TOPSOIL, "ferron"));
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL + 1, "rock"));
    standOn(h, 5, TOPSOIL);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("down");
    await h.seconds(1);
    h.release("down");
    expect(h.debug.snapshot(h.state).cargo.ore.ferron).toBe(1);
    expect(h.debug.tileAt(h.state, 5, TOPSOIL).kind).toBe("tunnel");
  });

  it("leaves the ore behind, and still clears the cell, when the bay is full", async () => {
    h.pose((debug, state) => debug.setOreTile(state, 5, TOPSOIL, "ferron"));
    h.pose((debug, state) => debug.setTile(state, 5, TOPSOIL + 1, "rock"));
    standOn(h, 5, TOPSOIL);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.pose((debug, state) =>
      debug.setCargo(state, "marlite", cargoCap(state.tiers)),
    );
    h.hold("down");
    await h.seconds(1);
    h.release("down");
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.cargo.ore.ferron).toBeUndefined();
    expect(h.debug.tileAt(h.state, 5, TOPSOIL).kind).toBe("tunnel");
  });

  it("banks a material node into the satchel and clears the node", async () => {
    h.pose((debug, state) =>
      debug.setMaterialTile(state, 5, ROCKBED, "resonite"),
    );
    h.pose((debug, state) => debug.setTile(state, 5, ROCKBED + 1, "rock"));
    standOn(h, 5, ROCKBED);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("down");
    await h.seconds(2);
    h.release("down");
    expect(h.debug.snapshot(h.state).satchel.resonite).toBe(1);
    expect(h.debug.tileAt(h.state, 5, ROCKBED).kind).toBe("tunnel");
  });

  it("takes a Core Sample from the Core and leaves the Core in place", async () => {
    const core = h.debug.snapshot(h.state).coreRow;
    h.pose((debug, state) => debug.setTile(state, 5, core, "core"));
    standOn(h, 5, core);
    h.pose((debug, state) => debug.setFuel(state, 100));
    h.hold("down");
    await h.seconds(4);
    h.release("down");
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.satchel.coreSample).toBe(true);
    expect(snapshot.coreTimer).not.toBeNull();
    expect(h.debug.tileAt(h.state, 5, core).kind).toBe("core");
  });
});
