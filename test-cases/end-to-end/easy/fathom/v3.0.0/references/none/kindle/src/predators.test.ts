import { describe, expect, it } from "vitest";

import { board, stamp } from "./board.test-support";
import {
  ALERT_TIME,
  DEN_RELEASE_GAP,
  DRIFTER_SPEED,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_GIVEUP,
  GLOAMFIN_HEAR,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_PING_MIN_GAP,
  GLOAMFIN_RAMP_TIME,
  GLOAMFIN_SEARCH_DELAY,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  LINGER_TIME,
  PREDATOR_SPEED,
  TICK_DT,
  TILE,
} from "./constants";
import type { CueName } from "./constants";
import { Drifter, Forager, Predator } from "./entities";
import { InkField } from "./ink";
import { Maze } from "./maze";
import {
  armPingTimers,
  FLARE_FADE,
  isBlooming,
  isCharging,
  lightDetectRange,
  updatePredator,
} from "./predators";
import type { PredatorWorld } from "./predators";
import { Rng } from "./rng";
import type { Cell, PredatorKind } from "./types";

interface Ping {
  predator: Predator;
  lostYou: boolean;
}

interface Scene {
  maze: Maze;
  forager: Forager;
  predators: Predator[];
  ink: InkField;
  world: PredatorWorld;
  pings: Ping[];
  alerts: Predator[];
  cues: CueName[];
  step: (ticks: number) => void;
  seconds: (s: number) => void;
}

interface PredatorSpec {
  kind: PredatorKind;
  at: Cell;
  releaseAt?: number;
  released?: boolean;
  state?: "den" | "wander" | "chase";
}

function scene(
  rows: readonly string[],
  foragerAt: Cell,
  specs: readonly PredatorSpec[],
): Scene {
  const maze = new Maze();
  maze.load(rows);
  const forager = new Forager(foragerAt.col, foragerAt.row, 128);
  const predators = specs.map((spec, i) => {
    const p = new Predator(
      spec.kind,
      spec.at.col,
      spec.at.row,
      spec.releaseAt ?? i * DEN_RELEASE_GAP,
    );
    p.state = spec.state ?? "wander";
    p.released = spec.released ?? p.state !== "den";
    if (p.kind === "gloamfin") p.pingTimer = GLOAMFIN_PING_INTERVAL;
    if (p.kind === "flarefish") p.flareTimer = FLARE_INTERVAL;
    return p;
  });
  const ink = new InkField();
  const pings: Ping[] = [];
  const alerts: Predator[] = [];
  const cues: CueName[] = [];
  const world: PredatorWorld = {
    maze,
    rng: new Rng(4),
    forager,
    predators,
    drifters: [] as Drifter[],
    inkAt: (x, y) => ink.covers(x, y),
    inkBetween: (x1, y1, x2, y2) => ink.crosses(x1, y1, x2, y2),
    castPing: (predator, lostYou) => {
      pings.push({ predator, lostYou });
      armPingTimers(predator);
    },
    showAlert: (predator) => alerts.push(predator),
    playCue: (cue) => cues.push(cue),
  };
  const step = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      ink.update(TICK_DT);
      for (const p of predators) updatePredator(p, TICK_DT, world);
    }
  };
  return {
    maze,
    forager,
    predators,
    ink,
    world,
    pings,
    alerts,
    cues,
    step,
    seconds: (s: number) => step(Math.round(s / TICK_DT)),
  };
}

/** A long open corridor on row 5, with rock everywhere else. */
const HALL = board([".".repeat(30)], 5, 3);

/** A single tile with no open neighbor. */
const BOXED = board(["."], 5, 4);

/**
 * Two sealed tiles far apart, so a creature posed on one cannot travel and the
 * separation between them holds for as long as a scenario runs.
 */
function apart(gapInTiles: number): string[] {
  return stamp(BOXED, ["."], 5, 4 + gapInTiles);
}

