// Floe under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` whose
// step is one simulation tick. What is read back is the engine's own object model
// — the world, its tagged actors, its game state — the debug surface the game
// instance returned from `initialize`, the engine's cue events, and the pixels the
// pipeline produced.
//
// The surface is read off `engine.debug`, never built here, so these checks hold
// the same seam a caller outside the build holds.

import { SpriteComponent } from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACTIONS,
  BAYS,
  BAY_COUNT,
  CUES,
  ENDING_ITEMS,
  FLOE_DEBUG_VERSION,
  HUD_H,
  ICE_LANES,
  ICE_TOP,
  PAUSE_ITEMS,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_H,
  STAGE_W,
  START_COL,
  START_LIVES,
  TAGS,
  TICK_DT,
  TICK_HZ,
  TILE,
  TITLE_ITEMS,
  TOTAL_LEVELS,
  WATER_LANES,
  crossingTimer,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import { BACKGROUND, type FloeSnapshotShape } from "./game";
import { createHarness, type Harness } from "./harness.test-support";
import { COLOR } from "./theme";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

/** An empty strait, playing, with nothing arriving that a check did not ask for. */
function empty(h: Harness): void {
  h.debug.setScreen("playing");
  h.debug.setPhase("crossing");
  h.debug.setPhaseTimer(0);
  h.debug.setBearEmergence(false);
  h.debug.setFishCadence(false);
  h.debug.setTimerRunning(false);
  h.debug.setCatchTest(false);
  h.debug.clearVehicles();
  h.debug.clearFloes();
  h.debug.clearBears();
  h.debug.clearBays();
  h.debug.clearFish();
}

/** A CSS hex colour as its three channels. */
function rgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** The distance between two colours, out of 441. */
function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * How far the drawn pixels over one tile get from the band around it, taking the
 * furthest sample of a grid over the tile: a sprite has transparent corners, so
 * what matters is that SOME of it reads apart, not all of it.
 */
function apart(
  h: Harness,
  at: readonly [number, number],
  band: readonly [number, number],
): number {
  const ground = h.pixel(band[0], band[1]);
  let furthest = 0;
  for (let dy = -10; dy <= 10; dy += 2) {
    for (let dx = -10; dx <= 10; dx += 2) {
      furthest = Math.max(
        furthest,
        distance(h.pixel(at[0] + dx, at[1] + dy), ground),
      );
    }
  }
  return furthest;
}

/**
 * Every field `specs/instrumentation.md` lists under Snapshot shape, sorted.
 * The snapshot carries these and nothing else.
 */
const SNAPSHOT_FIELDS = [
  "bays",
  "bearEmergence",
  "bears",
  "catchTest",
  "critter",
  "fishBay",
  "fishCadence",
  "floes",
  "iceLanes",
  "level",
  "lives",
  "menuIndex",
  "muted",
  "phase",
  "phaseTimer",
  "reachedLevel",
  "score",
  "screen",
  "simTime",
  "timer",
  "timerMax",
  "timerRunning",
  "vehicles",
  "version",
  "waterLanes",
].sort();

/**
 * Every operation `specs/instrumentation.md` names, sorted, beside `version`.
 * There is no clock operation, no keyboard operation and no `setMuted`: the
 * engine owns the clock, the keyboard and the overlay, and mute is reached
 * through the mute action.
 */
const SURFACE_MEMBERS = [
  "version",
  "reset",
  "snapshot",
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
].sort();

/** The names of the cues played, in order. */
function played(h: Harness): string[] {
  return h.cues.map((play) => play.cue);
}

describe("initialization", () => {
  it("opens the one level with the strait's actors in it", () => {
    const { engine } = harness;
    expect(engine.world.level).toBe("strait");
    expect(harness.assetFailures).toEqual([]);
    expect(engine.world.byTag(TAGS.critter)).toHaveLength(1);
    expect(engine.world.byTag(TAGS.vehicle).length).toBeGreaterThan(8);
    expect(engine.world.byTag(TAGS.floe).length).toBeGreaterThan(8);
    expect(engine.world.byTag(TAGS.bear)).toHaveLength(0);
    expect(engine.world.byTag(TAGS.fish)).toHaveLength(0);
    expect(engine.world.players()).toHaveLength(1);
    expect(engine.world.players()[0].pawn).toBeNull();
  });

  it("hands back a title-screen snapshot with every gate on", () => {
    const snapshot = harness.snapshot();
    expect(snapshot.version).toBe(FLOE_DEBUG_VERSION);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.phase).toBe("crossing");
    expect(snapshot.phaseTimer).toBe(0);
    expect(snapshot.level).toBe(1);
    expect(snapshot.reachedLevel).toBe(1);
    expect(snapshot.lives).toBe(START_LIVES);
    expect(snapshot.score).toBe(0);
    expect(snapshot.timer).toBe(crossingTimer(1));
    expect(snapshot.timerMax).toBe(crossingTimer(1));
    expect(snapshot.muted).toBe(false);
    expect(snapshot.bearEmergence).toBe(true);
    expect(snapshot.catchTest).toBe(true);
    expect(snapshot.fishCadence).toBe(true);
    expect(snapshot.timerRunning).toBe(true);
    expect(snapshot.bays).toEqual([false, false, false, false, false]);
    expect(snapshot.fishBay).toBeNull();
    expect(snapshot.bears).toEqual([]);
    expect(snapshot.simTime).toBe(0);
    expect(snapshot.critter).toMatchObject({
      present: false,
      col: START_COL,
      row: ROW_NEAR,
      facing: "up",
      hopCooldown: 0,
      bestRow: ROW_NEAR,
    });
  });

  it("takes the stage background from the game's own export", () => {
    expect(BACKGROUND).toBe(COLOR.background);
  });

  it("registers the eight actions and no keyboard reading of its own", () => {
    expect([...ACTIONS]).toEqual([
      "up",
      "down",
      "left",
      "right",
      "confirm",
      "back",
      "pause",
      "mute",
    ]);
    // The overlay's key is engine chrome rather than an action, and pressing it
    // changes nothing about the game.
    const before = harness.snapshot();
    harness.down("Backquote");
    harness.up("Backquote");
    expect(harness.snapshot()).toEqual(before);
  });
});

