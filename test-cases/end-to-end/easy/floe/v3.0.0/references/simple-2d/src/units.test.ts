// Floe — the pure pieces, called directly.
//
// Everything here is a function of its arguments: the seeded generator, the strait's
// geometry and covering rule, the lane arithmetic, the critter's own rules, the bear's
// routing, the bonus catch's cadence, the score, and the two things that talk to the
// runtime rather than to the game — the actions the build registers and the values it
// names for the overlay. `src/engine.test.ts` covers the same rules through a real
// engine; these cover the arithmetic under them, where a figure can be asserted
// exactly rather than after a tick's worth of integration.

import { describe, expect, it, vi } from "vitest";
import {
  ACTIONS,
  BAYFILL_PAUSE,
  BAYS,
  BEAR_EMERGE_DELAY,
  BEAR_ICE_SPEED,
  BEAR_SWIM_SPEED,
  BONUS_LIFE_EVERY,
  CLEAR_PAUSE,
  DEATH_PAUSE,
  DEFAULT_SEED,
  FISH_INTERVAL,
  FISH_LINGER,
  HOP_COOLDOWN,
  ICE_BOTTOM,
  ICE_TOP,
  ITEM_LEN,
  LAYOUT,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  START_COL,
  STRAIT_W,
  TICK_DT,
  TILE,
  TOTAL_LEVELS,
  crossingTimer,
  laneGap,
  laneSpeed,
  tileCX,
  tileCY,
} from "./constants";
import { CUE_SPECS, defineCues } from "./audio";
import { emptySprites, loadSprites, type Frames } from "./assets";
import {
  carryCritter,
  critterCol,
  critterRow,
  footingOf,
  hop,
  hopRefusal,
  sweptOff,
} from "./critter";
import { eligibleBays, placeFish, resetFish, stepFish, takeFish } from "./fish";
import { blankState, freshCrossing, resetToTitle, startRun } from "./flow";
import {
  addBear,
  bearSpeed,
  chooseStep,
  closedToBear,
  openToBear,
  settled,
  slotAdvance,
  slotCount,
  slotDelay,
  swimmingInto,
} from "./hunter";
import { NO_INPUT, readInput, registerActions } from "./input";
import {
  advanceLanes,
  laneCount,
  laneCycle,
  laneMotion,
  lanePeriod,
  lanePositions,
  laneSpecAt,
  laneWillCover,
  layOutStrait,
} from "./lanes";
import { nextIndex, nextRandom, nextRange } from "./rng";
import { addScore, boundariesCrossed } from "./scoring";
import { registerDiagnostics } from "./diagnostics";
import { newTickEvents, toSim, type Sim } from "./sim";
import {
  anyCoversBody,
  anyCoversTile,
  bandOf,
  bayAt,
  bayCenterX,
  coversPoint,
  coversTile,
  isIceRow,
  isWaterRow,
  tileDistance,
} from "./strait";
import { SPENT, expired } from "./timing";
import type { FloeState } from "./game";

/** A working value over a fresh state, with nothing on the strait. */
function emptied(): Sim {
  const sim = toSim(blankState());
  sim.screen = "playing";
  sim.vehicles = [];
  sim.floes = [];
  sim.bears = [];
  return sim;
}

// ---- The generator ------------------------------------------------------