describe("the den and the release schedule", () => {
  const denBoard = stamp(
    board([".".repeat(20)], 5, 8),
    ["#g#", "ddd", "ddd"],
    6,
    16,
  );

  it("holds a predator on its den tile until its release time", () => {
    const s = scene(denBoard, { col: 9, row: 5 }, [
      {
        kind: "lanternjaw",
        at: { col: 17, row: 7 },
        releaseAt: DEN_RELEASE_GAP,
        state: "den",
        released: false,
      },
    ]);
    const p = s.predators[0];
    s.seconds(DEN_RELEASE_GAP - 0.5);
    expect(p.released).toBe(false);
    expect(p.state).toBe("den");
    expect(p.tile).toEqual({ col: 17, row: 7 });
  });

  it("releases it when its time comes and lets it swim out through the gate", () => {
    const s = scene(denBoard, { col: 9, row: 5 }, [
      {
        kind: "lanternjaw",
        at: { col: 17, row: 8 },
        releaseAt: 0,
        state: "den",
        released: false,
      },
    ]);
    const p = s.predators[0];
    s.step(1);
    expect(p.released).toBe(true);
    expect(p.state).toBe("den");
    s.seconds(2);
    expect(p.state).toBe("wander");
    expect(s.maze.isCorridor(p.col, p.row)).toBe(true);
  });

  it("spaces release times, not arrivals, by the schedule's gap", () => {
    const s = scene(denBoard, { col: 9, row: 5 }, [
      {
        kind: "lanternjaw",
        at: { col: 16, row: 8 },
        releaseAt: 0,
        state: "den",
        released: false,
      },
      {
        kind: "gloamfin",
        at: { col: 17, row: 8 },
        releaseAt: DEN_RELEASE_GAP,
        state: "den",
        released: false,
      },
      {
        kind: "flarefish",
        at: { col: 18, row: 8 },
        releaseAt: 2 * DEN_RELEASE_GAP,
        state: "den",
        released: false,
      },
    ]);
    const releasedAt = s.predators.map(() => -1);
    for (let tick = 0; tick < Math.round(11 / TICK_DT); tick++) {
      s.step(1);
      s.predators.forEach((p, i) => {
        if (p.released && releasedAt[i] < 0) releasedAt[i] = tick * TICK_DT;
      });
    }
    expect(releasedAt[0]).toBeCloseTo(0, 1);
    expect(releasedAt[1]).toBeCloseTo(DEN_RELEASE_GAP, 1);
    expect(releasedAt[2]).toBeCloseTo(2 * DEN_RELEASE_GAP, 1);
  });

  it("suspends the schedule for a predator held in the den", () => {
    const s = scene(denBoard, { col: 9, row: 5 }, [
      {
        kind: "gloamfin",
        at: { col: 17, row: 8 },
        releaseAt: 0,
        state: "den",
        released: false,
      },
    ]);
    const p = s.predators[0];
    p.heldInDen = true;
    s.seconds(30);
    expect(p.released).toBe(false);
    expect(p.state).toBe("den");
    expect(p.tile).toEqual({ col: 17, row: 8 });
  });

  it("holds a released predator out of play on a board with no den", () => {
    const s = scene(HALL, { col: 20, row: 5 }, [
      {
        kind: "flarefish",
        at: { col: 4, row: 5 },
        releaseAt: 0,
        state: "den",
        released: false,
      },
    ]);
    const p = s.predators[0];
    s.seconds(5);
    expect(p.state).toBe("den");
    expect(p.tile).toEqual({ col: 4, row: 5 });
  });
});