describe("the surface itself", () => {
  it("carries exactly the operations the specification names", () => {
    const surface = harness.debug as unknown as Record<string, unknown>;
    expect(Object.keys(surface).sort()).toEqual(SURFACE_MEMBERS);
    expect(surface.version).toBe(FLOE_DEBUG_VERSION);
    for (const name of SURFACE_MEMBERS) {
      if (name === "version") continue;
      expect(typeof surface[name]).toBe("function");
    }
  });

  it("is live: a posed critter and a stepped bear are where they were put", async () => {
    empty(harness);
    harness.debug.addCritter(7, 13);
    expect(harness.snapshot().critter).toMatchObject({ col: 7, row: 13 });

    harness.debug.addBear(7, ROW_MEDIAN);
    const id = harness.snapshot().bears[0].id;
    harness.debug.setBearRouting(id, false);
    harness.debug.setBearStep(id, "left");
    expect(harness.snapshot().bears[0]).toMatchObject({
      col: 7,
      stepCol: 6,
      facing: "left",
    });
    const arrived = await harness.until(
      () => harness.snapshot().bears[0].col === 6,
      TICK_HZ,
    );
    expect(arrived).toBe(true);
    expect(harness.snapshot().bears[0]).toMatchObject({
      col: 6,
      row: ROW_MEDIAN,
      stepCol: 6,
      stepRow: ROW_MEDIAN,
      x: tileCX(6),
      y: tileCY(ROW_MEDIAN),
    });
  });
});

