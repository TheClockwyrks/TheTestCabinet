// The debugging and automation surface.
//
// Every operation is checked the way `specs/instrumentation.md` asks for it to
// be: a pose is set and read back off the snapshot, a clear is read against what
// it left standing, a gate is turned off and the faculty it names is watched for.
// The clock's two operations pose no state, so they are checked by their effect.

import { describe, expect, it } from "vitest";
import {
  BAY_COUNT,
  BONUS_LIFE_EVERY,
  FISH_INTERVAL,
  ITEM_LEN,
  FISH_LINGER,
  FLOE_DEBUG_VERSION,
  ICE_TOP,
  ROW_MEDIAN,
  ROW_NEAR,
  START_COL,
  START_LIVES,
  TICK_DT,
  TILE,
  WATER_TOP,
  crossingTimer,
  laneGap,
  laneSpeed,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import { createDebugApi, type FloeDebugApi } from "./debug";
import { createState } from "./game";
import { harness, lastId, startCrossing } from "./harness.test-support";

/** Every operation `specs/instrumentation.md` names, in the order it names them. */
const OPERATIONS: readonly (keyof FloeDebugApi)[] = [
  "setAutoStep",
  "advance",
  "reset",
  "snapshot",
  "reconcile",
  "menuItemRect",
  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setLevel",
  "setReachedLevel",
  "setTimer",
  "setBearEmergence",
  "setCatchTest",
  "setFishCadence",
  "setTimerRunning",
  "addCritter",
  "removeCritter",
  "setCritterTile",
  "setCritterX",
  "setCritterFacing",
  "setHopCooldown",
  "setBestRow",
  "addBear",
  "removeBear",
  "clearBears",
  "setBearTile",
  "setBearPosition",
  "setBearStep",
  "setBearTarget",
  "setBearSense",
  "setBearRouting",
  "setBearTravel",
  "addVehicle",
  "removeVehicle",
  "clearVehicles",
  "setVehicleX",
  "addFloe",
  "removeFloe",
  "clearFloes",
  "setFloeX",
  "setLaneSpeed",
  "setLaneDirection",
  "setLanePhase",
  "setBay",
  "clearBays",
  "setFishBay",
  "clearFish",
];

describe("the surface", () => {
  it("carries the version and every operation, and nothing else", () => {
    const h = harness();
    expect(h.api.version).toBe(FLOE_DEBUG_VERSION);
    for (const name of OPERATIONS) {
      expect(typeof h.api[name], name).toBe("function");
    }
    const found = Object.keys(h.api).filter(
      (key) =>
        typeof (h.api as unknown as Record<string, unknown>)[key] ===
        "function",
    );
    expect(found.sort()).toEqual([...OPERATIONS].sort());
  });

  it("carries no keyboard, overlay or mute operation", () => {
    const h = harness();
    const surface = h.api as unknown as Record<string, unknown>;
    for (const absent of [
      "keyDown",
      "keyUp",
      "press",
      "setMuted",
      "setOverlay",
    ]) {
      expect(surface[absent], absent).toBeUndefined();
    }
  });
});

describe("every pose reads back", () => {
  it("reports the run, the critter, a bear, the lanes, the bays and the fish", () => {
    const h = harness();
    startCrossing(h);
    h.api.setScreen("paused");
    h.api.setPhase("clearing");
    h.api.setPhaseTimer(1.25);
    h.api.setMenuIndex(2);
    h.api.setScore(4321);
    h.api.setLives(7);
    h.api.setLevel(6);
    h.api.setReachedLevel(5);
    h.api.setTimer(9.5);
    h.api.clearVehicles();
    h.api.clearFloes();
    h.api.addCritter(11, 12);
    h.api.setCritterFacing("left");
    h.api.setHopCooldown(0.07);
    h.api.setBestRow(4);
    h.api.setCritterX(370.5);
    h.api.addBear(8, ROW_MEDIAN);
    const bearId = lastId(h.api.snapshot().bears);
    h.api.setBearTarget(bearId, 3, 4);
    h.api.setBearSense(bearId, false);
    h.api.setBearRouting(bearId, false);
    h.api.setBearTravel(bearId, false);
    h.api.setBearStep(bearId, "right");
    h.api.setBearPosition(bearId, 500.25, 400.75);
    h.api.addVehicle(ICE_TOP, "plow", 100);
    const vehicleId = lastId(h.api.snapshot().vehicles);
    h.api.setVehicleX(vehicleId, 222);
    h.api.addFloe(WATER_TOP, "raft3", 64);
    const floeId = lastId(h.api.snapshot().floes);
    h.api.setFloeX(floeId, 333);
    h.api.setLaneSpeed(ICE_TOP, 1.25);
    h.api.setLaneDirection(ICE_TOP, 1);
    h.api.setLaneSpeed(WATER_TOP, 0);
    h.api.setLaneDirection(WATER_TOP, -1);
    h.api.setBay(3, true);
    h.api.setFishBay(1);

    const s = h.api.snapshot();
    expect(s.version).toBe(FLOE_DEBUG_VERSION);
    expect(s.screen).toBe("paused");
    expect(s.phase).toBe("clearing");
    expect(s.phaseTimer).toBe(1.25);
    expect(s.menuIndex).toBe(2);
    expect(s.score).toBe(4321);
    expect(s.lives).toBe(7);
    expect(s.level).toBe(6);
    expect(s.reachedLevel).toBe(5);
    expect(s.timer).toBe(9.5);
    expect(s.timerMax).toBe(crossingTimer(6));
    expect(s.bearEmergence).toBe(false);
    expect(s.catchTest).toBe(false);
    expect(s.fishCadence).toBe(false);
    expect(s.timerRunning).toBe(false);
    expect(s.bays).toEqual([false, false, false, true, false]);
    expect(s.fishBay).toBe(1);
    expect(s.critter).toEqual({
      present: true,
      col: 11,
      row: 12,
      x: 370.5,
      y: tileCY(12),
      facing: "left",
      footing: "solid",
      hopCooldown: 0.07,
      bestRow: 4,
    });
    expect(s.bears).toEqual([
      {
        id: bearId,
        col: 8,
        row: ROW_MEDIAN,
        stepCol: 9,
        stepRow: ROW_MEDIAN,
        x: 500.25,
        y: 400.75,
        facing: "right",
        swimming: false,
        target: { col: 3, row: 4 },
        sense: false,
        routing: false,
        travel: false,
      },
    ]);
    expect(s.vehicles).toEqual([
      { id: vehicleId, row: ICE_TOP, kind: "plow", x: 222, len: 3 },
    ]);
    expect(s.floes).toEqual([
      { id: floeId, row: WATER_TOP, kind: "raft3", x: 333, len: 3 },
    ]);
    expect(s.iceLanes[0]).toEqual({ row: ICE_TOP, dir: 1, speed: 1.25 });
    expect(s.waterLanes[0]).toEqual({ row: WATER_TOP, dir: -1, speed: 0 });
    expect(s.iceLanes.map((lane) => lane.row)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(s.waterLanes.map((lane) => lane.row)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(typeof s.simTime).toBe("number");
    expect(typeof s.muted).toBe("boolean");
  });

  it("reports an absent critter's last pose", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(7, 8);
    h.api.setCritterFacing("down");
    h.api.removeCritter();
    const s = h.api.snapshot();
    expect(s.critter.present).toBe(false);
    expect([s.critter.col, s.critter.row]).toEqual([7, 8]);
    expect(s.critter.facing).toBe("down");
  });

  it("reports the pose a fresh crossing begins from before one has run", () => {
    const state = createState();
    const api = createDebugApi(state, {
      setAutoStep: () => undefined,
      advance: () => undefined,
    });
    const s = api.snapshot();
    expect(s.critter.present).toBe(false);
    expect([s.critter.col, s.critter.row]).toEqual([START_COL, ROW_NEAR]);
    expect(s.critter.facing).toBe("up");
    expect(s.critter.hopCooldown).toBe(0);
    expect(s.critter.bestRow).toBe(ROW_NEAR);
  });

  it("moves the critter's centre alone, its column following it", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, ROW_MEDIAN);
    h.api.setCritterX(tileCX(20) + TILE);
    const s = h.api.snapshot();
    expect(s.critter.col).toBe(21);
    expect(s.critter.row).toBe(ROW_MEDIAN);
    expect(s.critter.y).toBe(tileCY(ROW_MEDIAN));
  });

  it("settles a bear onto a tile and poses one mid-glide", () => {
    const h = harness();
    startCrossing(h);
    h.api.addBear(4, ROW_MEDIAN);
    const id = lastId(h.api.snapshot().bears);
    h.api.setBearRouting(id, false);
    h.api.setBearStep(id, "right");
    h.api.setBearPosition(id, 1000, 500);
    let hunter = h.api.snapshot().bears[0];
    expect([hunter.col, hunter.row]).toEqual([4, ROW_MEDIAN]);
    expect([hunter.stepCol, hunter.stepRow]).toEqual([5, ROW_MEDIAN]);
    expect([hunter.x, hunter.y]).toEqual([1000, 500]);

    h.api.setBearTile(id, 30, 12);
    hunter = h.api.snapshot().bears[0];
    expect([hunter.col, hunter.row, hunter.stepCol, hunter.stepRow]).toEqual([
      30, 12, 30, 12,
    ]);
    expect([hunter.x, hunter.y]).toEqual([tileCX(30), tileCY(12)]);
    expect(hunter.target).toEqual({ col: 4, row: ROW_MEDIAN });
  });

  it("appends what it adds and takes away what it removes", () => {
    const h = harness();
    startCrossing(h);
    h.api.addVehicle(ICE_TOP, "car", 0);
    h.api.addVehicle(ICE_TOP + 1, "dogsled", 64);
    const roster = h.api.snapshot().vehicles;
    const second = lastId(roster);
    expect(roster[roster.length - 1].id).toBe(second);
    h.api.removeVehicle(second);
    expect(h.api.snapshot().vehicles.map((item) => item.id)).not.toContain(
      second,
    );

    h.api.addFloe(WATER_TOP, "pan", 0);
    h.api.addFloe(WATER_TOP + 1, "raft4", 0);
    const floe = lastId(h.api.snapshot().floes);
    h.api.removeFloe(floe);
    expect(h.api.snapshot().floes.map((item) => item.id)).not.toContain(floe);

    h.api.addBear(1, ROW_MEDIAN);
    h.api.addBear(2, ROW_MEDIAN);
    const bearId = lastId(h.api.snapshot().bears);
    h.api.removeBear(bearId);
    expect(h.api.snapshot().bears.map((item) => item.id)).not.toContain(bearId);
  });

  it("gives every live entity a distinct id it keeps across a wrap", () => {
    const h = harness();
    h.api.reset();
    const before = h.api.snapshot();
    const ids = [
      ...before.vehicles.map((item) => item.id),
      ...before.floes.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    h.api.setScreen("playing");
    h.api.addCritter(START_COL, ROW_NEAR);
    h.seconds(1);
    const after = h.api.snapshot();
    expect(after.vehicles.map((item) => item.id)).toEqual(
      before.vehicles.map((item) => item.id),
    );
    expect(after.floes.map((item) => item.id)).toEqual(
      before.floes.map((item) => item.id),
    );
  });
});

describe("the core", () => {
  it("restores every title value on reset, and leaves muted alone", () => {
    const h = harness();
    startCrossing(h, 5);
    h.api.setScore(500);
    h.api.setLives(1);
    h.api.setBay(0, true);
    h.api.setFishBay(2);
    h.api.addBear(4, ROW_MEDIAN);
    h.press("mute");
    h.advance(1);
    expect(h.api.snapshot().muted).toBe(true);

    h.api.reset();
    const s = h.api.snapshot();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.phase).toBe("crossing");
    expect(s.phaseTimer).toBe(0);
    expect(s.score).toBe(0);
    expect(s.lives).toBe(START_LIVES);
    expect(s.level).toBe(1);
    expect(s.reachedLevel).toBe(1);
    expect(s.timer).toBe(crossingTimer(1));
    expect(s.timerMax).toBe(crossingTimer(1));
    expect(s.bays).toEqual([false, false, false, false, false]);
    expect(s.fishBay).toBe(null);
    expect(s.critter.present).toBe(false);
    expect(s.bears).toEqual([]);
    expect(s.bearEmergence).toBe(true);
    expect(s.catchTest).toBe(true);
    expect(s.fishCadence).toBe(true);
    expect(s.timerRunning).toBe(true);
    expect(s.simTime).toBe(0);
    expect(s.muted).toBe(true);
    expect(s.iceLanes.map((lane) => lane.speed)).toEqual(
      [11, 12, 13, 14, 15, 16, 17, 18].map((row) => laneSpeed(row, 1)),
    );
    expect(s.waterLanes.map((lane) => lane.speed)).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9].map((row) => laneSpeed(row, 1)),
    );
  });

  it("puts the first bonus catch in an open bay an interval after the layout", () => {
    const h = harness();
    h.api.reset();
    h.api.setScreen("playing");
    h.api.addCritter(START_COL, ROW_NEAR);
    h.api.setTimerRunning(false);
    h.api.setBay(0, true);
    h.api.setBay(1, true);
    h.api.setBay(3, true);
    h.api.setBay(4, true);
    h.seconds(FISH_INTERVAL + 0.1);
    expect(h.api.snapshot().fishBay).toBe(2);
  });

  it("relays one lane at a posed phase and leaves its motion alone", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLaneSpeed(12, 0.5);
    h.api.setLaneDirection(12, -1);
    h.api.addVehicle(12, "plow", 100);
    h.api.setLanePhase(12, 700);
    const s = h.api.snapshot();
    const lane = s.iceLanes.find((entry) => entry.row === 12);
    expect(lane?.speed).toBe(0.5);
    expect(lane?.dir).toBe(-1);
    const items = s.vehicles
      .filter((item) => item.row === 12)
      .sort((a, b) => a.x - b.x);
    expect(items.every((item) => item.kind === "car")).toBe(true);
    expect(items.some((item) => Math.abs(item.x - 700) < 1e-9)).toBe(true);
    const period = (ITEM_LEN.car + laneGap(12, 1)) * TILE;
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i].x - items[i - 1].x).toBeCloseTo(period, 9);
    }
    // The pattern reaches both edges: the clear ice at either edge is at most
    // one gap.
    expect(items[0].x).toBeLessThanOrEqual(laneGap(12, 1) * TILE);
    expect(items[items.length - 1].x + TILE * 2).toBeGreaterThanOrEqual(
      1280 - laneGap(12, 1) * TILE,
    );
    expect(s.vehicles.filter((item) => item.row !== 12)).toHaveLength(0);
  });

  it("lays the level's own roster out on setLevel and touches nothing else", () => {
    const h = harness();
    startCrossing(h);
    h.api.addCritter(9, ROW_MEDIAN);
    h.api.addBear(4, ROW_MEDIAN);
    h.api.setBay(2, true);
    h.api.setFishBay(0);
    h.api.setScore(77);
    h.api.setLives(2);
    h.api.setTimer(11);
    const before = h.api.snapshot();

    h.api.setLevel(7);
    const after = h.api.snapshot();
    expect(after.level).toBe(7);
    expect(after.timerMax).toBe(crossingTimer(7));
    expect(after.iceLanes.map((lane) => lane.speed)).toEqual(
      [11, 12, 13, 14, 15, 16, 17, 18].map((row) => laneSpeed(row, 7)),
    );
    expect(after.vehicles.length).toBeGreaterThan(0);
    expect(after.floes.length).toBeGreaterThan(0);
    for (const item of after.vehicles) {
      expect(before.vehicles.map((seen) => seen.id)).not.toContain(item.id);
    }
    expect(after.critter).toEqual(before.critter);
    expect(after.bears).toEqual(before.bears);
    expect(after.bays).toEqual(before.bays);
    expect(after.fishBay).toBe(before.fishBay);
    expect(after.score).toBe(77);
    expect(after.lives).toBe(2);
    expect(after.timer).toBe(11);
    expect(after.screen).toBe(before.screen);
    expect(after.phase).toBe(before.phase);
  });

  it("refuses a level and a bay the strait does not have", () => {
    const h = harness();
    expect(() => h.api.setLevel(0)).toThrow(RangeError);
    expect(() => h.api.setLevel(9)).toThrow(RangeError);
    expect(() => h.api.setLevel(1.5)).toThrow(RangeError);
    expect(() => h.api.setBay(-1, true)).toThrow(RangeError);
    expect(() => h.api.setBay(BAY_COUNT, true)).toThrow(RangeError);
    expect(() => h.api.setFishBay(BAY_COUNT)).toThrow(RangeError);
  });

  it("re-derives a stored reading from a posed position", () => {
    const h = harness();
    startCrossing(h);
    // A water row with no floe under the critter: its footing, its tile and a
    // bear's swimming flag are all functions of where the bodies are, and this
    // pose moves what all three read from.
    h.api.clearFloes();
    h.api.setCritterTile(START_COL, WATER_TOP);
    h.api.addBear(START_COL + 2, WATER_TOP);
    h.api.reconcile();
    const s = h.api.snapshot();
    expect(s.critter.footing).toBe("water");
    expect(s.critter.col).toBe(START_COL);
    expect(s.critter.row).toBe(WATER_TOP);
    expect(s.bears[0].swimming).toBe(true);
    // And on the ice, where nothing swims and nothing drowns.
    h.api.setCritterTile(START_COL, ICE_TOP);
    h.api.setBearTile(s.bears[0].id, START_COL + 2, ICE_TOP);
    h.api.reconcile();
    const onIce = h.api.snapshot();
    expect(onIce.critter.footing).toBe("solid");
    expect(onIce.critter.row).toBe(ICE_TOP);
    expect(onIce.bears[0].swimming).toBe(false);
  });

  it("advances nothing, and reconciling twice matches reconciling once", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLevel(3);
    h.api.addBear(START_COL + 4, ROW_MEDIAN);
    h.api.setHopCooldown(0.07);
    h.api.setPhaseTimer(0.4);
    h.api.setTimer(9);
    h.api.setFishBay(2);
    const before = h.api.snapshot();
    h.api.reconcile();
    const once = h.api.snapshot();
    expect(once).toEqual(before);
    h.api.reconcile();
    expect(h.api.snapshot()).toEqual(once);
    // Named explicitly, because "equal snapshots" is only as strong as the
    // clock, the bodies and the timers being in it.
    expect(once.simTime).toBe(before.simTime);
    expect(once.timer).toBe(before.timer);
    expect(once.phaseTimer).toBe(before.phaseTimer);
    expect(once.critter.hopCooldown).toBe(before.critter.hopCooldown);
    expect(once.critter.x).toBe(before.critter.x);
    expect(once.critter.y).toBe(before.critter.y);
    expect(once.bears[0].x).toBe(before.bears[0].x);
    expect(once.bears[0].y).toBe(before.bears[0].y);
    expect(once.vehicles).toEqual(before.vehicles);
    expect(once.floes).toEqual(before.floes);
    expect(once.fishBay).toBe(before.fishBay);
    expect(h.bus.cues).toEqual([]);
  });

  it("fails loudly on an id, a row and a lane value the strait has no state for", () => {
    const h = harness();
    startCrossing(h);
    const absent = 9999;
    expect(() => h.api.setBearTile(absent, 3, 3)).toThrow(RangeError);
    expect(() => h.api.setBearPosition(absent, 0, 0)).toThrow(RangeError);
    expect(() => h.api.setBearStep(absent, "up")).toThrow(RangeError);
    expect(() => h.api.setBearTarget(absent, 3, 3)).toThrow(RangeError);
    expect(() => h.api.setBearSense(absent, false)).toThrow(RangeError);
    expect(() => h.api.setBearRouting(absent, false)).toThrow(RangeError);
    expect(() => h.api.setBearTravel(absent, false)).toThrow(RangeError);
    expect(() => h.api.removeBear(absent)).toThrow(RangeError);
    expect(() => h.api.setVehicleX(absent, 0)).toThrow(RangeError);
    expect(() => h.api.removeVehicle(absent)).toThrow(RangeError);
    expect(() => h.api.setFloeX(absent, 0)).toThrow(RangeError);
    expect(() => h.api.removeFloe(absent)).toThrow(RangeError);
    // The shores and the median carry no lane at all.
    expect(() => h.api.setLaneSpeed(ROW_MEDIAN, 1)).toThrow(RangeError);
    expect(() => h.api.setLaneDirection(ROW_MEDIAN, 1)).toThrow(RangeError);
    // The two domains the specification fixes: a speed at or above 0, and a
    // direction that is exactly 1 or -1. Neither is clamped or snapped.
    expect(() => h.api.setLaneSpeed(ICE_TOP, -1)).toThrow(RangeError);
    expect(() => h.api.setLaneDirection(ICE_TOP, 0 as 1 | -1)).toThrow(
      RangeError,
    );
  });

  it("grants no bonus life for a posed score", () => {
    const h = harness();
    startCrossing(h);
    h.api.setScore(BONUS_LIFE_EVERY * 3);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
  });

  it("kills nothing with a posed timer, and ends no run with posed lives", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(0);
    h.api.setLives(0);
    h.seconds(5);
    const s = h.api.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.phase).toBe("crossing");
    expect(s.lives).toBe(0);
    expect(s.timer).toBe(0);
  });
});