describe("the Lanternjaw", () => {
  it("widens its detection range with the forager's brightness", () => {
    expect(lightDetectRange(0)).toBe(LANTERN_RANGE_BASE);
    expect(lightDetectRange(1)).toBe(LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN);
    expect(lightDetectRange(0.5)).toBe(
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN / 2,
    );
  });

  it("chases at the hunting pace once its light sense holds", () => {
    // Three tiles apart, inside R at G = 0, with a clear line between.
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "lanternjaw", at: { col: 13, row: 5 } },
    ]);
    s.step(1);
    const p = s.predators[0];
    expect(p.state).toBe("chase");
    expect(p.speed).toBe(PREDATOR_SPEED);
    expect(p.fix).toEqual({ col: 10, row: 5 });
  });

  it("drifts at the bonus drifter's pace while it has found nothing", () => {
    const s = scene(HALL, { col: 4, row: 5 }, [
      { kind: "lanternjaw", at: { col: 28, row: 5 } },
    ]);
    s.step(1);
    expect(s.predators[0].state).toBe("wander");
    expect(s.predators[0].speed).toBe(DRIFTER_SPEED);
  });

  it("fires no detection alert, ever", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "lanternjaw", at: { col: 13, row: 5 } },
    ]);
    s.seconds(3);
    expect(s.alerts).toHaveLength(0);
    expect(s.predators[0].alertT).toBe(0);
  });

  it("holds a lapsed fix for the linger and then wanders", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "lanternjaw", at: { col: 20, row: 5 } },
    ]);
    const p = s.predators[0];
    s.forager.brightness = 1; // R is 320, ten tiles: it can see across the gap
    s.step(1);
    expect(p.state).toBe("chase");
    // Dim out and slip away, so the sense lapses and the linger starts running
    // while the hunter drives on to the tile it last saw the forager on.
    s.forager.brightness = 0;
    s.forager.placeOn(31, 5);
    s.seconds(LINGER_TIME - 0.2);
    expect(p.state).toBe("chase");
    s.seconds(0.4);
    expect(p.state).toBe("wander");
    expect(p.fix).toBeNull();
  });

  it("drops a fix at once when ink blinds it, with no linger", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "lanternjaw", at: { col: 13, row: 5 } },
    ]);
    const p = s.predators[0];
    s.step(1);
    expect(p.state).toBe("chase");
    s.ink.release(p.x, p.y);
    s.step(1);
    expect(p.state).toBe("wander");
    expect(p.fix).toBeNull();
  });

  it("senses nothing through rock, however bright the forager", () => {
    const rows = stamp(HALL, ["#"], 5, 16);
    const s = scene(rows, { col: 10, row: 5 }, [
      { kind: "lanternjaw", at: { col: 20, row: 5 } },
    ]);
    s.forager.brightness = 1;
    s.step(1);
    expect(s.predators[0].state).toBe("wander");
  });
});