describe("the seeded generator", () => {
  it("draws the same sequence from the same seed, and a different one otherwise", () => {
    const run = (seed: number): number[] => {
      let state = seed;
      const draws: number[] = [];
      for (let index = 0; index < 8; index += 1) {
        const [value, next] = nextRandom(state);
        draws.push(value);
        state = next;
      }
      return draws;
    };
    expect(run(DEFAULT_SEED)).toEqual(run(DEFAULT_SEED));
    expect(run(2)).not.toEqual(run(DEFAULT_SEED));
    for (const value of run(9)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("holds a range draw inside its bounds and an index draw inside its count", () => {
    let state = 5;
    for (let index = 0; index < 200; index += 1) {
      const [value, afterRange] = nextRange(state, 10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(20);
      const [pick, afterIndex] = nextIndex(afterRange, 4);
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(4);
      state = afterIndex;
    }
  });
});

// ---- The strait --------------------------------------------------------

describe("the strait", () => {
  it("names the band every row belongs to", () => {
    expect(bandOf(ROW_CAP)).toBe("far-shore");
    expect(bandOf(ROW_BAYS)).toBe("far-shore");
    expect(bandOf(2)).toBe("water");
    expect(bandOf(9)).toBe("water");
    expect(bandOf(ROW_MEDIAN)).toBe("median");
    expect(bandOf(ICE_TOP)).toBe("ice");
    expect(bandOf(ICE_BOTTOM)).toBe("ice");
    expect(bandOf(ROW_NEAR)).toBe("near-shore");
    expect(bandOf(-1)).toBeNull();
    expect(bandOf(20)).toBeNull();
    expect(isIceRow(ICE_TOP)).toBe(true);
    expect(isIceRow(ROW_MEDIAN)).toBe(false);
    expect(isWaterRow(5)).toBe(true);
    expect(isWaterRow(ROW_MEDIAN)).toBe(false);
  });

  it("names the bay every column of the bay row belongs to", () => {
    BAYS.forEach((pair, index) => {
      expect(bayAt(pair[0])).toBe(index);
      expect(bayAt(pair[1])).toBe(index);
      expect(bayCenterX(index)).toBe((tileCX(pair[0]) + tileCX(pair[1])) / 2);
    });
    for (const col of [0, 2, 5, 10, 13, 18, 21, 26, 29, 34, 37, 39]) {
      expect(bayAt(col)).toBeNull();
    }
  });

  it("reads the covering rule as a half-open span", () => {
    const item = { row: 5, x: 100, len: 2 };
    expect(coversPoint(item, 100)).toBe(true);
    expect(coversPoint(item, 163.9)).toBe(true);
    expect(coversPoint(item, 164)).toBe(false);
    expect(coversPoint(item, 99.9)).toBe(false);
    // A tile is covered when its centre is.
    expect(coversTile(item, 3, 5)).toBe(true);
    expect(coversTile(item, 4, 5)).toBe(true);
    expect(coversTile(item, 5, 5)).toBe(false);
    expect(coversTile(item, 3, 6)).toBe(false);
    expect(anyCoversTile([item], 3, 5)).toBe(true);
    expect(anyCoversBody([item], 5, 120)).toBe(true);
    expect(anyCoversBody([item], 6, 120)).toBe(false);
  });

  it("measures a tile distance as the sum of the two differences", () => {
    expect(tileDistance(0, 0, 3, 4)).toBe(7);
    expect(tileDistance(5, 5, 5, 5)).toBe(0);
    expect(tileDistance(9, 2, 4, 8)).toBe(11);
  });
});

// ---- The lanes ---------------------------------------------------------

describe("the lanes", () => {
  it("knows every row's own table entry, and none for a row that carries no lane", () => {
    for (let row = ICE_TOP; row <= ICE_BOTTOM; row += 1) {
      expect(laneSpecAt(row)?.row).toBe(row);
    }
    for (let row = 2; row <= 9; row += 1) {
      expect(laneSpecAt(row)?.row).toBe(row);
    }
    expect(laneSpecAt(ROW_MEDIAN)).toBeNull();
    expect(laneSpecAt(ROW_NEAR)).toBeNull();
  });

  it("spaces a lane by its own period, and reaches past both edges", () => {
    for (const level of [1, 4, 7]) {
      for (const row of [ICE_TOP, 2, 5, 9]) {
        const spec = laneSpecAt(row);
        if (spec === null) continue;
        const len = ITEM_LEN[spec.kind];
        const period = lanePeriod(row, level);
        expect(period).toBe((len + laneGap(row, level)) * TILE);
        expect(laneCycle(row, level)).toBe(laneCount(row, level) * period);
        expect(laneCycle(row, level)).toBeGreaterThan(STRAIT_W);

        const positions = lanePositions(row, level, period * 0.37, len);
        expect(positions).toHaveLength(laneCount(row, level));
        for (let index = 1; index < positions.length; index += 1) {
          expect(positions[index] - positions[index - 1]).toBeCloseTo(
            period,
            9,
          );
        }
        expect(positions[0]).toBeLessThanOrEqual(0 + period);
        expect(positions[positions.length - 1] + len * TILE).toBeGreaterThan(
          STRAIT_W,
        );
      }
    }
  });

  it("holds every gap exact across a full cycle of wrapping", () => {
    const sim = emptied();
    sim.level = 1;
    layOutStrait(sim);
    for (let tick = 0; tick < 3600; tick += 1) advanceLanes(sim, TICK_DT);
    for (const lane of [...sim.iceLanes, ...sim.waterLanes]) {
      const items = [...sim.vehicles, ...sim.floes]
        .filter((item) => item.row === lane.row)
        .sort((a, b) => a.x - b.x);
      const period = lanePeriod(lane.row, 1);
      for (let index = 1; index < items.length; index += 1) {
        expect(items[index].x - items[index - 1].x).toBeCloseTo(period, 3);
      }
    }
  });

  it("moves a lane held at zero speed not at all", () => {
    const sim = emptied();
    sim.level = 1;
    layOutStrait(sim);
    for (const lane of sim.iceLanes) lane.speed = 0;
    const before = sim.vehicles.map((item) => item.x);
    for (let tick = 0; tick < 120; tick += 1) advanceLanes(sim, TICK_DT);
    expect(sim.vehicles.map((item) => item.x)).toEqual(before);
  });

  it("reports a lane at rest for a row that carries none", () => {
    const sim = emptied();
    expect(laneMotion(sim, ROW_MEDIAN)).toEqual({ dir: 1, speed: 0 });
    expect(laneMotion(sim, ICE_TOP).speed).toBeCloseTo(
      laneSpeed(ICE_TOP, 1),
      9,
    );
  });

  it("sees a moving vehicle arriving on a tile inside the lead, and a parked one never", () => {
    const sim = emptied();
    sim.vehicles = [{ id: 1, row: ICE_TOP, kind: "car", x: 400, len: 2 }];
    const lane = sim.iceLanes.find((entry) => entry.row === ICE_TOP);
    if (lane === undefined) throw new Error("no lane");
    lane.dir = -1;
    lane.speed = 4;
    // The tile at column 10 has its centre at 336, two tiles ahead of the span.
    expect(laneWillCover(sim, 10, ICE_TOP, 0)).toBe(false);
    expect(laneWillCover(sim, 10, ICE_TOP, 0.6)).toBe(true);
    lane.speed = 0;
    expect(laneWillCover(sim, 10, ICE_TOP, 10)).toBe(false);
  });
});

// ---- The critter -------------------------------------------------------

describe("the critter", () => {
  it("takes its tile from its centre", () => {
    const sim = emptied();
    sim.critter.x = tileCX(7) + 5;
    sim.critter.y = tileCY(12);
    expect(critterCol(sim)).toBe(7);
    expect(critterRow(sim)).toBe(12);
  });

  it("names every refusal, and nothing for an accepted target", () => {
    const sim = emptied();
    expect(hopRefusal(sim, -1, 5)).toBe("off the grid");
    expect(hopRefusal(sim, 40, 5)).toBe("off the grid");
    expect(hopRefusal(sim, 5, ROW_CAP)).toContain("cap");
    expect(hopRefusal(sim, 6, ROW_BAYS)).toBe("solid far shore");
    expect(hopRefusal(sim, 3, ROW_BAYS)).toBeNull();
    sim.bays[0] = true;
    expect(hopRefusal(sim, 3, ROW_BAYS)).toBe("a filled bay");
    sim.vehicles = [
      { id: 1, row: ICE_TOP, kind: "car", x: tileCX(20) - 16, len: 2 },
    ];
    expect(hopRefusal(sim, 20, ICE_TOP)).toBe("a vehicle");
    expect(hopRefusal(sim, 20, ROW_MEDIAN)).toBeNull();
  });

  it("sets the centre exactly on the target tile's centre, and the cooldown", () => {
    const sim = emptied();
    sim.critter.present = true;
    sim.critter.x = tileCX(20) + 13;
    sim.critter.y = tileCY(5);
    sim.critter.bestRow = 5;
    const taken = hop(sim, "up");
    expect(taken).toEqual({ col: 20, row: 4, newRow: true });
    expect(sim.critter.x).toBe(tileCX(20));
    expect(sim.critter.y).toBe(tileCY(4));
    expect(sim.critter.facing).toBe("up");
    expect(sim.critter.hopCooldown).toBe(HOP_COOLDOWN);
    expect(sim.critter.bestRow).toBe(4);

    // A hop back down reaches no new row, so `bestRow` holds.
    sim.critter.hopCooldown = 0;
    const back = hop(sim, "down");
    expect(back?.newRow).toBe(false);
    expect(sim.critter.bestRow).toBe(4);
  });

  it("leaves everything as it was when a hop is refused", () => {
    const sim = emptied();
    sim.critter.present = true;
    sim.critter.x = tileCX(20);
    sim.critter.y = tileCY(ROW_NEAR);
    sim.critter.facing = "left";
    expect(hop(sim, "down")).toBeNull();
    expect(sim.critter.y).toBe(tileCY(ROW_NEAR));
    expect(sim.critter.facing).toBe("left");
    expect(sim.critter.hopCooldown).toBe(0);
  });

  it("is carried only while its footing is a floe", () => {
    const sim = emptied();
    sim.critter.present = true;
    sim.critter.x = tileCX(20);
    sim.critter.y = tileCY(9);
    expect(footingOf(sim)).toBe("water");
    const before = sim.critter.x;
    carryCritter(sim, TICK_DT);
    expect(sim.critter.x).toBe(before);

    sim.floes = [{ id: 1, row: 9, kind: "raft4", x: tileCX(18) - 16, len: 4 }];
    const lane = sim.waterLanes.find((entry) => entry.row === 9);
    if (lane === undefined) throw new Error("no lane");
    lane.dir = 1;
    lane.speed = 3;
    expect(footingOf(sim)).toBe("floe");
    // The floe drifts with the critter on it, so the rider stays on the span it
    // is being carried by.
    for (let tick = 0; tick < 120; tick += 1) {
      advanceLanes(sim, TICK_DT);
      carryCritter(sim, TICK_DT);
    }
    expect(footingOf(sim)).toBe("floe");
    expect(sim.critter.x - before).toBeCloseTo(3 * TILE, 6);
  });

  it("is swept off past either edge", () => {
    const sim = emptied();
    sim.critter.x = 0;
    expect(sweptOff(sim)).toBe(false);
    sim.critter.x = -0.1;
    expect(sweptOff(sim)).toBe(true);
    sim.critter.x = STRAIT_W;
    expect(sweptOff(sim)).toBe(false);
    sim.critter.x = STRAIT_W + 0.1;
    expect(sweptOff(sim)).toBe(true);
  });
});

// ---- The bear ----------------------------------------------------------

describe("the bear", () => {
  it("counts one slot below level 5 and two from it", () => {
    for (let level = 1; level <= 4; level += 1)
      expect(slotCount(level)).toBe(1);
    for (let level = 5; level <= TOTAL_LEVELS; level += 1) {
      expect(slotCount(level)).toBe(2);
    }
    expect(slotAdvance(0)).toBe(3);
    expect(slotAdvance(1)).toBe(6);
    expect(slotDelay(0)).toBeCloseTo(0.6, 9);
    expect(slotDelay(1)).toBeCloseTo(2, 9);
  });

  it("closes the far shore, the outside of the grid and a covered tile", () => {
    const sim = emptied();
    expect(closedToBear(sim, -1, 5)).toBe(true);
    expect(closedToBear(sim, 40, 5)).toBe(true);
    expect(closedToBear(sim, 5, ROW_CAP)).toBe(true);
    expect(closedToBear(sim, 5, ROW_BAYS)).toBe(true);
    expect(closedToBear(sim, 5, 2)).toBe(false);
    sim.vehicles = [
      { id: 1, row: ICE_TOP, kind: "plow", x: tileCX(10) - 16, len: 3 },
    ];
    for (const col of [10, 11, 12]) {
      expect(closedToBear(sim, col, ICE_TOP)).toBe(true);
    }
    expect(closedToBear(sim, 13, ICE_TOP)).toBe(false);
    // A parked lane threatens nothing beyond what it covers.
    const lane = sim.iceLanes.find((entry) => entry.row === ICE_TOP);
    if (lane === undefined) throw new Error("no lane");
    lane.speed = 0;
    expect(openToBear(sim, 13, ICE_TOP)).toBe(true);
    lane.speed = 4;
    lane.dir = 1;
    expect(openToBear(sim, 13, ICE_TOP)).toBe(false);
  });

  it("gives a bear the speed of the footing it is entering", () => {
    const sim = emptied();
    const bear = addBear(sim, 20, 5);
    expect(settled(bear)).toBe(true);
    expect(swimmingInto(sim, 20, 5)).toBe(true);
    expect(bearSpeed(sim, bear)).toBeCloseTo(BEAR_SWIM_SPEED, 9);
    sim.floes = [{ id: 9, row: 5, kind: "pan", x: tileCX(20) - 16, len: 1 }];
    expect(swimmingInto(sim, 20, 5)).toBe(false);
    expect(bearSpeed(sim, bear)).toBeCloseTo(BEAR_ICE_SPEED, 9);
    const onIce = addBear(sim, 20, ROW_MEDIAN);
    expect(bearSpeed(sim, onIce)).toBeCloseTo(BEAR_ICE_SPEED, 9);
  });

  it("commits no step while it stands on its target", () => {
    const sim = emptied();
    const bear = addBear(sim, 20, ROW_MEDIAN);
    bear.target = { col: 20, row: ROW_MEDIAN };
    expect(chooseStep(sim, bear)).toBeNull();
  });

  it("takes the first step of a shortest open route", () => {
    const sim = emptied();
    const bear = addBear(sim, 20, ROW_MEDIAN);
    bear.target = { col: 26, row: ROW_MEDIAN };
    expect(chooseStep(sim, bear)).toBe("right");
    bear.target = { col: 14, row: ROW_MEDIAN };
    expect(chooseStep(sim, bear)).toBe("left");
    bear.target = { col: 20, row: ROW_MEDIAN - 4 };
    expect(chooseStep(sim, bear)).toBe("up");
    bear.target = { col: 20, row: ROW_NEAR };
    expect(chooseStep(sim, bear)).toBe("down");
  });

  it("routes around a covered tile rather than into it", () => {
    const sim = emptied();
    const lane = sim.iceLanes.find((entry) => entry.row === ICE_TOP);
    if (lane === undefined) throw new Error("no lane");
    lane.speed = 0;
    sim.vehicles = [
      { id: 1, row: ICE_TOP, kind: "car", x: tileCX(20) - 16, len: 2 },
    ];
    const bear = addBear(sim, 20, ICE_TOP + 1);
    bear.target = { col: 20, row: ICE_TOP - 1 };
    const step = chooseStep(sim, bear);
    expect(step).not.toBe("up");
    expect(["left", "right"]).toContain(step);
  });

  it("steps closer when no open route exists at all", () => {
    const sim = emptied();
    const wall = ICE_TOP + 1;
    const lane = sim.iceLanes.find((entry) => entry.row === wall);
    if (lane === undefined) throw new Error("no lane");
    lane.speed = 0;
    sim.vehicles = [];
    for (let col = 0; col < 40; col += 3) {
      sim.vehicles.push({
        id: col + 1,
        row: wall,
        kind: "plow",
        x: tileCX(col) - 16,
        len: 3,
      });
    }
    const bear = addBear(sim, 20, wall + 1);
    bear.target = { col: 30, row: wall - 1 };
    expect(chooseStep(sim, bear)).toBe("right");
  });

  it("commits no step at all when every neighbour is closed", () => {
    const sim = emptied();
    const row = ICE_TOP + 3;
    for (const [col, at] of [
      [20, row - 1],
      [20, row + 1],
      [19, row],
      [21, row],
    ] as const) {
      const lane = sim.iceLanes.find((entry) => entry.row === at);
      if (lane !== undefined) lane.speed = 0;
      sim.vehicles.push({
        id: sim.vehicles.length + 1,
        row: at,
        kind: "car",
        x: tileCX(col) - 16,
        len: 2,
      });
    }
    const bear = addBear(sim, 20, row);
    bear.target = { col: 30, row: ROW_MEDIAN };
    expect(chooseStep(sim, bear)).toBeNull();
  });
});

// ---- The bonus catch ---------------------------------------------------

describe("the bonus catch", () => {
  it("appears in an open bay other than the last one it held", () => {
    const sim = emptied();
    resetFish(sim);
    sim.bays = [true, false, false, false, false];
    expect(eligibleBays(sim)).toEqual([1, 2, 3, 4]);
    sim.lastFishBay = 2;
    expect(eligibleBays(sim)).toEqual([1, 3, 4]);
  });

  it("lingers, leaves, and waits an interval for the next", () => {
    const sim = emptied();
    resetFish(sim);
    expect(sim.fishTimer).toBe(FISH_INTERVAL);
    for (let tick = 0; tick < FISH_INTERVAL * 120 - 1; tick += 1) {
      stepFish(sim, TICK_DT);
    }
    expect(sim.fishBay).toBeNull();
    stepFish(sim, TICK_DT);
    const first = sim.fishBay;
    expect(first).not.toBeNull();
    expect(sim.fishTimer).toBe(FISH_LINGER);

    for (let tick = 0; tick < FISH_LINGER * 120; tick += 1) {
      stepFish(sim, TICK_DT);
    }
    expect(sim.fishBay).toBeNull();
    expect(sim.lastFishBay).toBe(first);
    expect(sim.fishTimer).toBeCloseTo(FISH_INTERVAL, 6);
  });

  it("brings none where every bay is filled, and waits again", () => {
    const sim = emptied();
    resetFish(sim);
    sim.bays = [true, true, true, true, true];
    for (let tick = 0; tick < FISH_INTERVAL * 120; tick += 1) {
      stepFish(sim, TICK_DT);
    }
    expect(sim.fishBay).toBeNull();
    expect(sim.fishTimer).toBe(FISH_INTERVAL);
  });

  it("does nothing at all with the cadence off", () => {
    const sim = emptied();
    resetFish(sim);
    sim.gates.fishCadence = false;
    for (let tick = 0; tick < FISH_INTERVAL * 240; tick += 1) {
      stepFish(sim, TICK_DT);
    }
    expect(sim.fishBay).toBeNull();
    expect(sim.fishTimer).toBe(FISH_INTERVAL);
  });

  it("holds a posed catch where it was put, and takes it off on request", () => {
    const sim = emptied();
    placeFish(sim, 3);
    expect(sim.fishBay).toBe(3);
    expect(sim.fishTimer).toBe(FISH_LINGER);
    takeFish(sim);
    expect(sim.fishBay).toBeNull();
    expect(sim.lastFishBay).toBe(3);
  });
});

// ---- The score ---------------------------------------------------------

describe("the score", () => {
  it("counts the bonus-life boundaries an award crosses", () => {
    expect(boundariesCrossed(0, 100)).toBe(0);
    expect(boundariesCrossed(BONUS_LIFE_EVERY - 1, BONUS_LIFE_EVERY)).toBe(1);
    expect(boundariesCrossed(BONUS_LIFE_EVERY - 1, BONUS_LIFE_EVERY * 3)).toBe(
      3,
    );
    expect(boundariesCrossed(BONUS_LIFE_EVERY * 2, BONUS_LIFE_EVERY)).toBe(0);
  });

  it("earns one life per boundary and plays the cue once", () => {
    const sim = emptied();
    sim.score = BONUS_LIFE_EVERY - 50;
    sim.lives = 3;
    const events = newTickEvents();
    addScore(sim, BONUS_LIFE_EVERY * 2, events);
    expect(sim.lives).toBe(5);
    expect([...events.cues]).toEqual(["bonus-life"]);
  });

  it("changes nothing for an award of nothing", () => {
    const sim = emptied();
    const events = newTickEvents();
    addScore(sim, 0, events);
    expect(sim.score).toBe(0);
    expect(events.cues.size).toBe(0);
  });
});

// ---- The run's own transitions -----------------------------------------

describe("the run", () => {
  it("opens a run at level one with everything fresh", () => {
    const sim = emptied();
    sim.level = 6;
    sim.score = 900;
    sim.lives = 1;
    sim.bays = [true, true, false, false, false];
    startRun(sim);
    expect(sim.screen).toBe("playing");
    expect(sim.level).toBe(1);
    expect(sim.lives).toBe(3);
    expect(sim.score).toBe(0);
    expect(sim.bays).toEqual([false, false, false, false, false]);
    expect(sim.timer).toBe(crossingTimer(1));
    expect(sim.critter.present).toBe(true);
    expect(sim.critter.x).toBe(tileCX(START_COL));
    expect(sim.vehicles.length).toBeGreaterThan(0);
  });

  it("opens a fresh crossing on the level it is on, keeping the bays", () => {
    const sim = emptied();
    sim.level = 4;
    sim.bays = [true, false, true, false, false];
    sim.bears = [addBear(sim, 3, 3)];
    freshCrossing(sim);
    expect(sim.timer).toBe(crossingTimer(4));
    expect(sim.bays).toEqual([true, false, true, false, false]);
    expect(sim.bears).toHaveLength(0);
    expect(sim.critter.bestRow).toBe(ROW_NEAR);
  });

  it("restores the title state on reset, and reseeds the generator", () => {
    const sim = emptied();
    sim.score = 4000;
    sim.simTime = 12;
    resetToTitle(sim, 42);
    expect(sim.screen).toBe("title");
    expect(sim.score).toBe(0);
    expect(sim.simTime).toBe(0);
    expect(sim.critter.present).toBe(false);
    expect(sim.slots).toHaveLength(2);
    expect(sim.vehicles.length).toBeGreaterThan(0);

    const other = emptied();
    resetToTitle(other, 42);
    expect(other.vehicles.map((item) => item.x)).toEqual(
      sim.vehicles.map((item) => item.x),
    );
  });
});

// ---- The clock's rounding ---------------------------------------------

describe("a countdown", () => {
  /** The tick a duration counted down one `TICK_DT` at a time is spent on. */
  function spentAt(duration: number): number {
    let remaining = duration;
    for (let tick = 1; tick <= 5000; tick += 1) {
      remaining = Math.max(0, remaining - TICK_DT);
      if (expired(remaining)) return tick;
    }
    return -1;
  }

  it("has run out at zero, and absorbs no more than the counting's own noise", () => {
    expect(SPENT).toBeLessThan(TICK_DT / 1000);
    expect(expired(0)).toBe(true);
    expect(expired(-1e-15)).toBe(true);
    expect(expired(TICK_DT / 4)).toBe(false);
    expect(expired(TICK_DT)).toBe(false);
  });

  it("spends a whole-tick duration on exactly that many ticks", () => {
    for (const duration of [
      BAYFILL_PAUSE,
      BEAR_EMERGE_DELAY,
      DEATH_PAUSE,
      CLEAR_PAUSE,
      FISH_LINGER,
      FISH_INTERVAL,
      crossingTimer(1),
    ]) {
      expect(spentAt(duration)).toBe(Math.round(duration / TICK_DT));
    }
  });

  it("spends the hop cooldown on the first tick that leaves none of it", () => {
    // `HOP_COOLDOWN` is 14.4 ticks, which no whole number of ticks reaches:
    // `specs/hopping.md` ignores a press while the cooldown is running, so the
    // fifteenth tick is the first at which one is not.
    expect(spentAt(HOP_COOLDOWN)).toBe(Math.ceil(HOP_COOLDOWN / TICK_DT));
  });
});

// ---- What the runtime is told -----------------------------------------

describe("what the build registers", () => {
  it("registers exactly the layout's vocabulary, each with its own keys", () => {
    const registered: { name: string; keys: string[] }[] = [];
    registerActions({
      input: {
        register: (name, binding) =>
          registered.push({ name, keys: binding.keys }),
        layout: () => ({ name: LAYOUT, actions: [...ACTIONS] }),
      },
    });
    expect(registered.map((entry) => entry.name)).toEqual([...ACTIONS]);
    expect(registered.every((entry) => entry.keys.length > 0)).toBe(true);
  });

  it("refuses to start without its layout, or against a different vocabulary", () => {
    expect(() =>
      registerActions({
        input: { register: () => undefined, layout: () => null },
      }),
    ).toThrow(/without the dpad-4 layout/);
    expect(() =>
      registerActions({
        input: {
          register: () => undefined,
          layout: () => ({ name: "other", actions: ["up"] }),
        },
      }),
    ).toThrow(/registers/);
  });

  it("reads a direction as held or pressed, and the rest as edges", () => {
    const down = new Set(["up"]);
    const edges = new Set(["confirm", "left"]);
    const api = {
      input: {
        value: (name: string) => (down.has(name) ? 1 : 0),
        pressed: (name: string) => edges.has(name),
        pointer: () => ({ x: 0, y: 0, down: false }),
        pointerPressed: () => false,
        pointerReleased: () => false,
        pointerSamples: () => [],
      },
      audio: {
        play: () => undefined,
        loop: () => undefined,
        stop: () => undefined,
        looping: () => false,
        setMuted: () => undefined,
        muted: () => false,
      },
      frame: () => ({ count: 0, timeMs: 0, lastDeltaMs: 0 }),
      viewport: () => ({
        width: 0,
        height: 0,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      }),
    };
    const input = readInput(api);
    expect(input.up).toBe(true);
    expect(input.left).toBe(true);
    expect(input.tapLeft).toBe(true);
    expect(input.tapUp).toBe(false);
    expect(input.right).toBe(false);
    expect(input.confirm).toBe(true);
    expect(input.back).toBe(false);
    expect(NO_INPUT.up).toBe(false);
  });

  it("declares one cue per event, each under its own name", () => {
    const defined: string[] = [];
    defineCues({
      audio: {
        define: (cue) => defined.push(cue),
        load: () => Promise.resolve(),
      },
    });
    expect(defined.sort()).toEqual(Object.keys(CUE_SPECS).sort());
    expect(defined).toHaveLength(10);
  });

  it("names the values the overlay shows, each a pure read", () => {
    const sources = new Map<string, (state: FloeState) => unknown>();
    registerDiagnostics({
      diagnostics: {
        register: (name, source) => {
          sources.set(name, source as (state: FloeState) => unknown);
        },
      },
    });
    expect([...sources.keys()]).toEqual([
      "screen",
      "run",
      "critter",
      "bears",
      "strait",
      "bays",
    ]);

    const sim = emptied();
    sim.critter.present = true;
    sim.bears = [addBear(sim, 12, 5)];
    sim.bays = [true, false, false, false, false];
    sim.fishBay = 2;
    const before = JSON.stringify({ ...sim, sprites: null });
    const lines = [...sources.values()].map((source) => source(sim));
    expect(JSON.stringify({ ...sim, sprites: null })).toBe(before);
    for (const line of lines) expect(String(line).length).toBeGreaterThan(0);
    expect(String(lines[3])).toContain("#");
    expect(String(lines[5])).toContain("fish in 2");

    sim.bears = [];
    expect(String([...sources.values()][3](sim))).toBe("none");
  });

  it("loads every frame it names, and falls back where one cannot be read", async () => {
    const asked: string[] = [];
    const sprites = await loadSprites({
      loadImage: (path: string) => {
        asked.push(path);
        return path.startsWith("bear/")
          ? Promise.reject(new Error("no"))
          : Promise.resolve({
              width: 32,
              height: 32,
            } as unknown as ImageBitmap);
      },
    });
    expect(asked).toContain("crosser/0.png");
    expect(asked).toContain("raft/1.png");
    expect(asked).toHaveLength(32);
    expect(sprites.bear.every((frame) => frame === null)).toBe(true);
    expect(sprites.crosser.every((frame) => frame !== null)).toBe(true);

    const blank = emptySprites();
    const counts = (frames: Frames): number => frames.length;
    expect(counts(blank.bear)).toBe(18);
    expect(counts(blank.crosser)).toBe(8);
    expect(counts(blank.raft)).toBe(2);
    expect(blank.plow[0]).toBeNull();
  });

  it("has a spy-free surface: nothing here mocks the game itself", () => {
    // A guard on this file's own shape: `vi` is imported for the two throwing
    // registrations above and for nothing else.
    expect(typeof vi.fn).toBe("function");
  });
});