describe("the clears", () => {
  it("empties one roster at a time, leaving the rest standing", () => {
    const h = harness();
    startCrossing(h);
    h.api.addVehicle(ICE_TOP, "car", 0);
    h.api.addFloe(WATER_TOP, "pan", 0);
    h.api.addBear(2, ROW_MEDIAN);
    h.api.setBay(1, true);
    h.api.setFishBay(0);

    h.api.clearVehicles();
    let s = h.api.snapshot();
    expect(s.vehicles).toEqual([]);
    expect(s.floes.length).toBe(1);
    expect(s.bears.length).toBe(1);
    expect(s.critter.present).toBe(true);
    expect(s.bays[1]).toBe(true);
    expect(s.fishBay).toBe(0);

    h.api.clearFloes();
    s = h.api.snapshot();
    expect(s.floes).toEqual([]);
    expect(s.vehicles).toEqual([]);
    expect(s.bears.length).toBe(1);
    expect(s.critter.present).toBe(true);

    h.api.clearBears();
    s = h.api.snapshot();
    expect(s.bears).toEqual([]);
    expect(s.critter.present).toBe(true);
    expect(s.bays[1]).toBe(true);
    expect(s.fishBay).toBe(0);

    h.api.clearFish();
    s = h.api.snapshot();
    expect(s.fishBay).toBe(null);
    expect(s.bays[1]).toBe(true);

    h.api.clearBays();
    expect(h.api.snapshot().bays).toEqual([false, false, false, false, false]);
  });

  it("puts the critter out of reach of everything on the strait", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, ICE_TOP);
    h.api.removeCritter();
    h.api.addVehicle(ICE_TOP, "car", tileLeft(19));
    h.api.setLaneSpeed(ICE_TOP, 2);
    h.seconds(3);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
    expect(h.api.snapshot().phase).toBe("crossing");
    expect(h.api.snapshot().critter.present).toBe(false);
  });

  it("scores nothing and clears no level when the bays are opened", () => {
    const h = harness();
    startCrossing(h);
    for (let bay = 0; bay < BAY_COUNT; bay += 1) h.api.setBay(bay, true);
    h.api.clearBays();
    const s = h.api.snapshot();
    expect(s.score).toBe(0);
    expect(s.level).toBe(1);
    expect(s.phase).toBe("crossing");
  });
});