describe("the Gloamfin", () => {
  it("locks on by close hearing and fires one alert", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "gloamfin", at: { col: 11, row: 5 } },
    ]);
    const p = s.predators[0];
    s.step(1);
    expect(p.hearingLock).toBe(true);
    expect(p.state).toBe("chase");
    expect(p.alertT).toBeCloseTo(ALERT_TIME, 6);
    expect(s.alerts).toHaveLength(1);
    s.seconds(0.2);
    expect(s.alerts).toHaveLength(1);
  });

  it("hears no further than its hearing range", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      {
        kind: "gloamfin",
        at: { col: 10 + Math.ceil(GLOAMFIN_HEAR / TILE) + 1, row: 5 },
      },
    ]);
    s.step(1);
    expect(s.predators[0].hearingLock).toBe(false);
  });

  it("is silent while it holds a hearing lock and pings once it breaks", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "gloamfin", at: { col: 11, row: 5 } },
    ]);
    const p = s.predators[0];
    p.pingTimer = 0;
    s.seconds(1);
    expect(s.pings).toHaveLength(0);
    // Take the forager well out of hearing; the ping is due at once.
    s.forager.placeOn(28, 5);
    s.step(1);
    expect(s.pings).toHaveLength(1);
    expect(s.pings[0].lostYou).toBe(false);
  });

  it("casts on its interval and never inside the minimum gap", () => {
    const s = scene(apart(20), { col: 24, row: 5 }, [
      { kind: "gloamfin", at: { col: 4, row: 5 } },
    ]);
    s.seconds(GLOAMFIN_PING_INTERVAL - 0.1);
    expect(s.pings).toHaveLength(0);
    s.seconds(0.2);
    expect(s.pings).toHaveLength(1);
    s.seconds(GLOAMFIN_PING_MIN_GAP);
    expect(s.pings).toHaveLength(1);
    s.seconds(GLOAMFIN_PING_INTERVAL - GLOAMFIN_PING_MIN_GAP + 0.2);
    expect(s.pings).toHaveLength(2);
  });

  it("opens a fresh chase at its cap and loses that edge on a corner", () => {
    // An L the hunter must round to reach the forager.
    const rows = stamp(board([".........."], 5, 4), [".", ".", "."], 6, 13);
    const s = scene(rows, { col: 13, row: 8 }, [
      { kind: "gloamfin", at: { col: 4, row: 5 } },
    ]);
    const p = s.predators[0];
    p.state = "chase";
    p.fix = { col: 13, row: 8 };
    p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
    s.step(1);
    expect(p.speed).toBeCloseTo(GLOAMFIN_CHASE_SPEED, 3);
    // Run it round the corner at (13, 5) and read the speed straight after.
    let cornered = false;
    for (let i = 0; i < Math.round(4 / TICK_DT) && !cornered; i++) {
      s.step(1);
      if (p.dir === "down") cornered = true;
    }
    expect(cornered).toBe(true);
    expect(p.chaseSpeed).toBeCloseTo(GLOAMFIN_CORNER_SPEED, 6);
    // The knocked-down speed is what it travels on from the next step.
    s.step(1);
    expect(p.speed).toBeLessThan(GLOAMFIN_CHASE_SPEED);
  });

  it("climbs back to its cap over the ramp time", () => {
    const s = scene(HALL, { col: 28, row: 5 }, [
      { kind: "gloamfin", at: { col: 4, row: 5 } },
    ]);
    const p = s.predators[0];
    p.state = "chase";
    p.fix = { col: 28, row: 5 };
    p.chaseSpeed = GLOAMFIN_CORNER_SPEED;
    s.seconds(GLOAMFIN_RAMP_TIME / 2);
    expect(p.speed).toBeCloseTo(
      (GLOAMFIN_CORNER_SPEED + GLOAMFIN_CHASE_SPEED) / 2,
      0,
    );
    s.seconds(GLOAMFIN_RAMP_TIME / 2 + 0.1);
    expect(p.speed).toBeCloseTo(GLOAMFIN_CHASE_SPEED, 6);
  });

  it("searches an empty fix, casts one lost-you ping, and gives up", () => {
    const s = scene(HALL, { col: 28, row: 5 }, [
      { kind: "gloamfin", at: { col: 9, row: 5 } },
    ]);
    const p = s.predators[0];
    p.state = "chase";
    p.fix = { col: 10, row: 5 };
    p.pingGap = 0;
    p.pingTimer = GLOAMFIN_PING_INTERVAL;
    s.seconds(0.5);
    expect(p.state).toBe("search");
    expect(p.speed).toBe(PREDATOR_SPEED);

    const before = s.pings.length;
    s.seconds(GLOAMFIN_SEARCH_DELAY + 0.1);
    const lostYou = s.pings.slice(before).filter((ping) => ping.lostYou);
    expect(lostYou).toHaveLength(1);

    s.seconds(GLOAMFIN_GIVEUP);
    expect(p.state).toBe("wander");
    expect(p.fix).toBeNull();
  });

  it("casts the lost-you ping at most once in a search", () => {
    const s = scene(HALL, { col: 28, row: 5 }, [
      { kind: "gloamfin", at: { col: 9, row: 5 } },
    ]);
    const p = s.predators[0];
    p.state = "chase";
    p.fix = { col: 10, row: 5 };
    p.pingGap = 0;
    s.seconds(GLOAMFIN_GIVEUP - 0.2);
    expect(s.pings.filter((ping) => ping.lostYou)).toHaveLength(1);
  });

  it("wanders at the ordinary pace, however long it has wandered", () => {
    const s = scene(apart(20), { col: 24, row: 5 }, [
      { kind: "gloamfin", at: { col: 4, row: 5 } },
    ]);
    s.step(1);
    expect(s.predators[0].speed).toBe(PREDATOR_SPEED);
    s.seconds(60);
    expect(s.predators[0].speed).toBe(PREDATOR_SPEED);
  });
});