describe("the snapshot's shape", () => {
  it("reports every documented field on a fully posed strait", async () => {
    empty(harness);
    harness.debug.addCritter(20, 5);
    harness.debug.setCritterFacing("left");
    harness.debug.setHopCooldown(0.05);
    harness.debug.setBestRow(7);
    harness.debug.addBear(4, 12);
    harness.debug.addBear(30, 15);
    for (const lane of ICE_LANES) {
      harness.debug.addVehicle(lane.row, "car", tileLeft(2));
    }
    for (const lane of WATER_LANES) {
      harness.debug.addFloe(lane.row, "pan", tileLeft(3));
    }
    harness.debug.setBay(2, true);
    harness.debug.setFishBay(4);
    harness.debug.setScore(1234);
    harness.debug.setLives(2);
    harness.debug.setReachedLevel(3);
    harness.debug.setPhase("clearing");
    harness.debug.setPhaseTimer(1.25);
    harness.debug.setMenuIndex(1);
    harness.debug.setTimer(9.5);
    await harness.step(1);

    const snapshot: FloeSnapshotShape = harness.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual(SNAPSHOT_FIELDS);
    expect(snapshot.iceLanes).toHaveLength(ICE_LANES.length);
    expect(snapshot.waterLanes).toHaveLength(WATER_LANES.length);
    expect(snapshot.bears).toHaveLength(2);
    expect(snapshot.bays).toHaveLength(BAY_COUNT);
    expect(snapshot.fishBay).toBe(4);
    for (const bear of snapshot.bears) {
      expect(typeof bear.id).toBe("number");
      expect(typeof bear.swimming).toBe("boolean");
      expect(typeof bear.target.col).toBe("number");
    }
    for (const item of [...snapshot.vehicles, ...snapshot.floes]) {
      expect(typeof item.id).toBe("number");
      expect(typeof item.x).toBe("number");
      expect(typeof item.len).toBe("number");
    }
    expect(snapshot.critter.footing).toBe("water");
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("reads every pose back off the snapshot", () => {
    empty(harness);
    harness.debug.setScreen("paused");
    harness.debug.setPhase("dying");
    harness.debug.setPhaseTimer(0.4);
    harness.debug.setMenuIndex(2);
    harness.debug.setScore(777);
    harness.debug.setLives(5);
    harness.debug.setReachedLevel(6);
    harness.debug.setTimer(3.5);
    harness.debug.setBearEmergence(false);
    harness.debug.setCatchTest(false);
    harness.debug.setFishCadence(false);
    harness.debug.setTimerRunning(false);
    harness.debug.addCritter(9, 12);
    harness.debug.setCritterFacing("right");
    harness.debug.setHopCooldown(0.07);
    harness.debug.setBestRow(11);
    harness.debug.addBear(3, 14);
    const id = harness.snapshot().bears[0].id;
    harness.debug.setBearTarget(id, 8, 8);
    harness.debug.setBearSense(id, false);
    harness.debug.addVehicle(11, "dogsled", 288);
    harness.debug.addFloe(4, "raft3", 320);
    harness.debug.setLaneSpeed(11, 1.25);
    harness.debug.setLaneDirection(11, 1);
    harness.debug.setBay(1, true);
    harness.debug.setFishBay(0);

    const snapshot = harness.snapshot();
    expect(snapshot).toMatchObject({
      screen: "paused",
      phase: "dying",
      phaseTimer: 0.4,
      menuIndex: 2,
      score: 777,
      lives: 5,
      reachedLevel: 6,
      timer: 3.5,
      bearEmergence: false,
      catchTest: false,
      fishCadence: false,
      timerRunning: false,
      fishBay: 0,
    });
    expect(snapshot.critter).toMatchObject({
      present: true,
      col: 9,
      row: 12,
      facing: "right",
      hopCooldown: 0.07,
      bestRow: 11,
    });
    expect(snapshot.bears[0]).toMatchObject({
      col: 3,
      row: 14,
      target: { col: 8, row: 8 },
      sense: false,
    });
    expect(snapshot.vehicles[0]).toMatchObject({
      row: 11,
      kind: "dogsled",
      x: 288,
      len: 2,
    });
    expect(snapshot.floes[0]).toMatchObject({ row: 4, kind: "raft3", x: 320 });
    expect(snapshot.iceLanes.find((lane) => lane.row === 11)).toMatchObject({
      dir: 1,
      speed: 1.25,
    });
    expect(snapshot.bays[1]).toBe(true);
  });

  it("refuses a bay index and a level the strait does not have", () => {
    expect(() => harness.debug.setBay(5, true)).toThrow(RangeError);
    expect(() => harness.debug.setBay(-1, true)).toThrow(RangeError);
    expect(() => harness.debug.setFishBay(9)).toThrow(RangeError);
    expect(() => harness.debug.setLevel(0)).toThrow(RangeError);
    expect(() => harness.debug.setLevel(TOTAL_LEVELS + 1)).toThrow(RangeError);
  });
});

describe("the fixed step", () => {
  it("adds exactly TICK_DT of simulated time per tick", async () => {
    await harness.step(TICK_HZ);
    expect(harness.snapshot().simTime).toBeCloseTo(1, 9);
    await harness.step(1);
    expect(harness.snapshot().simTime).toBeCloseTo(1 + TICK_DT, 9);
  });

  it("runs the same whole ticks however the interval was divided into frames", async () => {
    harness.debug.reset();
    harness.debug.setScreen("playing");
    harness.debug.setBearEmergence(false);
    harness.debug.clearVehicles();
    harness.debug.clearFloes();
    harness.debug.addVehicle(ICE_TOP, "car", 200);
    harness.debug.setLaneSpeed(ICE_TOP, 2);
    harness.debug.setLaneDirection(ICE_TOP, 1);
    // Ten ticks a frame: two seconds of game time in twenty-four frames.
    harness.pace(10);
    try {
      await harness.step((TICK_HZ * 2) / 10);
    } finally {
      harness.pace(1);
    }
    expect(harness.snapshot().simTime).toBeCloseTo(2, 9);
    expect(harness.snapshot().vehicles[0].x).toBeCloseTo(200 + 2 * 2 * TILE, 6);
  });

  it("keeps accumulating simTime while the screen is paused", async () => {
    empty(harness);
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.debug.setLaneSpeed(15, 3);
    harness.debug.addVehicle(15, "car", 320);
    await harness.step(1);
    harness.debug.setScreen("paused");
    const before = harness.snapshot();
    await harness.step(TICK_HZ);
    const after = harness.snapshot();
    expect(after.simTime).toBeCloseTo(before.simTime + 1, 6);
    expect(after.vehicles[0].x).toBe(before.vehicles[0].x);
    expect(after.critter).toEqual(before.critter);
    expect(after.timer).toBe(before.timer);
  });
});

describe("the core", () => {
  it("relays one lane at a posed phase and leaves its motion alone", () => {
    harness.debug.reset();
    harness.debug.setLaneSpeed(12, 0.5);
    harness.debug.setLaneDirection(12, -1);
    harness.debug.clearVehicles();
    harness.debug.addVehicle(12, "plow", 100);
    harness.debug.setLanePhase(12, 700);
    const s = harness.snapshot();
    const lane = s.iceLanes.find((entry) => entry.row === 12);
    expect(lane?.speed).toBe(0.5);
    expect(lane?.dir).toBe(-1);
    const items = s.vehicles
      .filter((item) => item.row === 12)
      .sort((a, b) => a.x - b.x);
    expect(items.every((item) => item.kind === "car")).toBe(true);
    expect(items.some((item) => Math.abs(item.x - 700) < 1e-9)).toBe(true);
    const period = (2 + 7) * TILE;
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i].x - items[i - 1].x).toBeCloseTo(period, 9);
    }
    expect(items[0].x).toBeLessThanOrEqual(7 * TILE);
    expect(items[items.length - 1].x + 2 * TILE).toBeGreaterThanOrEqual(
      1280 - 7 * TILE,
    );
    expect(s.vehicles.filter((item) => item.row !== 12)).toHaveLength(0);
  });

  it("restores every field to its title-screen value", async () => {
    empty(harness);
    harness.debug.setScore(5000);
    harness.debug.setLives(1);
    harness.debug.setLevel(6);
    harness.debug.setReachedLevel(6);
    harness.debug.addCritter(3, 12);
    harness.debug.addBear(3, 14);
    harness.debug.setBay(0, true);
    harness.debug.setFishBay(1);
    await harness.step(10);

    harness.debug.reset();
    const after = harness.snapshot();
    expect(after).toMatchObject({
      screen: "title",
      menuIndex: 0,
      phase: "crossing",
      phaseTimer: 0,
      level: 1,
      reachedLevel: 1,
      lives: START_LIVES,
      score: 0,
      timer: crossingTimer(1),
      bearEmergence: true,
      catchTest: true,
      fishCadence: true,
      timerRunning: true,
      fishBay: null,
      simTime: 0,
    });
    expect(after.bays).toEqual([false, false, false, false, false]);
    expect(after.bears).toEqual([]);
    expect(after.critter.present).toBe(false);
    expect(after.iceLanes).toHaveLength(ICE_LANES.length);
    expect(after.vehicles.length).toBeGreaterThan(8);
    expect(harness.engine.world.byTag(TAGS.fish)).toHaveLength(0);
  });

  it("keeps every entity's id across a lane wrap", async () => {
    harness.debug.setScreen("playing");
    const before = harness.snapshot().vehicles.map((item) => item.id);
    harness.pace(10);
    await harness.step(TICK_HZ);
    harness.pace(1);
    expect(harness.snapshot().vehicles.map((item) => item.id)).toEqual(before);
  });

  it("leaves the mute bit as it stands", async () => {
    await harness.tap("KeyM");
    expect(harness.snapshot().muted).toBe(true);
    harness.debug.reset();
    expect(harness.snapshot().muted).toBe(true);
  });
});