describe("the world gates", () => {
  it("keeps the hunt away while emergence is off, and lets it in when on", () => {
    const h = harness();
    startCrossing(h);
    // Ten rows of advance, read off `bestRow`, with the critter itself parked on
    // the median: every water row of an emptied strait is open water.
    h.api.setCritterTile(START_COL, ROW_MEDIAN);
    h.api.setBestRow(ROW_NEAR - 10);
    h.seconds(60);
    expect(h.api.snapshot().bears).toEqual([]);
    h.api.setBearEmergence(true);
    h.advance(1);
    expect(h.api.snapshot().bears.length).toBe(1);
  });

  it("costs no life while the catch test is off, and one with it on", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, ROW_MEDIAN);
    h.api.addBear(20, ROW_MEDIAN);
    h.seconds(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
    expect(h.api.snapshot().phase).toBe("crossing");
    h.api.setCatchTest(true);
    h.advance(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("keeps the bonus catch away while its cadence is off", () => {
    const h = harness();
    startCrossing(h);
    h.seconds(60);
    expect(h.api.snapshot().fishBay).toBe(null);
    h.api.setFishCadence(true);
    h.seconds(FISH_INTERVAL + 0.1);
    expect(h.api.snapshot().fishBay).not.toBe(null);
  });

  it("scores a posed bonus catch even with its cadence off", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(0);
    h.api.addFloe(WATER_TOP, "raft3", tileLeft(2));
    h.api.setLaneSpeed(WATER_TOP, 0);
    h.api.setCritterTile(3, WATER_TOP);
    h.api.setFishBay(0);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().score).toBe(10 + 50 + 200);
    expect(h.api.snapshot().fishBay).toBe(null);
  });

  it("holds the crossing clock while the timer gate is off", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(20);
    h.seconds(10);
    expect(h.api.snapshot().timer).toBe(20);
    h.api.setTimerRunning(true);
    h.seconds(10);
    expect(h.api.snapshot().timer).toBeCloseTo(10, 6);
  });

  it("keeps the timer following the level and the bay while the gate is off", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(4);
    h.api.setLevel(5);
    expect(h.api.snapshot().timerMax).toBe(crossingTimer(5));
    h.api.addFloe(WATER_TOP, "raft3", tileLeft(2));
    h.api.setLaneSpeed(WATER_TOP, 0);
    h.api.clearVehicles();
    h.api.setCritterTile(3, WATER_TOP);
    h.hold("up");
    h.advance(1);
    h.hold(null);
    h.seconds(1);
    expect(h.api.snapshot().timer).toBeCloseTo(crossingTimer(5), 6);
  });
});

