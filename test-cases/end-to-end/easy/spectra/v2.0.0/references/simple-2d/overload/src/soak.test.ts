// The game left to run on its own rules, for long enough to catch a stall.
//
// Nothing here poses an outcome. A run is opened through the title menu and then
// simply advanced, so what is exercised is the wave's own entry, the assault's own
// dives and fire, the contacts, the lives, the holds and the stage sequence, one
// after another, with the game deciding all of it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIELD_BOTTOM, FIELD_TOP, MAX_BURSTS, STAGE_H } from "./constants";
import { createHarness, startStage, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("a run left to itself", () => {
  it("plays on until the swarm ends it", async () => {
    h.pose((s, d) => d.reset(s, { seed: 21 }));
    h.tap("Enter");
    h.hold("Space");
    let ended = false;
    for (let second = 0; second < 180; second++) {
      await h.advance(1);
      if (h.snapshot().screen === "gameOver") {
        ended = true;
        break;
      }
    }
    h.release("Space");
    expect(ended).toBe(true);
    expect(h.snapshot().lives).toBe(0);
    expect(h.snapshot().score).toBeGreaterThan(0);
  });

  // A minute of game time, sampled twice a second, is long enough to catch a
  // roster that grows without bound and slow enough to need its own budget.
  it("keeps its field bounded while nothing can touch the ship", async () => {
    h.pose((s, d) => d.reset(s, { seed: 22 }));
    h.pose((s, d) => d.setShipContact(s, false));
    h.tap("Enter");
    h.hold("Space");

    let dives = 0;
    let returns = 0;
    let mostDrones = 0;
    let mostBullets = 0;
    for (let step = 0; step < 120; step++) {
      await h.advance(0.5);
      const snap = h.snapshot();
      // The run moves through its own stages; nothing here can end it.
      expect(snap.screen).not.toBe("gameOver");
      expect(snap.lives).toBeGreaterThan(0);
      dives += snap.drones.filter((drone) => drone.phase === "diving").length;
      returns += snap.drones.filter(
        (drone) => drone.phase === "returning",
      ).length;
      mostDrones = Math.max(mostDrones, snap.drones.length);
      mostBullets = Math.max(mostBullets, snap.bullets.length);
      expect(snap.bursts.length).toBeLessThanOrEqual(MAX_BURSTS);
      for (const drone of snap.drones) {
        expect(drone.y).toBeGreaterThan(-400);
        expect(drone.y).toBeLessThan(STAGE_H + 400);
      }
      for (const bullet of snap.bullets) {
        expect(bullet.y).toBeGreaterThanOrEqual(FIELD_TOP - 40);
        expect(bullet.y).toBeLessThanOrEqual(FIELD_BOTTOM + 40);
      }
    }
    h.release("Space");
    expect(h.snapshot().stage).toBeGreaterThanOrEqual(1);
    expect(dives).toBeGreaterThan(0);
    expect(returns).toBeGreaterThan(0);
    // The roster never grows without bound: the grid caps a standard wave, and
    // the enemy fire that a dive carries is one or two shots.
    expect(mostDrones).toBeLessThan(60);
    expect(mostBullets).toBeLessThan(60);
  }, 30000);

  it("carries a challenge stage through to the stage after it", async () => {
    h.pose((s, d) => d.reset(s, { seed: 23 }));
    h.pose((s, d) => d.setShipContact(s, false));
    await startStage(h, 3);
    expect(h.snapshot().isChallenge).toBe(true);
    let reached = 0;
    for (let second = 0; second < 40; second++) {
      await h.advance(1);
      reached = h.snapshot().stage;
      if (reached > 3) break;
    }
    expect(reached).toBe(4);
    expect(h.snapshot().isChallenge).toBe(false);
  });
});