describe("the screens", () => {
  it("moves the title highlight, wrapping both ways, and starts a run", async () => {
    expect(harness.snapshot().screen).toBe("title");
    await harness.tap("ArrowDown");
    expect(harness.snapshot().menuIndex).toBe(1);
    await harness.tap("ArrowDown");
    expect(harness.snapshot().menuIndex).toBe(0);
    await harness.tap("ArrowUp");
    expect(harness.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);

    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    const started = harness.snapshot();
    expect(started.screen).toBe("playing");
    expect(started.lives).toBe(START_LIVES);
    expect(started.score).toBe(0);
    expect(started.level).toBe(1);
    expect(started.critter.present).toBe(true);
  });

  it("opens the how-to screen and comes back to the title", async () => {
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("howto");
    expect(harness.snapshot().menuIndex).toBe(0);
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("title");
    // Leaving a screen selects the entry that led to it (specs/ui.md).
    expect(harness.snapshot().menuIndex).toBe(
      TITLE_ITEMS.indexOf("HOW TO PLAY"),
    );
  });

  it("resumes from the pause menu on the pause action as well as on back", async () => {
    harness.debug.setScreen("playing");
    await harness.step(1);
    await harness.tap("KeyP");
    expect(harness.snapshot().screen).toBe("paused");
    await harness.tap("KeyP");
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("does nothing on back at the title, the outermost screen", async () => {
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("title");
  });

  it("returns to the title with CROSS selected from every route back", async () => {
    const cross = TITLE_ITEMS.indexOf("CROSS");

    harness.debug.setScreen("gameover");
    harness.debug.setMenuIndex(ENDING_ITEMS.indexOf("MENU"));
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(cross);

    harness.debug.setScreen("victory");
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(cross);

    harness.debug.setScreen("paused");
    harness.debug.setMenuIndex(PAUSE_ITEMS.indexOf("QUIT TO MENU"));
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(cross);
  });

  it("reports one region per menu entry, inside the stage and apart", () => {
    for (const screen of ["title", "paused", "victory", "gameover"] as const) {
      harness.debug.setScreen(screen);
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      for (let index = 0; ; index += 1) {
        const rect = harness.debug.menuItemRect(index);
        if (rect === null) break;
        expect(rect.x, screen).toBeGreaterThanOrEqual(0);
        expect(rect.y, screen).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, screen).toBeLessThanOrEqual(STAGE_W);
        expect(rect.y + rect.h, screen).toBeLessThanOrEqual(STAGE_H);
        rects.push(rect);
      }
      expect(rects.length, screen).toBeGreaterThan(1);
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          const apart =
            rects[a].y + rects[a].h <= rects[b].y ||
            rects[b].y + rects[b].h <= rects[a].y;
          expect(apart, `${screen} ${String(a)} and ${String(b)}`).toBe(true);
        }
      }
    }
  });

  it("has no menu region on a screen with no menu, or outside one", () => {
    harness.debug.setScreen("howto");
    expect(harness.debug.menuItemRect(0)).toBeNull();
    harness.debug.setScreen("playing");
    expect(harness.debug.menuItemRect(0)).toBeNull();
    harness.debug.setScreen("title");
    expect(harness.debug.menuItemRect(TITLE_ITEMS.length)).toBeNull();
    expect(harness.debug.menuItemRect(-1)).toBeNull();
  });

  it("drives the title menu with a pointer and with a finger", async () => {
    const rect = harness.debug.menuItemRect(1);
    expect(rect).not.toBeNull();
    const at = {
      x: (rect?.x ?? 0) + (rect?.w ?? 0) / 2,
      y: (rect?.y ?? 0) + (rect?.h ?? 0) / 2,
    };

    harness.point("pointermove", at.x, at.y);
    await harness.step(1);
    expect(harness.snapshot().menuIndex).toBe(1);
    expect(harness.snapshot().screen).toBe("title");

    harness.point("pointerdown", at.x, at.y);
    harness.point("pointerup", at.x, at.y);
    await harness.step(1);
    expect(harness.snapshot().screen).toBe("howto");

    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(0);
    harness.point("pointerdown", at.x, at.y, "touch");
    await harness.step(1);
    expect(harness.snapshot().menuIndex).toBe(1);
    expect(harness.snapshot().screen).toBe("title");
    harness.point("pointerup", at.x, at.y, "touch");
    await harness.step(1);
    expect(harness.snapshot().screen).toBe("howto");
  });

  it("confirms nothing when a gesture ends outside the entry it began in", async () => {
    const first = harness.debug.menuItemRect(0);
    const second = harness.debug.menuItemRect(1);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const from = {
      x: (first?.x ?? 0) + (first?.w ?? 0) / 2,
      y: (first?.y ?? 0) + (first?.h ?? 0) / 2,
    };
    const to = {
      x: (second?.x ?? 0) + (second?.w ?? 0) / 2,
      y: (second?.y ?? 0) + (second?.h ?? 0) / 2,
    };

    harness.point("pointerdown", from.x, from.y);
    harness.point("pointermove", to.x, to.y);
    harness.point("pointerup", to.x, to.y);
    await harness.step(1);
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });

  it("pauses and resumes the crossing exactly as it stood", async () => {
    harness.debug.setScreen("playing");
    harness.debug.addCritter(20, ROW_MEDIAN);
    await harness.step(1);
    await harness.tap("KeyP");
    expect(harness.snapshot().screen).toBe("paused");
    expect(harness.snapshot().menuIndex).toBe(0);
    const held = harness.snapshot();
    await harness.step(TICK_HZ);
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("playing");
    expect(harness.snapshot().critter).toEqual(held.critter);
    expect(harness.snapshot().score).toBe(held.score);
  });

  it("walks the pause menu's three items", async () => {
    harness.debug.setScreen("playing");
    harness.debug.setScore(400);
    await harness.tap("Escape");
    expect(harness.snapshot().screen).toBe("paused");
    expect(PAUSE_ITEMS).toHaveLength(3);

    // RESUME.
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("playing");

    // RESTART.
    await harness.tap("Escape");
    await harness.tap("ArrowDown");
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("playing");
    expect(harness.snapshot().score).toBe(0);

    // QUIT TO MENU.
    await harness.tap("Escape");
    await harness.tap("ArrowUp");
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("title");
  });

  it("walks the two end screens' items", async () => {
    harness.debug.setScreen("gameover");
    expect(ENDING_ITEMS).toHaveLength(2);
    await harness.tap("ArrowDown");
    expect(harness.snapshot().menuIndex).toBe(1);
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("title");

    harness.debug.setScreen("victory");
    await harness.tap("Enter");
    expect(harness.snapshot().screen).toBe("playing");
  });

  it("moves up before down, and moves rather than confirming", async () => {
    harness.debug.setMenuIndex(1);
    harness.down("ArrowUp");
    harness.down("ArrowDown");
    await harness.step(1);
    harness.up("ArrowUp");
    harness.up("ArrowDown");
    expect(harness.snapshot().menuIndex).toBe(0);

    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(0);
    harness.down("ArrowDown");
    harness.down("Enter");
    await harness.step(1);
    harness.up("ArrowDown");
    harness.up("Enter");
    expect(harness.snapshot().screen).toBe("title");
    expect(harness.snapshot().menuIndex).toBe(1);
  });
});