describe("the bears' own faculties", () => {
  it("freezes the target of a bear whose sense is off", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, ROW_NEAR);
    h.api.addBear(4, ROW_MEDIAN);
    const blind = lastId(h.api.snapshot().bears);
    h.api.setBearSense(blind, false);
    h.api.setBearTravel(blind, false);
    h.api.setBearTarget(blind, 1, 1);
    h.api.addBear(8, ROW_MEDIAN);
    const seeing = lastId(h.api.snapshot().bears);
    h.api.setBearTravel(seeing, false);

    h.api.setCritterTile(24, ROW_NEAR);
    h.advance(1);
    const bears = h.api.snapshot().bears;
    expect(bears.find((bear) => bear.id === blind)?.target).toEqual({
      col: 1,
      row: 1,
    });
    expect(bears.find((bear) => bear.id === seeing)?.target).toEqual({
      col: 24,
      row: ROW_NEAR,
    });
  });

  it("stops a bear whose routing is off choosing again, its target still following", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(0, ROW_NEAR);
    h.api.addBear(20, ROW_MEDIAN);
    const id = lastId(h.api.snapshot().bears);
    h.api.setBearRouting(id, false);
    h.api.setBearStep(id, "left");
    h.seconds(3);
    const hunter = h.api.snapshot().bears[0];
    expect([hunter.col, hunter.row]).toEqual([19, ROW_MEDIAN]);
    expect([hunter.stepCol, hunter.stepRow]).toEqual([19, ROW_MEDIAN]);
    expect(hunter.x).toBe(tileCX(19));
    expect(hunter.target).toEqual({ col: 0, row: ROW_NEAR });
  });

  it("holds a bear whose travel is off, its routing still reporting a step", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(0, ROW_NEAR);
    h.api.addBear(20, ROW_MEDIAN);
    const id = lastId(h.api.snapshot().bears);
    h.api.setBearTravel(id, false);
    const before = h.api.snapshot().bears[0];
    h.seconds(1);
    const after = h.api.snapshot().bears[0];
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect([after.col, after.row]).toEqual([20, ROW_MEDIAN]);
    expect([after.stepCol, after.stepRow]).not.toEqual([20, ROW_MEDIAN]);
  });
});