describe("the Flarefish", () => {
  /** Far enough from the forager that nothing it does is a lock. */
  function loneFlarefish(): Scene {
    return scene(apart(20), { col: 24, row: 5 }, [
      { kind: "flarefish", at: { col: 4, row: 5 } },
    ]);
  }

  it("charges, blooms, and fades on the beats the specification fixes", () => {
    const s = loneFlarefish();
    const p = s.predators[0];
    s.seconds(FLARE_INTERVAL - 0.1);
    expect(isCharging(p)).toBe(false);
    expect(isBlooming(p)).toBe(false);

    s.seconds(0.2);
    expect(isCharging(p)).toBe(true);

    s.seconds(FLARE_CHARGE);
    expect(isBlooming(p)).toBe(true);
    expect(s.cues).toContain("flare");

    s.seconds(FLARE_BLOOM);
    expect(isBlooming(p)).toBe(false);
    expect(p.flarePhase).toBe("fade");

    s.seconds(FLARE_FADE);
    expect(p.flarePhase).toBe("none");
  });

  it("begins consecutive charge-ups a bloom and a whole interval apart", () => {
    const s = loneFlarefish();
    const p = s.predators[0];
    const charges: number[] = [];
    let wasCharging = false;
    const ticks = Math.round(20 / TICK_DT);
    for (let i = 0; i < ticks; i++) {
      s.step(1);
      const nowCharging = isCharging(p);
      if (nowCharging && !wasCharging) charges.push(i * TICK_DT);
      wasCharging = nowCharging;
    }
    expect(charges.length).toBeGreaterThanOrEqual(2);
    expect(charges[1] - charges[0]).toBeCloseTo(
      FLARE_CHARGE + FLARE_BLOOM + FLARE_INTERVAL,
      1,
    );
  });

  it("locks on anywhere inside the bloom and ends it at once", () => {
    // Five tiles apart: past R at G = 0, inside the flare radius.
    const s = scene(apart(5), { col: 4, row: 5 }, [
      { kind: "flarefish", at: { col: 9, row: 5 } },
    ]);
    const p = s.predators[0];
    expect(lightDetectRange(0)).toBeLessThan(5 * TILE);
    expect(5 * TILE).toBeLessThan(FLARE_RADIUS);
    p.flareTimer = 0;
    s.seconds(FLARE_CHARGE + 0.05);
    expect(p.state).toBe("chase");
    expect(isBlooming(p)).toBe(false);
    expect(s.alerts).toHaveLength(1);
  });

  it("takes a fix by its ordinary light sense between flares", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "flarefish", at: { col: 13, row: 5 } },
    ]);
    const p = s.predators[0];
    s.step(1);
    expect(p.state).toBe("chase");
    expect(p.speed).toBe(PREDATOR_SPEED);
    expect(s.alerts).toHaveLength(1);
  });

  it("gives off no tell at all while it hunts", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "flarefish", at: { col: 13, row: 5 } },
    ]);
    const p = s.predators[0];
    p.flareTimer = 0;
    s.seconds(3);
    expect(p.state).toBe("chase");
    expect(isCharging(p)).toBe(false);
    expect(isBlooming(p)).toBe(false);
  });

  it("re-arms a whole interval when it gives the forager up", () => {
    const s = scene(HALL, { col: 10, row: 5 }, [
      { kind: "flarefish", at: { col: 20, row: 5 } },
    ]);
    const p = s.predators[0];
    s.forager.brightness = 1;
    s.step(1);
    expect(p.state).toBe("chase");
    s.forager.brightness = 0;
    s.forager.placeOn(31, 5);
    for (let i = 0; i < Math.round((LINGER_TIME + 0.5) / TICK_DT); i++) {
      if (p.state === "wander") break;
      s.step(1);
    }
    expect(p.state).toBe("wander");
    expect(p.flareTimer).toBeCloseTo(FLARE_INTERVAL, 6);
  });

  it("travels at the hunting pace in every state", () => {
    const s = loneFlarefish();
    s.step(1);
    expect(s.predators[0].speed).toBe(PREDATOR_SPEED);
    s.seconds(FLARE_INTERVAL + FLARE_CHARGE + 0.2);
    expect(s.predators[0].speed).toBe(PREDATOR_SPEED);
  });
});

describe("predators keep to the corridors", () => {
  it("rounds a rock spine to reach its fix without ever standing on rock", () => {
    const rows = stamp(board([".....", "#####", "....."], 6, 8), ["."], 7, 12);
    const s = scene(rows, { col: 8, row: 8 }, [
      { kind: "gloamfin", at: { col: 8, row: 6 } },
    ]);
    const p = s.predators[0];
    p.state = "chase";
    p.fix = { col: 8, row: 8 };
    for (let i = 0; i < Math.round(8 / TICK_DT); i++) {
      s.step(1);
      expect(s.maze.isRock(p.col, p.row)).toBe(false);
    }
    expect(p.row).toBe(8);
  });

  it("stays put on a tile with no open neighbor", () => {
    const s = scene(BOXED, { col: 4, row: 5 }, [
      { kind: "lanternjaw", at: { col: 4, row: 5 } },
    ]);
    const p = s.predators[0];
    const { x, y } = p;
    s.seconds(5);
    expect(p.x).toBe(x);
    expect(p.y).toBe(y);
  });
});