describe("audio", () => {
  it("plays one cue per event, told apart by name", async () => {
    empty(harness);
    harness.cues.length = 0;
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.down("ArrowDown");
    await harness.step(1);
    harness.up("ArrowDown");
    expect(played(harness)).toContain(CUES.hop);

    harness.cues.length = 0;
    harness.debug.addCritter(20, 5);
    await harness.step(1);
    expect(played(harness)).toContain(CUES.splash);

    harness.cues.length = 0;
    harness.debug.setPhase("crossing");
    harness.debug.setPhaseTimer(0);
    harness.debug.addCritter(20, 15);
    harness.debug.setLaneSpeed(15, 4);
    harness.debug.setLaneDirection(15, 1);
    harness.debug.addVehicle(15, "car", tileCX(20) - 6 * TILE);
    await harness.until(
      () => harness.snapshot().phase === "dying",
      TICK_HZ * 3,
    );
    expect(played(harness)).toContain(CUES.crush);
  });

  it("plays the bay, the level clear and the victory cues", async () => {
    empty(harness);
    const [left] = BAYS[0];
    harness.debug.addCritter(left, 2);
    harness.cues.length = 0;
    harness.down("ArrowUp");
    await harness.step(1);
    harness.up("ArrowUp");
    expect(played(harness)).toContain(CUES.bay);

    empty(harness);
    for (const bay of [0, 1, 2, 3]) harness.debug.setBay(bay, true);
    harness.debug.addCritter(BAYS[4][0], 2);
    harness.debug.setHopCooldown(0);
    harness.cues.length = 0;
    harness.down("ArrowUp");
    await harness.step(1);
    harness.up("ArrowUp");
    expect(played(harness)).toContain(CUES.levelClear);

    empty(harness);
    harness.debug.setLevel(TOTAL_LEVELS);
    harness.debug.clearVehicles();
    harness.debug.clearFloes();
    for (const bay of [0, 1, 2, 3]) harness.debug.setBay(bay, true);
    harness.debug.addCritter(BAYS[4][0], 2);
    harness.debug.setHopCooldown(0);
    harness.cues.length = 0;
    harness.down("ArrowUp");
    await harness.step(1);
    harness.up("ArrowUp");
    expect(played(harness)).toContain(CUES.victory);
  });

  it("plays the caught, game-over and menu cues", async () => {
    empty(harness);
    harness.debug.setCatchTest(true);
    harness.debug.setLives(1);
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.debug.addBear(20, ROW_MEDIAN);
    harness.cues.length = 0;
    await harness.until(
      () => harness.snapshot().screen === "gameover",
      TICK_HZ * 3,
    );
    expect(played(harness)).toContain(CUES.caught);
    expect(played(harness)).toContain(CUES.gameOver);

    harness.cues.length = 0;
    await harness.tap("ArrowDown");
    expect(played(harness)).toContain(CUES.menu);
  });

  it("mutes through the mute action and reports the engine's own bit", async () => {
    expect(harness.snapshot().muted).toBe(false);
    await harness.tap("KeyM");
    expect(harness.snapshot().muted).toBe(true);
    expect(harness.engine.world.audio.muted()).toBe(true);

    harness.cues.length = 0;
    await harness.tap("ArrowDown");
    const menu = harness.cues.filter((play) => play.cue === CUES.menu);
    expect(menu.length).toBeGreaterThan(0);
    expect(menu[0].gain).toBe(0);

    await harness.tap("KeyM");
    expect(harness.snapshot().muted).toBe(false);
  });
});