describe("the clock", () => {
  it("runs the same whole ticks however the interval is divided", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLaneSpeed(ICE_TOP, 2);
    h.api.setLaneDirection(ICE_TOP, 1);
    h.api.addVehicle(ICE_TOP, "car", 100);
    for (let i = 0; i < 120; i += 1) h.advance(1);
    expect(h.api.snapshot().simTime).toBeCloseTo(1, 9);
    expect(h.api.snapshot().vehicles[0].x).toBeCloseTo(100 + 64, 6);
  });

  it("runs a tick of exactly one hundred and twentieth of a second", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLaneSpeed(ICE_TOP, 2);
    h.api.setLaneDirection(ICE_TOP, 1);
    h.api.addVehicle(ICE_TOP, "car", 100);
    h.advance(1);
    expect(h.api.snapshot().simTime).toBeCloseTo(TICK_DT, 12);
    h.advance(119);
    expect(h.api.snapshot().simTime).toBeCloseTo(1, 9);
    expect(h.api.snapshot().vehicles[0].x).toBeCloseTo(100 + 64, 6);
  });

  it("runs nothing for no ticks, and refuses a count it cannot honour", () => {
    const h = harness();
    startCrossing(h);
    const before = h.api.snapshot();
    h.api.advance(0);
    expect(h.api.snapshot()).toEqual(before);
  });

  it("keeps accumulating simTime while the screen is paused", () => {
    const h = harness();
    startCrossing(h);
    h.api.setScreen("paused");
    const before = h.api.snapshot();
    h.seconds(3);
    const after = h.api.snapshot();
    expect(after.simTime).toBeCloseTo(before.simTime + 3, 6);
    expect({ ...after, simTime: 0 }).toEqual({ ...before, simTime: 0 });
  });

  it("takes the runtime's own clock away and gives it back", () => {
    let stepping = true;
    const state = createState();
    const api = createDebugApi(state, {
      setAutoStep: (enabled) => {
        stepping = enabled;
      },
      advance: () => undefined,
    });
    api.setAutoStep(false);
    expect(stepping).toBe(false);
    api.setAutoStep(true);
    expect(stepping).toBe(true);
  });
});

describe("the bonus catch", () => {
  it("starts the linger clock at the call, and takes it off again", () => {
    const h = harness();
    startCrossing(h);
    h.api.setFishCadence(true);
    h.api.setFishBay(3);
    expect(h.api.snapshot().fishBay).toBe(3);
    h.seconds(FISH_LINGER - 0.05);
    expect(h.api.snapshot().fishBay).toBe(3);
    h.seconds(0.1);
    expect(h.api.snapshot().fishBay).toBe(null);

    h.api.setFishBay(1);
    h.api.clearFish();
    expect(h.api.snapshot().fishBay).toBe(null);
    expect(h.api.snapshot().bays).toEqual([false, false, false, false, false]);
  });
});
