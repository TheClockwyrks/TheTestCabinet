// Lives, the ready hold, the extra life, the end of a run, and every figure paid.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISCHARGE_TIME,
  EXTRA_LIFE_AT,
  READY_HOLD,
  RESONANCE_MAX,
  SCORE_FLUX_DIVE,
  SCORE_FLUX_FORM,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  SHIP_Y,
  START_LIVES,
} from "./constants";
import { LANE_CENTRE } from "./flow";
import {
  createHarness,
  droneOf,
  fireAt,
  poseDrone,
  startPosed,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  h.pose((s, d) => d.reset(s, { seed: 6 }));
  startPosed(h);
  h.pose((s, d) => d.setShipContact(s, true));
});

afterEach(() => {
  h.dispose();
});

describe("a life", () => {
  it("is lost exactly once to an opposite-band bullet", async () => {
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 555, "magenta"));
    await h.advance(0.4);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("is lost exactly once to a drone body", async () => {
    poseDrone(h, "shard", LANE_CENTRE, SHIP_Y);
    poseDrone(h, "shard", LANE_CENTRE + 4, SHIP_Y);
    await h.advance(0.1);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("costs nothing when the bullet is absorbed", async () => {
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "cyan"));
    await h.advance(0.4);
    expect(h.snapshot().lives).toBe(START_LIVES);
  });
});

describe("the ready hold", () => {
  it("holds for its own time and then returns to live play", async () => {
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.4);
    expect(h.snapshot().phase).toBe("ready");
    expect(h.snapshot().ship.alive).toBe(false);
    await h.advance(READY_HOLD * 0.6);
    expect(h.snapshot().phase).toBe("ready");
    await h.advance(READY_HOLD * 0.6);
    expect(h.snapshot().phase).toBe("live");
  });

  it("returns the ship to the centre of its lane, on the band it held", async () => {
    h.pose((s, d) => d.setShipBand(s, "magenta"));
    h.pose((s, d) => d.setShipX(s, 900));
    h.pose((s, d) => d.addEnemyBullet(s, 900, 560, "cyan"));
    await h.advance(0.4 + READY_HOLD + 0.2);
    expect(h.snapshot().ship.x).toBe(LANE_CENTRE);
    expect(h.snapshot().ship.band).toBe("magenta");
  });

  it("leaves the wave standing where it was", async () => {
    const resting = poseDrone(h, "shard", 500, 200, { phase: "formation" });
    const diving = poseDrone(h, "flux", 700, 300, { phase: "diving" });
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.4 + READY_HOLD + 0.2);
    expect(droneOf(h, resting)?.phase).toBe("formation");
    expect(droneOf(h, diving)?.phase).toBe("diving");
    expect(droneOf(h, resting)?.x).toBeCloseTo(500, 3);
  });

  it("costs no further life while it runs", async () => {
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.4);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(READY_HOLD * 0.5);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });
});

describe("the extra life", () => {
  it("is paid once as a real kill carries the score across", async () => {
    h.pose((s, d) => d.setScore(s, EXTRA_LIFE_AT - SCORE_SHARD_FORM));
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().lives).toBe(START_LIVES + 1);
    expect(h.snapshot().extraLifeAwarded).toBe(true);

    h.pose((s, d) => d.setScore(s, EXTRA_LIFE_AT - SCORE_SHARD_FORM));
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().lives).toBe(START_LIVES + 1);
  });

  it("is not re-armed by posing the latch back down", async () => {
    h.pose((s, d) => d.setExtraLifeAwarded(s, true));
    h.pose((s, d) => d.setScore(s, EXTRA_LIFE_AT - SCORE_SHARD_FORM));
    poseDrone(h, "shard", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().lives).toBe(START_LIVES);
  });
});

describe("the end of a run", () => {
  it("opens the game-over screen as the last life goes", async () => {
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.setStage(s, 4));
    h.pose((s, d) => d.setScore(s, 7777));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.4);
    expect(h.snapshot().lives).toBe(0);
    expect(h.snapshot().screen).toBe("gameOver");
    expect(h.snapshot().score).toBe(7777);
    expect(h.snapshot().stage).toBe(4);
  });
});

describe("every figure a destroyed drone pays", () => {
  it("pays a Shard and a Flux by the phase each stood in", async () => {
    const pay = async (
      kind: "shard" | "flux",
      phase: "formation" | "diving" | "entering" | "returning",
    ): Promise<number> => {
      startPosed(h);
      poseDrone(h, kind, 500, 300, { band: "cyan", phase });
      await fireAt(h, 500, 300, "cyan");
      return h.snapshot().score;
    };
    expect(await pay("shard", "formation")).toBe(SCORE_SHARD_FORM);
    expect(await pay("shard", "diving")).toBe(SCORE_SHARD_DIVE);
    expect(await pay("shard", "entering")).toBe(SCORE_SHARD_DIVE);
    expect(await pay("shard", "returning")).toBe(SCORE_SHARD_DIVE);
    expect(await pay("flux", "formation")).toBe(SCORE_FLUX_FORM);
    expect(await pay("flux", "diving")).toBe(SCORE_FLUX_DIVE);
  });

  it("pays a Prism's shell and its core apart", async () => {
    poseDrone(h, "prism", 500, 300, { band: "cyan", phase: "formation" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().score).toBe(SCORE_PRISM_SHELL);
    await fireAt(h, 500, 300, "magenta");
    expect(h.snapshot().score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
  });

  it("pays a discharge kill the same as a bullet kill in that phase", async () => {
    poseDrone(h, "shard", 400, 300, { phase: "diving" });
    poseDrone(h, "shard", 700, 300, { phase: "diving" });
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(DISCHARGE_TIME + 0.1);
    expect(h.snapshot().score).toBe(SCORE_SHARD_DIVE * 2);
  });
});