describe("what a player reads at a glance", () => {
  it("tells the five bands apart", async () => {
    empty(harness);
    harness.debug.removeCritter();
    await harness.step(1);
    const bands = {
      farShore: harness.pixel(tileCX(0), tileCY(ROW_CAP)),
      water: harness.pixel(tileCX(20), tileCY(5)),
      median: harness.pixel(tileCX(20), tileCY(ROW_MEDIAN)),
      ice: harness.pixel(tileCX(20), tileCY(15)),
      nearShore: harness.pixel(tileCX(20), tileCY(ROW_NEAR)),
    };
    expect(distance(bands.farShore, rgb(COLOR.farShore))).toBeLessThan(8);
    expect(distance(bands.nearShore, rgb(COLOR.nearShore))).toBeLessThan(8);
    const entries = Object.values(bands);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        expect(distance(entries[i], entries[j])).toBeGreaterThan(30);
      }
    }
    // The two solid safe strips read apart from the zones on either side.
    expect(distance(bands.median, bands.water)).toBeGreaterThan(60);
    expect(distance(bands.median, bands.ice)).toBeGreaterThan(30);
    expect(distance(bands.nearShore, bands.ice)).toBeGreaterThan(60);
  });

  it("tells deep water from a floe on the same row", async () => {
    empty(harness);
    harness.debug.removeCritter();
    harness.debug.setLaneSpeed(5, 0);
    harness.debug.addFloe(5, "raft4", tileLeft(10));
    await harness.step(1);
    const floe = harness.pixel(tileCX(11), tileCY(5));
    const deep = harness.pixel(tileCX(30), tileCY(5));
    expect(distance(floe, deep)).toBeGreaterThan(60);
  });

  it("tells an open bay from the shore beside it, and from a filled one", async () => {
    empty(harness);
    harness.debug.removeCritter();
    await harness.step(1);
    const [left] = BAYS[0];
    const open = harness.pixel(tileCX(left), tileCY(ROW_BAYS));
    const shore = harness.pixel(tileCX(left + 4), tileCY(ROW_BAYS));
    expect(distance(open, shore)).toBeGreaterThan(60);

    harness.debug.setBay(0, true);
    await harness.step(1);
    const filled = harness.pixel(tileCX(left), tileCY(ROW_BAYS) - 12);
    expect(distance(filled, open)).toBeGreaterThan(60);
  });

  it("draws the critter apart from every band it can stand on", async () => {
    empty(harness);
    harness.debug.setLaneSpeed(6, 0);
    harness.debug.addFloe(6, "raft4", tileLeft(19));
    for (const row of [ROW_NEAR, 15, ROW_MEDIAN, 6]) {
      harness.debug.addCritter(20, row);
      await harness.step(1);
      expect(harness.snapshot().critter.footing).not.toBe("water");
      expect(
        apart(harness, [tileCX(20), tileCY(row)], [tileCX(4), tileCY(row)]),
      ).toBeGreaterThan(60);
    }
  });

  it("draws a bear apart from every band it can travel on", async () => {
    empty(harness);
    harness.debug.removeCritter();
    for (const row of [ROW_NEAR, 15, ROW_MEDIAN]) {
      harness.debug.clearBears();
      harness.debug.addBear(20, row);
      const id = harness.snapshot().bears[0].id;
      harness.debug.setBearTravel(id, false);
      harness.debug.setBearRouting(id, false);
      await harness.step(1);
      expect(
        apart(harness, [tileCX(20), tileCY(row)], [tileCX(4), tileCY(row)]),
      ).toBeGreaterThan(60);
    }
  });

  it("keeps a submerged bear trackable over the water", async () => {
    empty(harness);
    harness.debug.removeCritter();
    harness.debug.addBear(20, 5);
    const id = harness.snapshot().bears[0].id;
    harness.debug.setBearTravel(id, false);
    harness.debug.setBearRouting(id, false);
    await harness.step(1);
    expect(harness.snapshot().bears[0].swimming).toBe(true);
    expect(
      apart(harness, [tileCX(20), tileCY(5)], [tileCX(30), tileCY(5)]),
    ).toBeGreaterThan(60);
  });

  it("draws the bear's lunge on the tick of the catch", async () => {
    empty(harness);
    harness.debug.setCatchTest(true);
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.debug.addBear(20, ROW_MEDIAN);
    const id = harness.snapshot().bears[0].id;
    harness.debug.setBearTravel(id, false);
    harness.debug.setBearRouting(id, false);
    await harness.step(1);
    // The catch takes the bear off the strait on this tick, and the lunge is
    // drawn where it stood (specs/hunter.md, specs/assets.md).
    expect(harness.snapshot().bears).toEqual([]);
    expect(harness.snapshot().phase).toBe("dying");
    expect(
      harness.state.effects.some((effect) => effect.kind === "lunge"),
    ).toBe(true);
    expect(
      apart(
        harness,
        [tileCX(20), tileCY(ROW_MEDIAN)],
        [tileCX(4), tileCY(ROW_MEDIAN)],
      ),
    ).toBeGreaterThan(60);
  });

  it("draws every tile a vehicle spans, and each kind apart", async () => {
    empty(harness);
    harness.debug.removeCritter();
    harness.debug.setLaneSpeed(11, 0);
    harness.debug.setLaneSpeed(13, 0);
    harness.debug.setLaneSpeed(15, 0);
    harness.debug.addVehicle(11, "plow", tileLeft(10));
    harness.debug.addVehicle(13, "dogsled", tileLeft(10));
    harness.debug.addVehicle(15, "car", tileLeft(10));
    await harness.step(1);

    const ice = harness.pixel(tileCX(30), tileCY(11));
    const spans: Record<number, number[]> = {
      11: [10, 11, 12],
      13: [10, 11],
      15: [10, 11],
    };
    for (const [row, columns] of Object.entries(spans)) {
      for (const col of columns) {
        let apart = 0;
        for (let dy = -10; dy <= 10; dy += 5) {
          for (let dx = -10; dx <= 10; dx += 5) {
            const at = harness.pixel(
              tileCX(col) + dx,
              tileCY(Number(row)) + dy,
            );
            if (distance(at, ice) > 30) apart += 1;
          }
        }
        expect(apart).toBeGreaterThan(2);
      }
    }
  });

  it("keeps the HUD bar inside its own strip and legible", async () => {
    empty(harness);
    harness.debug.setScore(12345);
    await harness.step(1);
    // The bar is its own panel, distinct from the strait beneath it.
    const bar = harness.pixel(1000, 8);
    const strait = harness.pixel(1000, HUD_H + 8);
    expect(distance(bar, rgb(COLOR.panel))).toBeLessThan(8);
    expect(distance(bar, strait)).toBeGreaterThan(60);

    // The readouts are drawn: some pixel of the score's line is far from the bar.
    let ink = 0;
    for (let x = 24; x < 200; x += 2) {
      for (let y = 12; y < 34; y += 2) {
        if (distance(harness.pixel(x, y), bar) > 60) ink += 1;
      }
    }
    expect(ink).toBeGreaterThan(20);
  });

  it("marks each bay in the HUD at its own position", async () => {
    empty(harness);
    harness.debug.setBay(3, true);
    await harness.step(1);
    const filled = harness.pixel(BAYS[3][0] * TILE + TILE, 57);
    const open = harness.pixel(BAYS[0][0] * TILE + TILE, 57);
    expect(distance(filled, rgb(COLOR.bayFilled))).toBeLessThan(20);
    expect(distance(open, rgb(COLOR.bayOpen))).toBeLessThan(20);
  });

  it("draws the title screen's copy over a dimmed strait", async () => {
    await harness.step(1);
    const veiled = harness.pixel(40, STAGE_H - 8);
    const bare = rgb(COLOR.nearShore);
    expect(distance(veiled, bare)).toBeGreaterThan(60);
    // The card and its highlighted item are drawn.
    let ink = 0;
    for (let x = 400; x < 900; x += 4) {
      for (let y = 380; y < 430; y += 4) {
        const at = harness.pixel(x, y);
        if (distance(at, rgb(COLOR.highlight)) < 60) ink += 1;
      }
    }
    expect(ink).toBeGreaterThan(10);
    expect(STAGE_W).toBe(1280);
  });
});

describe("drawing between two ticks", () => {
  it("interpolates a moving body by the fraction of a tick still to run", async () => {
    empty(harness);
    harness.debug.setLaneSpeed(11, 3);
    harness.debug.setLaneDirection(11, 1);
    harness.debug.addVehicle(11, "plow", tileLeft(10));
    // A frame and a half of ticks, so half a tick is left over as the alpha.
    harness.pace(1.5);
    await harness.step(1);
    const body = harness.engine.world.byTag(TAGS.vehicle)[0];
    const sprite = body.component(SpriteComponent);
    expect(sprite).not.toBeNull();
    const step = 3 * TILE * TICK_DT;
    expect(sprite?.offset.x ?? 0).toBeCloseTo(-step / 2, 4);
    harness.pace(1);
  });

  it("mirrors a vehicle whose lane runs leftward", async () => {
    empty(harness);
    harness.debug.setLaneDirection(11, -1);
    harness.debug.addVehicle(11, "plow", tileLeft(10));
    await harness.step(1);
    const body = harness.engine.world.byTag(TAGS.vehicle)[0];
    const sprite = body.component(SpriteComponent);
    expect(sprite?.anchorX).toBe(1);
    expect(sprite?.offset.scaleX).toBe(-1);

    harness.debug.setLaneDirection(11, 1);
    await harness.step(1);
    expect(sprite?.anchorX).toBe(0);
    expect(sprite?.offset.scaleX).toBe(1);
  });

  it("keeps the pixel art crisp at every scale", async () => {
    empty(harness);
    await harness.step(1);
    // Chosen on the lowest layer, before any sprite is drawn, and left in force
    // for the rest of the frame.
    expect(harness.ctx.imageSmoothingEnabled).toBe(false);
  });

  it("draws the whole strait under every render mode the pipeline offers", async () => {
    empty(harness);
    harness.debug.addCritter(20, ROW_NEAR);
    harness.debug.addBear(20, ROW_MEDIAN);
    harness.debug.setFishBay(2);
    harness.debug.addVehicle(11, "plow", tileLeft(10));
    harness.debug.addFloe(5, "raft4", tileLeft(10));
    for (const mode of [
      "wireframe",
      "unlit",
      "silhouette",
      "shaded",
    ] as const) {
      harness.engine.renderer.setMode(mode);
      await harness.step(1);
      expect(harness.engine.renderer.mode()).toBe(mode);
    }
    for (const screen of [
      "title",
      "howto",
      "paused",
      "victory",
      "gameover",
    ] as const) {
      harness.debug.setScreen(screen);
      harness.engine.renderer.setMode("wireframe");
      await harness.step(1);
      harness.engine.renderer.setMode("shaded");
      await harness.step(1);
    }
  });

  it("draws the three-tile raft from the left 96 x 32 of its frame", async () => {
    empty(harness);
    harness.debug.addFloe(2, "raft3", tileLeft(10));
    harness.debug.addFloe(3, "raft4", tileLeft(10));
    await harness.step(1);
    const [three, four] = harness.engine.world
      .byTag(TAGS.floe)
      .map((actor) => actor.component(SpriteComponent));
    expect(three?.source).toEqual({ x: 0, y: 0, width: 96, height: 32 });
    expect(three?.width).toBe(96);
    expect(four?.source).toEqual({ x: 0, y: 0, width: 128, height: 32 });
    expect(four?.width).toBe(128);
  });
});
