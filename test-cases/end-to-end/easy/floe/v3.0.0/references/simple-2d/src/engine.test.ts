// Floe under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` at the
// simulation's own rate — which makes a duration a tick count and the arithmetic
// asserted here the arithmetic the specification names. What is read back is the
// game's own state, the debug surface the game returned beside it, the engine's
// events, and the pixels the render produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose on the surface takes a state and returns the next one
// and is driven through `engine.apply`; a reading is handed `engine.state`.
// `h.pose` and `h.snapshot` are those two moves, named.
//
// The seeded art cannot be fetched or decoded in this host, so every frame is
// `null` here and the render falls back to the shapes it draws in code. That is
// deliberate: it is the same code path a browser with a missing file takes, and it
// keeps these checks about the game rather than about the art.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BAYFILL_PAUSE,
  BEAR_CATCH_DIST,
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  BEAR_ICE_SPEED,
  BEAR_SECOND_DELAY,
  BEAR_SWIM_SPEED,
  BONUS_LIFE_EVERY,
  CLEAR_PAUSE,
  CUES,
  DEATH_PAUSE,
  ENDING_ITEMS,
  FISH_INTERVAL,
  FISH_LINGER,
  HOP_COOLDOWN,
  ICE_TOP,
  LAYOUT,
  PAUSE_ITEMS,
  ROW_BAYS,
  ROW_MEDIAN,
  ROW_NEAR,
  SCORE_BAY,
  SCORE_BONUS_CATCH,
  SCORE_LEVEL,
  SCORE_ROW,
  SCORE_TIME_BONUS,
  SCORE_VICTORY_LIFE,
  SECOND_BEAR_LEVEL,
  STAGE_H,
  STAGE_W,
  START_COL,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
  TILE,
  TIMER_BASE,
  TOTAL_LEVELS,
  crossingTimer,
  laneSpeed,
  tileCX,
  tileCY,
} from "./constants";
import {
  BACKGROUND,
  game,
  type FloeDebugApi,
  type FloeSnapshot,
  type FloeState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

// ---- The harness --------------------------------------------------------

/** One tick, in milliseconds: the clock runs at the simulation's own rate. */
const TICK_MS = 1000 / TICK_HZ;

/** A duration in seconds, as a tick count. */
function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

interface Harness {
  readonly engine: Engine<FloeState, FloeDebugApi>;
  readonly state: DeepReadonly<FloeState>;
  readonly debug: FloeDebugApi;
  pose(transition: (state: DeepReadonly<FloeState>) => FloeState): void;
  snapshot(): FloeSnapshot;
  readonly cues: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  advance(seconds: number): Promise<void>;
  frames(count: number): Promise<void>;
  dispose(): void;
}

async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx as SKRSContext2D,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options `src/main.ts` passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<FloeState, FloeDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(TICK_MS),
    surface,
  });

  const cues: string[] = [];
  engine.events.on("cue:played", ({ cue }) => cues.push(cue));

  await engine.initialize();
  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  // Read off the engine rather than built here: `initialize` returns the surface
  // beside the state, so reaching it this way is what makes that return
  // load-bearing.
  const debug = engine.debug;

  return {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    pose: (transition) => {
      engine.apply(transition);
    },
    snapshot: () => debug.snapshot(engine.state),
    cues,
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    advance: (seconds) => engine.advance(ticks(seconds)),
    frames: (count) => engine.advance(count),
    dispose: () => engine.destroy(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

// ---- Fixtures -----------------------------------------------------------

/**
 * A live crossing on an emptied strait, with every world gate off.
 *
 * The level is set BEFORE the two rosters are cleared, because `setLevel` lays
 * them out: clearing first and setting the level second would refill the strait
 * the clears had just emptied.
 */
function startCrossing(level = 1): void {
  h.pose((s) => h.debug.setScreen(s, "playing"));
  h.pose((s) => h.debug.setLevel(s, level));
  h.pose((s) => h.debug.setBearEmergence(s, false));
  h.pose((s) => h.debug.setCatchTest(s, false));
  h.pose((s) => h.debug.setFishCadence(s, false));
  h.pose((s) => h.debug.setTimerRunning(s, false));
  h.pose((s) => h.debug.clearVehicles(s));
  h.pose((s) => h.debug.clearFloes(s));
  h.pose((s) => h.debug.clearBears(s));
  h.pose((s) => h.debug.clearBays(s));
  h.pose((s) => h.debug.clearFish(s));
  h.pose((s) => h.debug.setPhase(s, "crossing"));
  h.pose((s) => h.debug.setPhaseTimer(s, 0));
}

/** The id of the last bear on the roster, which is the one just added. */
function lastBear(): number {
  const { bears } = h.snapshot();
  return bears[bears.length - 1].id;
}

/** The id of the last vehicle on the roster. */
function lastVehicle(): number {
  const { vehicles } = h.snapshot();
  return vehicles[vehicles.length - 1].id;
}

/** The id of the last floe on the roster. */
function lastFloe(): number {
  const { floes } = h.snapshot();
  return floes[floes.length - 1].id;
}

// ---- The opening state --------------------------------------------------

describe("a freshly initialized build", () => {
  it("opens on the title screen with the first item highlighted", () => {
    const s = h.snapshot();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.version).toBe(1);
  });

  it("reports the pose a fresh crossing begins from, with no critter in play", () => {
    const { critter } = h.snapshot();
    expect(critter.present).toBe(false);
    expect(critter.col).toBe(START_COL);
    expect(critter.row).toBe(ROW_NEAR);
    expect(critter.x).toBe(tileCX(START_COL));
    expect(critter.y).toBe(tileCY(ROW_NEAR));
    expect(critter.facing).toBe("up");
    expect(critter.hopCooldown).toBe(0);
    expect(critter.bestRow).toBe(ROW_NEAR);
  });

  it("lays the sixteen lanes out at level 1's speeds, with every gap exact", () => {
    const s = h.snapshot();
    expect(s.iceLanes.map((lane) => lane.row)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(s.waterLanes.map((lane) => lane.row)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    for (const lane of [...s.iceLanes, ...s.waterLanes]) {
      expect(lane.speed).toBeCloseTo(laneSpeed(lane.row, 1), 8);
      const items = [...s.vehicles, ...s.floes]
        .filter((item) => item.row === lane.row)
        .sort((a, b) => a.x - b.x);
      expect(items.length).toBeGreaterThan(1);
      const gaps = items
        .slice(1)
        .map(
          (item, index) => item.x - items[index].x - TILE * items[index].len,
        );
      for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
    }
  });

  it("reports five open bays, no bonus catch and every gate on", () => {
    const s = h.snapshot();
    expect(s.bays).toEqual([false, false, false, false, false]);
    expect(s.fishBay).toBeNull();
    expect(s.bearEmergence).toBe(true);
    expect(s.catchTest).toBe(true);
    expect(s.fishCadence).toBe(true);
    expect(s.timerRunning).toBe(true);
    expect(s.timer).toBe(TIMER_BASE);
    expect(s.timerMax).toBe(TIMER_BASE);
    expect(s.lives).toBe(START_LIVES);
  });
});

// ---- The fixed step -----------------------------------------------------

describe("the fixed step", () => {
  it("raises simTime by one second over TICK_HZ ticks", async () => {
    await h.frames(TICK_HZ);
    expect(h.snapshot().simTime).toBeCloseTo(1, 6);
  });

  it("reaches the same state however the interval was divided into frames", async () => {
    startCrossing();
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "plow", 100));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 2));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP, 1));
    await h.frames(TICK_HZ);
    const inOneGo = h.snapshot();

    const second = await createHarness();
    const saved = h;
    h = second;
    startCrossing();
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "plow", 100));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 2));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP, 1));
    for (let index = 0; index < TICK_HZ; index += 1) await h.frames(1);
    const oneAtATime = h.snapshot();
    second.dispose();
    h = saved;

    expect(oneAtATime.simTime).toBeCloseTo(inOneGo.simTime, 9);
    expect(oneAtATime.vehicles[0].x).toBeCloseTo(inOneGo.vehicles[0].x, 9);
  });

  it("advances a lane at 2 tiles a second by exactly 64 units", async () => {
    startCrossing();
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", 200));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 2));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP, 1));
    await h.frames(TICK_HZ);
    expect(h.snapshot().vehicles[0].x).toBeCloseTo(200 + 64, 6);
  });
});

// ---- The critter --------------------------------------------------------

describe("hopping", () => {
  beforeEach(() => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, START_COL, ROW_NEAR));
  });

  it("moves one tile per press and plays the hop cue once", async () => {
    h.tap("ArrowUp");
    await h.frames(1);
    const s = h.snapshot();
    expect(s.critter.row).toBe(ROW_NEAR - 1);
    expect(s.critter.col).toBe(START_COL);
    expect(s.critter.facing).toBe("up");
    expect(h.cues.filter((cue) => cue === CUES.hop)).toHaveLength(1);
  });

  it("ignores a second press inside the cooldown", async () => {
    h.tap("ArrowUp");
    await h.frames(1);
    await h.advance(0.06);
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().critter.row).toBe(ROW_NEAR - 1);
  });

  it("takes a second press once the cooldown has run out", async () => {
    h.tap("ArrowUp");
    await h.frames(1);
    await h.advance(HOP_COOLDOWN);
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().critter.row).toBe(ROW_NEAR - 2);
  });

  it("auto-repeats a held direction at the cooldown", async () => {
    h.hold("ArrowRight");
    await h.advance(1);
    h.release("ArrowRight");
    const moved = h.snapshot().critter.col - START_COL;
    expect(moved).toBeGreaterThanOrEqual(Math.floor(1 / HOP_COOLDOWN));
    expect(moved).toBeLessThanOrEqual(Math.floor(1 / HOP_COOLDOWN) + 2);
  });

  it("faces the direction of its last hop", async () => {
    for (const [code, facing] of [
      ["ArrowUp", "up"],
      ["ArrowRight", "right"],
      ["ArrowDown", "down"],
      ["ArrowLeft", "left"],
    ] as const) {
      h.tap(code);
      await h.frames(1);
      expect(h.snapshot().critter.facing).toBe(facing);
      await h.advance(HOP_COOLDOWN);
    }
  });

  it("refuses a hop below the near shore, off either edge and into the cap", async () => {
    h.tap("ArrowDown");
    await h.frames(1);
    expect(h.snapshot().critter.row).toBe(ROW_NEAR);
    expect(h.snapshot().lives).toBe(START_LIVES);

    h.pose((s) => h.debug.setCritterTile(s, 0, ROW_MEDIAN));
    h.pose((s) => h.debug.setHopCooldown(s, 0));
    h.tap("ArrowLeft");
    await h.frames(1);
    expect(h.snapshot().critter.col).toBe(0);

    h.pose((s) => h.debug.setCritterTile(s, 39, ROW_MEDIAN));
    h.pose((s) => h.debug.setHopCooldown(s, 0));
    h.tap("ArrowRight");
    await h.frames(1);
    expect(h.snapshot().critter.col).toBe(39);
  });

  it("accepts a hop up from row 2 only at a bay column", async () => {
    // A parked raft under row 2, so a refused hop leaves the critter standing
    // rather than falling into the water it would otherwise be on.
    h.pose((s) => h.debug.addFloe(s, 2, "raft4", 0));
    h.pose((s) => h.debug.setFloeX(s, lastFloe(), tileCX(3) - 16));
    h.pose((s) => h.debug.addFloe(s, 2, "raft4", tileCX(7) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, 2, 0));
    // Column 6 is solid far shore; column 4 is the right half of bay 0.
    h.pose((s) => h.debug.setCritterTile(s, 6, 2));
    h.pose((s) => h.debug.setHopCooldown(s, 0));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().critter.row).toBe(2);

    h.pose((s) => h.debug.setCritterTile(s, 4, 2));
    h.pose((s) => h.debug.setHopCooldown(s, 0));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().bays[0]).toBe(true);
  });

  it("refuses a hop into a filled bay", async () => {
    h.pose((s) => h.debug.addFloe(s, 2, "raft4", tileCX(19) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, 2, 0));
    h.pose((s) => h.debug.setBay(s, 2, true));
    h.pose((s) => h.debug.setCritterTile(s, 19, 2));
    h.pose((s) => h.debug.setHopCooldown(s, 0));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().critter.row).toBe(2);
    expect(h.snapshot().score).toBe(0);
  });

  it("refuses a hop onto every tile a parked plow covers", async () => {
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP + 1, 0));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP + 1, "plow", tileCX(10) - 16));
    for (const col of [10, 11, 12]) {
      h.pose((s) => h.debug.setCritterTile(s, col, ICE_TOP + 2));
      h.pose((s) => h.debug.setHopCooldown(s, 0));
      h.tap("ArrowUp");
      await h.frames(1);
      expect(h.snapshot().critter.row).toBe(ICE_TOP + 2);
    }
  });

  it("puts the centre exactly on the target tile's centre from mid-drift", async () => {
    h.pose((s) => h.debug.addFloe(s, 5, "raft4", tileCX(10) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, 5, 0));
    h.pose((s) => h.debug.setCritterTile(s, 11, 5));
    h.pose((s) => h.debug.setCritterX(s, tileCX(11) + 11));
    h.pose((s) => h.debug.setHopCooldown(s, 0));
    h.tap("ArrowUp");
    await h.frames(1);
    const { critter } = h.snapshot();
    expect(critter.x).toBe(tileCX(11));
    expect(critter.y).toBe(tileCY(4));
  });

  it("lands on that centre exactly with both lanes still drifting", async () => {
    // The carry belongs to the tile the critter was standing on, never to the one
    // it hopped onto, so a hop onto a moving floe is still exactly on its centre at
    // the end of the tick it was taken on.
    h.pose((s) => h.debug.addFloe(s, 5, "raft4", tileCX(10) - 16));
    h.pose((s) => h.debug.addFloe(s, 4, "raft3", tileCX(10) - 16));
    h.pose((s) => h.debug.setCritterTile(s, 11, 5));
    h.pose((s) => h.debug.setCritterX(s, tileCX(11) + 11));
    h.pose((s) => h.debug.setHopCooldown(s, 0));
    expect(h.snapshot().waterLanes[5 - 2].speed).toBeGreaterThan(0);
    expect(h.snapshot().waterLanes[4 - 2].speed).toBeGreaterThan(0);

    h.tap("ArrowUp");
    await h.frames(1);
    const { critter } = h.snapshot();
    expect(critter.footing).toBe("floe");
    expect(critter.x).toBe(tileCX(11));
    expect(critter.y).toBe(tileCY(4));
  });
});

// ---- The bands ----------------------------------------------------------

describe("the strait", () => {
  it("reports the footing each band gives, on an emptied strait", () => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, 20, ROW_NEAR));
    expect(h.snapshot().critter.footing).toBe("solid");
    for (const row of [11, 14, 18, ROW_MEDIAN, ROW_BAYS, 0]) {
      h.pose((s) => h.debug.setCritterTile(s, 20, row));
      expect(h.snapshot().critter.footing).toBe("solid");
    }
    for (const row of [2, 5, 9]) {
      h.pose((s) => h.debug.setCritterTile(s, 20, row));
      expect(h.snapshot().critter.footing).toBe("water");
    }
  });

  it("puts every tile's centre where the map says", () => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, 0, 0));
    for (const [col, row] of [
      [0, 0],
      [39, 19],
      [20, 10],
      [3, 1],
      [12, 5],
      [27, 14],
      [35, 18],
      [7, 9],
    ] as const) {
      h.pose((s) => h.debug.setCritterTile(s, col, row));
      const { critter } = h.snapshot();
      expect(critter.x).toBe(32 * col + 16);
      expect(critter.y).toBe(80 + 32 * row + 16);
    }
  });

  it("carries no lane on the median or the near shore at any level", () => {
    for (const level of [1, 4, 8]) {
      h.pose((s) => h.debug.setLevel(s, level));
      const s = h.snapshot();
      for (const row of [ROW_MEDIAN, ROW_NEAR]) {
        expect(s.vehicles.filter((item) => item.row === row)).toHaveLength(0);
        expect(s.floes.filter((item) => item.row === row)).toHaveLength(0);
      }
    }
  });
});

// ---- The water ----------------------------------------------------------

describe("the water", () => {
  beforeEach(() => {
    startCrossing();
  });

  it("drowns a critter on a water tile no floe covers", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, 5));
    await h.frames(1);
    const s = h.snapshot();
    expect(s.lives).toBe(START_LIVES - 1);
    expect(s.phase).toBe("dying");
    expect(h.cues).toContain(CUES.splash);
  });

  it("makes every tile of a raft footing, and carries the rider at the lane's rate", async () => {
    h.pose((s) => h.debug.addFloe(s, 9, "raft4", tileCX(10) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, 9, 0));
    for (const col of [10, 11, 12, 13]) {
      h.pose((s) => h.debug.setCritterTile(s, col, 9));
      h.pose((s) => h.debug.addCritter(s, col, 9));
      expect(h.snapshot().critter.footing).toBe("floe");
    }
    await h.advance(1);
    expect(h.snapshot().lives).toBe(START_LIVES);

    h.pose((s) => h.debug.setCritterTile(s, 11, 9));
    h.pose((s) => h.debug.setLaneSpeed(s, 9, 3));
    h.pose((s) => h.debug.setLaneDirection(s, 9, 1));
    const before = h.snapshot().critter.x;
    await h.frames(TICK_HZ);
    const after = h.snapshot().critter.x;
    expect(after - before).toBeCloseTo(3 * TILE, 1);
  });

  it("moves the rider's column with its centre", async () => {
    h.pose((s) => h.debug.addFloe(s, 9, "raft4", 0));
    h.pose((s) => h.debug.setFloeX(s, lastFloe(), tileCX(2) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, 9, 4));
    h.pose((s) => h.debug.setLaneDirection(s, 9, 1));
    h.pose((s) => h.debug.addCritter(s, 3, 9));
    const columns = new Set<number>();
    for (let index = 0; index < 60; index += 1) {
      await h.frames(1);
      columns.add(h.snapshot().critter.col);
    }
    expect(columns.size).toBeGreaterThan(1);
  });

  it("costs a life when the drift carries the critter off an edge", async () => {
    h.pose((s) => h.debug.addFloe(s, 9, "raft4", -64));
    h.pose((s) => h.debug.setLaneSpeed(s, 9, 6));
    h.pose((s) => h.debug.setLaneDirection(s, 9, -1));
    h.pose((s) => h.debug.addCritter(s, 1, 9));
    h.pose((s) => h.debug.setCritterX(s, 20));
    await h.advance(1);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });
});

// ---- The ice ------------------------------------------------------------

describe("the ice", () => {
  beforeEach(() => {
    startCrossing();
  });

  it("crushes the critter when a moving vehicle arrives on its centre", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, ICE_TOP + 3));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP + 3, "car", tileCX(24)));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP + 3, 4));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP + 3, -1));
    await h.advance(2);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
    expect(h.cues).toContain(CUES.crush);
  });

  it("kills nothing while the lane is parked, and kills once it is released", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, ICE_TOP + 3));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP + 3, "plow", tileCX(20) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP + 3, 0));
    await h.advance(3);
    expect(h.snapshot().lives).toBe(START_LIVES);
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP + 3, 1));
    await h.frames(1);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("keeps every lane's gaps across ten seconds of wrapping", async () => {
    h.pose((s) => h.debug.setLevel(s, 1));
    await h.advance(10);
    const s = h.snapshot();
    for (const lane of [...s.iceLanes, ...s.waterLanes]) {
      const items = [...s.vehicles, ...s.floes]
        .filter((item) => item.row === lane.row)
        .sort((a, b) => a.x - b.x);
      const gaps = items
        .slice(1)
        .map(
          (item, index) => item.x - items[index].x - TILE * items[index].len,
        );
      for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 4);
    }
  });

  it("scales speed and gap with the level", () => {
    for (const level of [1, 4, 8]) {
      h.pose((s) => h.debug.setLevel(s, level));
      const s = h.snapshot();
      for (const lane of [...s.iceLanes, ...s.waterLanes]) {
        expect(lane.speed).toBeCloseTo(laneSpeed(lane.row, level), 8);
      }
    }
    const gapsAt = (level: number): number => {
      h.pose((s) => h.debug.setLevel(s, level));
      const s = h.snapshot();
      const items = s.vehicles
        .filter((item) => item.row === ICE_TOP)
        .sort((a, b) => a.x - b.x);
      return (items[1].x - items[0].x) / TILE - items[0].len;
    };
    expect(gapsAt(1)).toBeCloseTo(8, 6);
    expect(gapsAt(4)).toBeCloseTo(9, 6);
    expect(gapsAt(7)).toBeCloseTo(10, 6);
  });

  it("leaves no column covered in all eight rows of a band", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      h.pose((s) => h.debug.reset(s, { seed }));
      const s = h.snapshot();
      for (const band of [
        { lanes: s.iceLanes, items: s.vehicles },
        { lanes: s.waterLanes, items: s.floes },
      ]) {
        for (let col = 0; col < 40; col += 1) {
          const covered = band.lanes.every((lane) =>
            band.items.some(
              (item) =>
                item.row === lane.row &&
                tileCX(col) >= item.x &&
                tileCX(col) < item.x + TILE * item.len,
            ),
          );
          expect(covered).toBe(false);
        }
      }
    }
  });
});

// ---- The hunter ---------------------------------------------------------

describe("the bear", () => {
  beforeEach(() => {
    startCrossing();
  });

  it("glides continuously between two tile centres", async () => {
    h.pose((s) => h.debug.addBear(s, 20, ROW_MEDIAN));
    const id = lastBear();
    h.pose((s) => h.debug.setBearSense(s, id, false));
    h.pose((s) => h.debug.setBearRouting(s, id, false));
    h.pose((s) => h.debug.setBearStep(s, id, "right"));
    let between = 0;
    for (let index = 0; index < 12; index += 1) {
      await h.frames(1);
      const bear = h.snapshot().bears[0];
      if (bear.x > tileCX(20) && bear.x < tileCX(21)) between += 1;
    }
    expect(between).toBeGreaterThanOrEqual(4);
  });

  it("travels at its ice speed across the median", async () => {
    h.pose((s) => h.debug.addBear(s, 5, ROW_MEDIAN));
    const id = lastBear();
    h.pose((s) => h.debug.setBearSense(s, id, false));
    h.pose((s) => h.debug.setBearTarget(s, id, 35, ROW_MEDIAN));
    const before = h.snapshot().bears[0].x;
    await h.frames(TICK_HZ);
    const after = h.snapshot().bears[0].x;
    expect(after - before).toBeCloseTo(BEAR_ICE_SPEED * TILE, 0);
  });

  it("travels at its swim speed across open water", async () => {
    h.pose((s) => h.debug.addBear(s, 5, 5));
    const id = lastBear();
    h.pose((s) => h.debug.setBearSense(s, id, false));
    h.pose((s) => h.debug.setBearTarget(s, id, 35, 5));
    const before = h.snapshot().bears[0].x;
    await h.frames(TICK_HZ);
    const after = h.snapshot().bears[0].x;
    expect(after - before).toBeCloseTo(BEAR_SWIM_SPEED * TILE, 0);
  });

  it("travels at its ice speed over a raft", async () => {
    h.pose((s) => h.debug.addFloe(s, 5, "raft4", 0));
    h.pose((s) => h.debug.setFloeX(s, lastFloe(), tileCX(4) - 16));
    h.pose((s) => h.debug.addFloe(s, 5, "raft4", tileCX(8) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, 5, 0));
    h.pose((s) => h.debug.addBear(s, 4, 5));
    const id = lastBear();
    h.pose((s) => h.debug.setBearSense(s, id, false));
    h.pose((s) => h.debug.setBearTarget(s, id, 11, 5));
    expect(h.snapshot().bears[0].swimming).toBe(false);
    const before = h.snapshot().bears[0].x;
    await h.frames(ticks(0.5));
    const after = h.snapshot().bears[0].x;
    expect(after - before).toBeCloseTo((BEAR_ICE_SPEED * TILE) / 2, 0);
  });

  it("scales both speeds with the level", async () => {
    for (const level of [1, 4, 8]) {
      startCrossing(level);
      h.pose((s) => h.debug.clearFloes(s));
      h.pose((s) => h.debug.addBear(s, 5, ROW_MEDIAN));
      const id = lastBear();
      h.pose((s) => h.debug.setBearSense(s, id, false));
      h.pose((s) => h.debug.setBearTarget(s, id, 35, ROW_MEDIAN));
      const before = h.snapshot().bears[0].x;
      await h.frames(TICK_HZ);
      const after = h.snapshot().bears[0].x;
      const expected = BEAR_ICE_SPEED * Math.pow(1.06, level - 1) * TILE;
      expect(after - before).toBeCloseTo(expected, 0);
    }
  });

  it("turns only on a tile centre, and moves along one axis a tick", async () => {
    // Both bodies stand on solid footing, so nothing but the bear moves.
    h.pose((s) => h.debug.addCritter(s, 24, ICE_TOP));
    h.pose((s) => h.debug.addBear(s, 16, ROW_MEDIAN));
    let previous = h.snapshot().bears[0];
    let axisChanges = 0;
    for (let index = 0; index < ticks(4); index += 1) {
      await h.frames(1);
      const bears = h.snapshot().bears;
      if (bears.length === 0) break;
      const bear = bears[0];
      const movedX = Math.abs(bear.x - previous.x) > 1e-9;
      const movedY = Math.abs(bear.y - previous.y) > 1e-9;
      expect(movedX && movedY).toBe(false);
      const axis = (b: typeof bear): string =>
        b.stepCol === b.col ? "v" : "h";
      if (axis(bear) !== axis(previous)) {
        axisChanges += 1;
        expect(bear.x).toBe(tileCX(bear.col));
        expect(bear.y).toBe(tileCY(bear.row));
      }
      previous = bear;
    }
    expect(axisChanges).toBeGreaterThan(0);
  });

  it("closes on the critter over three seconds", async () => {
    h.pose((s) => h.debug.addCritter(s, 32, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 20, ROW_MEDIAN));
    const start = h.snapshot();
    const before =
      Math.abs(start.bears[0].col - start.critter.col) +
      Math.abs(start.bears[0].row - start.critter.row);
    await h.advance(3);
    const now = h.snapshot();
    const after =
      Math.abs(now.bears[0].col - now.critter.col) +
      Math.abs(now.bears[0].row - now.critter.row);
    expect(after).toBeLessThan(before);
  });

  it("reads the critter's tile into its target, and stops when its sense is off", async () => {
    h.pose((s) => h.debug.addCritter(s, 10, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 20, ROW_MEDIAN));
    const tracking = lastBear();
    h.pose((s) => h.debug.addBear(s, 30, ROW_MEDIAN));
    const blind = lastBear();
    h.pose((s) => h.debug.setBearSense(s, blind, false));
    h.pose((s) => h.debug.setBearTarget(s, blind, 30, ROW_MEDIAN));
    h.pose((s) => h.debug.setBearTravel(s, blind, false));
    await h.frames(1);
    h.pose((s) => h.debug.setCritterTile(s, 14, ROW_MEDIAN));
    await h.frames(1);
    const bears = h.snapshot().bears;
    const seer = bears.find((bear) => bear.id === tracking);
    const other = bears.find((bear) => bear.id === blind);
    expect(seer?.target).toEqual({ col: 14, row: ROW_MEDIAN });
    expect(other?.target).toEqual({ col: 30, row: ROW_MEDIAN });
  });

  it("refuses a step into a tile a parked vehicle covers", async () => {
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 0));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", tileCX(20) - 16));
    h.pose((s) => h.debug.addBear(s, 20, ICE_TOP + 1));
    const id = lastBear();
    h.pose((s) => h.debug.setBearSense(s, id, false));
    h.pose((s) => h.debug.setBearRouting(s, id, false));
    h.pose((s) => h.debug.setBearStep(s, id, "up"));
    await h.advance(1);
    const bear = h.snapshot().bears[0];
    expect(bear.row).toBe(ICE_TOP + 1);
    expect(bear.stepRow).toBe(ICE_TOP + 1);
  });

  it("never enters the far shore", async () => {
    h.pose((s) => h.debug.addBear(s, 20, 2));
    const id = lastBear();
    h.pose((s) => h.debug.setBearSense(s, id, false));
    h.pose((s) => h.debug.setBearRouting(s, id, false));
    h.pose((s) => h.debug.setBearStep(s, id, "up"));
    await h.advance(1);
    expect(h.snapshot().bears[0].row).toBe(2);

    h.pose((s) => h.debug.setBearTile(s, id, 20, 1));
    h.pose((s) => h.debug.setBearStep(s, id, "up"));
    await h.advance(1);
    expect(h.snapshot().bears[0].row).toBe(1);
  });

  it("stands still when every neighbouring tile is closed", async () => {
    const row = ICE_TOP + 3;
    h.pose((s) => h.debug.addCritter(s, 30, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 20, row));
    for (const [col, at] of [
      [20, row - 1],
      [20, row + 1],
      [19, row],
      [21, row],
    ] as const) {
      h.pose((s) => h.debug.setLaneSpeed(s, at, 0));
      h.pose((s) => h.debug.addVehicle(s, at, "car", tileCX(col) - 16));
    }
    const before = h.snapshot().bears[0];
    await h.advance(3);
    const after = h.snapshot().bears[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.stepCol).toBe(after.col);
  });

  it("steps closer when no open route to the target exists", async () => {
    // A wall of parked plows across the whole of row ICE_TOP + 1 seals the rows
    // above it, so no route reaches the critter and the bear falls back.
    const wall = ICE_TOP + 1;
    h.pose((s) => h.debug.setLaneSpeed(s, wall, 0));
    for (let col = 0; col < 40; col += 3) {
      h.pose((s) => h.debug.addVehicle(s, wall, "plow", tileCX(col) - 16));
    }
    h.pose((s) => h.debug.addCritter(s, 30, wall - 2));
    h.pose((s) => h.debug.addBear(s, 20, wall + 1));
    await h.advance(1);
    const bear = h.snapshot().bears[0];
    expect(bear.col).toBeGreaterThan(20);
    expect(bear.row).toBe(wall + 1);
  });

  it("is taken off the roster by a vehicle arriving on either of its tiles", async () => {
    h.pose((s) => h.debug.addBear(s, 20, ICE_TOP + 2));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP + 2, "car", tileCX(26)));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP + 2, 5));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP + 2, -1));
    await h.advance(2);
    expect(h.snapshot().bears).toHaveLength(0);
  });

  it("reports swimming only where the tile it enters is open water", async () => {
    h.pose((s) => h.debug.addBear(s, 20, 5));
    const id = lastBear();
    h.pose((s) => h.debug.setBearSense(s, id, false));
    h.pose((s) => h.debug.setBearTravel(s, id, false));
    expect(h.snapshot().bears[0].swimming).toBe(true);
    h.pose((s) => h.debug.addFloe(s, 5, "pan", tileCX(20) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, 5, 0));
    expect(h.snapshot().bears[0].swimming).toBe(false);
    h.pose((s) => h.debug.setBearTile(s, id, 20, ROW_MEDIAN));
    expect(h.snapshot().bears[0].swimming).toBe(false);
  });

  it("catches the critter inside the catch distance and not beyond it", async () => {
    h.pose((s) => h.debug.setCatchTest(s, true));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 20, ROW_MEDIAN));
    const id = lastBear();
    h.pose((s) => h.debug.setBearTravel(s, id, false));
    h.pose((s) =>
      h.debug.setBearPosition(
        s,
        id,
        tileCX(20) + BEAR_CATCH_DIST + 6,
        tileCY(ROW_MEDIAN),
      ),
    );
    await h.advance(1);
    expect(h.snapshot().lives).toBe(START_LIVES);

    h.pose((s) => h.debug.addBear(s, 20, ROW_MEDIAN));
    const near = lastBear();
    h.pose((s) => h.debug.setBearTravel(s, near, false));
    h.pose((s) =>
      h.debug.setBearPosition(
        s,
        near,
        tileCX(20) + BEAR_CATCH_DIST - 1,
        tileCY(ROW_MEDIAN),
      ),
    );
    await h.frames(1);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
    expect(h.cues).toContain(CUES.caught);
  });

  it("leaves every bear on the strait when a crossing ends", async () => {
    h.pose((s) => h.debug.addCritter(s, 4, 2));
    h.pose((s) => h.debug.addBear(s, 10, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 12, ROW_MEDIAN));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().bears).toHaveLength(0);
  });

  it("emerges once the critter has advanced and the delay has passed", async () => {
    h.pose((s) => h.debug.setBearEmergence(s, true));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_NEAR - BEAR_EMERGE_ADVANCE));
    h.pose((s) => h.debug.setBestRow(s, ROW_NEAR - BEAR_EMERGE_ADVANCE));
    await h.advance(BEAR_EMERGE_DELAY / 2);
    expect(h.snapshot().bears).toHaveLength(0);
    await h.advance(BEAR_EMERGE_DELAY / 2);
    const bears = h.snapshot().bears;
    expect(bears).toHaveLength(1);
    expect(bears[0].row).toBe(ROW_NEAR);
  });

  it("emerges for nothing while the critter is still on the near shore", async () => {
    h.pose((s) => h.debug.setBearEmergence(s, true));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_NEAR));
    await h.advance(30);
    expect(h.snapshot().bears).toHaveLength(0);
  });

  it("brings a second bear from level 5 and never more than two", async () => {
    startCrossing(SECOND_BEAR_LEVEL);
    h.pose((s) => h.debug.clearVehicles(s));
    h.pose((s) => h.debug.clearFloes(s));
    h.pose((s) => h.debug.setBearEmergence(s, true));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.setBestRow(s, ROW_MEDIAN));
    await h.advance(BEAR_EMERGE_DELAY + BEAR_SECOND_DELAY);
    expect(h.snapshot().bears.length).toBe(2);
    await h.advance(10);
    expect(h.snapshot().bears.length).toBeLessThanOrEqual(2);
  });

  it("brings no second bear below level 5", async () => {
    startCrossing(SECOND_BEAR_LEVEL - 1);
    h.pose((s) => h.debug.clearVehicles(s));
    h.pose((s) => h.debug.clearFloes(s));
    h.pose((s) => h.debug.setBearEmergence(s, true));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.setBestRow(s, ROW_MEDIAN));
    for (let index = 0; index < 20; index += 1) {
      await h.advance(1);
      expect(h.snapshot().bears.length).toBeLessThanOrEqual(1);
    }
  });
});

// ---- The bays and the bonus catch ---------------------------------------

describe("the bays", () => {
  beforeEach(() => {
    startCrossing();
  });

  it("fills the bay a crossing ends in, and no other", async () => {
    h.pose((s) => h.debug.addCritter(s, 27, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().bays).toEqual([false, false, false, true, false]);
    expect(h.cues).toContain(CUES.bay);
  });

  it("opens a fresh crossing after the hold, with the timer back at its max", async () => {
    h.pose((s) => h.debug.addCritter(s, 27, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().critter.present).toBe(false);
    await h.advance(BAYFILL_PAUSE);
    const s = h.snapshot();
    expect(s.critter.present).toBe(true);
    expect(s.critter.col).toBe(START_COL);
    expect(s.critter.row).toBe(ROW_NEAR);
    expect(s.timer).toBe(s.timerMax);
  });

  it("clears the level on the hop that fills the last open bay", async () => {
    for (const index of [0, 1, 2, 3]) {
      h.pose((s) => h.debug.setBay(s, index, true));
    }
    h.pose((s) => h.debug.addCritter(s, 35, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().phase).toBe("clearing");
    expect(h.cues).toContain(CUES.levelClear);
  });

  it("leaves a strait whose bays were posed full still playing", async () => {
    for (const index of [0, 1, 2, 3, 4]) {
      h.pose((s) => h.debug.setBay(s, index, true));
    }
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    await h.advance(5);
    const s = h.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.phase).toBe("crossing");
    expect(s.level).toBe(1);
  });

  it("opens every bay again on a level advance", async () => {
    for (const index of [0, 1, 2, 3]) {
      h.pose((s) => h.debug.setBay(s, index, true));
    }
    h.pose((s) => h.debug.addCritter(s, 35, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    await h.advance(CLEAR_PAUSE);
    const s = h.snapshot();
    expect(s.level).toBe(2);
    expect(s.bays).toEqual([false, false, false, false, false]);
    expect(s.phase).toBe("crossing");
  });

  it("puts a bonus catch in an open bay, lingering and moving on", async () => {
    h.pose((s) => h.debug.setFishCadence(s, true));
    h.pose((s) => h.debug.setBay(s, 0, true));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    await h.advance(FISH_INTERVAL);
    const first = h.snapshot().fishBay;
    expect(first).not.toBeNull();
    expect(first).not.toBe(0);

    await h.advance(FISH_LINGER - 0.2);
    expect(h.snapshot().fishBay).toBe(first);
    await h.advance(0.2);
    expect(h.snapshot().fishBay).toBeNull();

    await h.advance(FISH_INTERVAL);
    const second = h.snapshot().fishBay;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("takes the catch off when its bay is filled", async () => {
    h.pose((s) => h.debug.setFishBay(s, 2));
    h.pose((s) => h.debug.addCritter(s, 19, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().fishBay).toBeNull();
  });
});

// ---- The run ------------------------------------------------------------

describe("the run", () => {
  beforeEach(() => {
    startCrossing();
  });

  it("holds the dying phase for the death pause, then respawns", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, 5));
    await h.frames(1);
    expect(h.snapshot().phase).toBe("dying");
    await h.advance(DEATH_PAUSE - 0.1);
    expect(h.snapshot().phase).toBe("dying");
    expect(h.snapshot().critter.present).toBe(false);
    await h.advance(0.1);
    const s = h.snapshot();
    expect(s.phase).toBe("crossing");
    expect(s.critter.present).toBe(true);
    expect(s.critter.col).toBe(START_COL);
    expect(s.critter.row).toBe(ROW_NEAR);
    expect(s.critter.facing).toBe("up");
    expect(s.critter.bestRow).toBe(ROW_NEAR);
  });

  it("keeps the lanes running through the death pause", async () => {
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", 300));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 2));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP, 1));
    h.pose((s) => h.debug.addCritter(s, 20, 5));
    await h.frames(1);
    const before = h.snapshot().vehicles[0].x;
    await h.advance(0.5);
    expect(h.snapshot().vehicles[0].x).toBeGreaterThan(before);
  });

  it("costs no further life through the pause", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, 5));
    await h.frames(1);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "plow", tileCX(20) - 16));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 1));
    await h.advance(DEATH_PAUSE - 0.1);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("keeps the filled bays across a death", async () => {
    h.pose((s) => h.debug.setBay(s, 1, true));
    h.pose((s) => h.debug.setBay(s, 3, true));
    h.pose((s) => h.debug.addCritter(s, 20, 5));
    await h.advance(DEATH_PAUSE + 0.1);
    expect(h.snapshot().bays).toEqual([false, true, false, true, false]);
  });

  it("costs a life when the timer runs out, on the tick it reaches zero", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.setTimerRunning(s, true));
    h.pose((s) => h.debug.setTimer(s, 0.5));
    await h.advance(0.5);
    const s = h.snapshot();
    expect(s.timer).toBe(0);
    expect(s.phase).toBe("dying");
    expect(s.lives).toBe(START_LIVES - 1);
  });

  it("shortens the crossing timer with the level", () => {
    for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
      h.pose((s) => h.debug.setLevel(s, level));
      expect(h.snapshot().timerMax).toBe(crossingTimer(level));
    }
    h.pose((s) => h.debug.setLevel(s, TOTAL_LEVELS));
    expect(h.snapshot().timerMax).toBe(16);
  });

  it("ends the run on the death that empties the lives, after the pause", async () => {
    h.pose((s) => h.debug.setLives(s, 1));
    h.pose((s) => h.debug.setReachedLevel(s, 6));
    h.pose((s) => h.debug.addCritter(s, 20, 5));
    await h.frames(1);
    expect(h.snapshot().screen).toBe("playing");
    await h.advance(DEATH_PAUSE);
    const s = h.snapshot();
    expect(s.screen).toBe("gameover");
    expect(s.reachedLevel).toBe(6);
    expect(h.cues).toContain(CUES.gameOver);
  });

  it("leaves a run with zero lives posed still playing", async () => {
    h.pose((s) => h.debug.setLives(s, 0));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    await h.advance(5);
    const s = h.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.phase).toBe("crossing");
  });

  it("wins the run on the hop that clears level 8", async () => {
    startCrossing(TOTAL_LEVELS);
    h.pose((s) => h.debug.clearVehicles(s));
    for (const index of [0, 1, 2, 3]) {
      h.pose((s) => h.debug.setBay(s, index, true));
    }
    h.pose((s) => h.debug.addCritter(s, 35, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("victory");
    expect(h.cues).toContain(CUES.victory);
  });

  it("earns a life for each bonus boundary a real award crosses", async () => {
    h.pose((s) => h.debug.setScore(s, BONUS_LIFE_EVERY - 20));
    expect(h.snapshot().lives).toBe(START_LIVES);
    h.pose((s) => h.debug.addCritter(s, 27, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().lives).toBe(START_LIVES + 1);
    expect(h.cues).toContain(CUES.bonusLife);

    startCrossing(TOTAL_LEVELS);
    h.pose((s) => h.debug.clearVehicles(s));
    h.pose((s) => h.debug.setLives(s, 60));
    h.pose((s) => h.debug.setScore(s, BONUS_LIFE_EVERY - 100));
    for (const index of [0, 1, 2, 3]) {
      h.pose((s) => h.debug.setBay(s, index, true));
    }
    h.pose((s) => h.debug.addCritter(s, 35, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    // The victory award is 250 a life, so sixty lives carry the score across two
    // boundaries in one award and earn two lives.
    expect(h.snapshot().lives).toBeGreaterThanOrEqual(62);
  });
});

// ---- Scoring ------------------------------------------------------------

describe("scoring", () => {
  beforeEach(() => {
    startCrossing();
  });

  it("pays a newly reached row once", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(SCORE_ROW);
    await h.advance(HOP_COOLDOWN);
    h.tap("ArrowDown");
    await h.frames(1);
    await h.advance(HOP_COOLDOWN);
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(SCORE_ROW);
  });

  it("pays the completing hop's whole total", async () => {
    h.pose((s) => h.debug.setTimer(s, 12));
    h.pose((s) => h.debug.addCritter(s, 11, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(
      SCORE_ROW + SCORE_BAY + SCORE_TIME_BONUS * 12,
    );
  });

  it("pays the time bonus by whole seconds left", async () => {
    h.pose((s) => h.debug.setTimer(s, 7.4));
    h.pose((s) => h.debug.addCritter(s, 11, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(
      SCORE_ROW + SCORE_BAY + SCORE_TIME_BONUS * 7,
    );
  });

  it("pays the bonus catch only for the bay holding it", async () => {
    h.pose((s) => h.debug.setTimer(s, 0));
    h.pose((s) => h.debug.setFishBay(s, 0));
    h.pose((s) => h.debug.addCritter(s, 27, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(SCORE_ROW + SCORE_BAY);

    startCrossing();
    h.pose((s) => h.debug.setScore(s, 0));
    h.pose((s) => h.debug.setTimer(s, 0));
    h.pose((s) => h.debug.setFishBay(s, 0));
    h.pose((s) => h.debug.addCritter(s, 3, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(SCORE_ROW + SCORE_BAY + SCORE_BONUS_CATCH);
  });

  it("pays the level and the victory awards on top", async () => {
    startCrossing(3);
    h.pose((s) => h.debug.clearVehicles(s));
    h.pose((s) => h.debug.setScore(s, 0));
    h.pose((s) => h.debug.setTimer(s, 0));
    for (const index of [0, 1, 2, 3]) {
      h.pose((s) => h.debug.setBay(s, index, true));
    }
    h.pose((s) => h.debug.addCritter(s, 35, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(SCORE_ROW + SCORE_BAY + SCORE_LEVEL * 3);

    startCrossing(TOTAL_LEVELS);
    h.pose((s) => h.debug.clearVehicles(s));
    h.pose((s) => h.debug.setTimer(s, 0));
    h.pose((s) => h.debug.setScore(s, 0));
    h.pose((s) => h.debug.setLives(s, 3));
    h.pose((s) => h.debug.setPhase(s, "crossing"));
    h.pose((s) => h.debug.setPhaseTimer(s, 0));
    for (const index of [0, 1, 2, 3]) {
      h.pose((s) => h.debug.setBay(s, index, true));
    }
    h.pose((s) => h.debug.addCritter(s, 35, 2));
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().score).toBe(
      SCORE_ROW +
        SCORE_BAY +
        SCORE_LEVEL * TOTAL_LEVELS +
        SCORE_VICTORY_LIFE * 3,
    );
  });

  it("scores nothing for a refused hop", async () => {
    h.pose((s) => h.debug.addCritter(s, 20, ROW_NEAR));
    h.tap("ArrowDown");
    await h.frames(1);
    expect(h.snapshot().score).toBe(0);
  });
});

// ---- Controls and screens ----------------------------------------------

describe("the controls", () => {
  it("hops the critter on every bound movement key", async () => {
    for (const [code, dc, dr] of [
      ["ArrowUp", 0, -1],
      ["ArrowDown", 0, 1],
      ["ArrowLeft", -1, 0],
      ["ArrowRight", 1, 0],
      ["KeyW", 0, -1],
      ["KeyS", 0, 1],
      ["KeyA", -1, 0],
      ["KeyD", 1, 0],
    ] as const) {
      startCrossing();
      h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
      h.tap(code);
      await h.frames(1);
      const { critter } = h.snapshot();
      expect([critter.col, critter.row]).toEqual([20 + dc, ROW_MEDIAN + dr]);
    }
  });

  it("does nothing at all for a key bound to no action", async () => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    const before = h.snapshot();
    h.tap("KeyZ");
    await h.frames(1);
    const after = h.snapshot();
    expect({ ...after, simTime: 0 }).toEqual({ ...before, simTime: 0 });
    expect(after.simTime).toBeGreaterThan(before.simTime);
  });

  it("moves the pause menu's highlight one item per press", async () => {
    startCrossing();
    h.pose((s) => h.debug.setScreen(s, "paused"));
    h.pose((s) => h.debug.setMenuIndex(s, 0));
    h.tap("ArrowDown");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(1);
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(0);
    expect(h.cues.filter((cue) => cue === CUES.menu)).toHaveLength(2);
  });

  it("opens a crossing from the title on either confirm key", async () => {
    h.tap("Enter");
    await h.frames(1);
    let s = h.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.level).toBe(1);
    expect(s.lives).toBe(START_LIVES);

    h.pose((st) => h.debug.reset(st));
    h.tap("Space");
    await h.frames(1);
    s = h.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.critter.present).toBe(true);
  });

  it("leaves the crossing the title laid down exactly as it laid it", async () => {
    // A crossing advances only on a frame that both began and ended on the
    // `playing` screen, so the frame the menu started the run on is the menu's: the
    // timer reads its full length and the critter has not been reached by anything.
    h.tap("Enter");
    await h.frames(1);
    const s = h.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.timer).toBe(s.timerMax);
    expect(s.timer).toBe(crossingTimer(1));
    expect(s.phase).toBe("crossing");
    expect(s.phaseTimer).toBe(0);
    expect(s.critter.x).toBe(tileCX(START_COL));
    expect(s.critter.y).toBe(tileCY(ROW_NEAR));
    expect(s.bears).toHaveLength(0);
  });

  it("pauses on either pause key and freezes the strait", async () => {
    for (const code of ["KeyP", "Escape"] as const) {
      startCrossing();
      h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
      h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", 200));
      h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 2));
      h.tap(code);
      await h.frames(1);
      expect(h.snapshot().screen).toBe("paused");
      const before = h.snapshot();
      await h.advance(3);
      const after = h.snapshot();
      expect(after.vehicles[0].x).toBe(before.vehicles[0].x);
      expect(after.critter.x).toBe(before.critter.x);
      expect(after.simTime).toBeGreaterThan(before.simTime);
    }
  });

  it("toggles the engine's mute bit from the mute key", async () => {
    startCrossing();
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(false);
  });
});

describe("the screens", () => {
  it("opens the how-to screen and comes back from it", async () => {
    h.tap("ArrowDown");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(1);
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("howto");
    h.tap("Escape");
    await h.frames(1);
    const s = h.snapshot();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
  });

  it("resumes, restarts and quits from the pause menu", async () => {
    startCrossing();
    h.pose((s) => h.debug.setScore(s, 500));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.tap("KeyP");
    await h.frames(1);
    h.tap("Enter");
    await h.frames(1);
    let s = h.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.score).toBe(500);
    expect(s.critter.row).toBe(ROW_MEDIAN);

    h.tap("KeyP");
    await h.frames(1);
    h.tap("ArrowDown");
    await h.frames(1);
    h.tap("Enter");
    await h.frames(1);
    s = h.snapshot();
    expect(s.screen).toBe("playing");
    expect(s.score).toBe(0);
    expect(s.level).toBe(1);
    expect(s.bays).toEqual([false, false, false, false, false]);

    h.tap("KeyP");
    await h.frames(1);
    h.tap("ArrowUp");
    await h.frames(1);
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });

  it("plays again and returns to the menu from both end screens", async () => {
    for (const screen of ["victory", "gameover"] as const) {
      h.pose((s) => h.debug.reset(s));
      h.pose((s) => h.debug.setScreen(s, screen));
      h.pose((s) => h.debug.setMenuIndex(s, 0));
      h.tap("Enter");
      await h.frames(1);
      let s = h.snapshot();
      expect(s.screen).toBe("playing");
      expect(s.level).toBe(1);
      expect(s.lives).toBe(START_LIVES);
      expect(s.score).toBe(0);

      h.pose((st) => h.debug.setScreen(st, screen));
      h.pose((st) => h.debug.setMenuIndex(st, 1));
      h.tap("Enter");
      await h.frames(1);
      s = h.snapshot();
      expect(s.screen).toBe("title");
      expect(ENDING_ITEMS).toHaveLength(2);
      expect(PAUSE_ITEMS).toHaveLength(3);
    }
  });
});

// ---- The surface itself -------------------------------------------------

describe("the debug surface", () => {
  it("reads every pose back through the snapshot", () => {
    startCrossing();
    h.pose((s) => h.debug.setScreen(s, "paused"));
    h.pose((s) => h.debug.setPhase(s, "clearing"));
    h.pose((s) => h.debug.setPhaseTimer(s, 1.25));
    h.pose((s) => h.debug.setMenuIndex(s, 2));
    h.pose((s) => h.debug.setScore(s, 4321));
    h.pose((s) => h.debug.setLives(s, 7));
    h.pose((s) => h.debug.setReachedLevel(s, 5));
    h.pose((s) => h.debug.setTimer(s, 9.5));
    h.pose((s) => h.debug.addCritter(s, 12, 7));
    h.pose((s) => h.debug.setCritterFacing(s, "left"));
    h.pose((s) => h.debug.setHopCooldown(s, 0.05));
    h.pose((s) => h.debug.setBestRow(s, 6));
    h.pose((s) => h.debug.setCritterX(s, 411));
    h.pose((s) => h.debug.setBay(s, 3, true));
    h.pose((s) => h.debug.setFishBay(s, 1));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "dogsled", 128));
    const vehicle = lastVehicle();
    h.pose((s) => h.debug.setVehicleX(s, vehicle, 200));
    h.pose((s) => h.debug.addFloe(s, 4, "raft3", 96));
    const floe = lastFloe();
    h.pose((s) => h.debug.setFloeX(s, floe, 160));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 1.5));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP, -1));
    h.pose((s) => h.debug.addBear(s, 8, 12));
    const bear = lastBear();
    h.pose((s) => h.debug.setBearTile(s, bear, 9, 13));
    h.pose((s) => h.debug.setBearPosition(s, bear, 300, 500));
    h.pose((s) => h.debug.setBearTarget(s, bear, 4, 5));
    h.pose((s) => h.debug.setBearSense(s, bear, false));
    h.pose((s) => h.debug.setBearRouting(s, bear, false));
    h.pose((s) => h.debug.setBearTravel(s, bear, false));

    const s = h.snapshot();
    expect(s.screen).toBe("paused");
    expect(s.phase).toBe("clearing");
    expect(s.phaseTimer).toBe(1.25);
    expect(s.menuIndex).toBe(2);
    expect(s.score).toBe(4321);
    expect(s.lives).toBe(7);
    expect(s.reachedLevel).toBe(5);
    expect(s.timer).toBe(9.5);
    expect(s.critter.present).toBe(true);
    expect(s.critter.x).toBe(411);
    expect(s.critter.row).toBe(7);
    expect(s.critter.facing).toBe("left");
    expect(s.critter.hopCooldown).toBe(0.05);
    expect(s.critter.bestRow).toBe(6);
    expect(s.bays[3]).toBe(true);
    expect(s.fishBay).toBe(1);
    expect(s.vehicles[s.vehicles.length - 1]).toMatchObject({
      id: vehicle,
      row: ICE_TOP,
      kind: "dogsled",
      x: 200,
      len: 2,
    });
    expect(s.floes[s.floes.length - 1]).toMatchObject({
      id: floe,
      row: 4,
      kind: "raft3",
      x: 160,
      len: 3,
    });
    expect(s.iceLanes.find((lane) => lane.row === ICE_TOP)).toEqual({
      row: ICE_TOP,
      dir: -1,
      speed: 1.5,
    });
    expect(s.bears[s.bears.length - 1]).toMatchObject({
      id: bear,
      col: 9,
      row: 13,
      stepCol: 9,
      stepRow: 13,
      x: 300,
      y: 500,
      target: { col: 4, row: 5 },
      sense: false,
      routing: false,
      travel: false,
    });
    expect(s.bearEmergence).toBe(false);
    expect(s.catchTest).toBe(false);
    expect(s.fishCadence).toBe(false);
    expect(s.timerRunning).toBe(false);
  });

  it("carries every field of the documented shape", () => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 10, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 30, ROW_MEDIAN));
    for (let row = 11; row <= 18; row += 1) {
      h.pose((s) => h.debug.addVehicle(s, row, "car", 64 * row));
    }
    for (let row = 2; row <= 9; row += 1) {
      h.pose((s) => h.debug.addFloe(s, row, "pan", 64 * row));
    }
    h.pose((s) => h.debug.setBay(s, 0, true));
    h.pose((s) => h.debug.setFishBay(s, 2));

    const s = h.snapshot();
    expect(Object.keys(s).sort()).toEqual(
      [
        "bayEmergencePlaceholder",
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
      ]
        .filter((key) => key !== "bayEmergencePlaceholder")
        .sort(),
    );
    expect(s.bears).toHaveLength(2);
    expect(s.iceLanes).toHaveLength(8);
    expect(s.waterLanes).toHaveLength(8);
    expect(typeof s.critter.footing).toBe("string");
    expect(typeof s.bears[0].swimming).toBe("boolean");
  });

  it("clears each roster without disturbing the others", () => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 10, ROW_MEDIAN));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", 100));
    h.pose((s) => h.debug.addFloe(s, 5, "pan", 100));
    h.pose((s) => h.debug.setBay(s, 1, true));
    h.pose((s) => h.debug.setFishBay(s, 3));

    h.pose((s) => h.debug.clearVehicles(s));
    let s = h.snapshot();
    expect(s.vehicles).toHaveLength(0);
    expect(s.floes).toHaveLength(1);
    expect(s.bears).toHaveLength(1);
    expect(s.critter.present).toBe(true);
    expect(s.bays[1]).toBe(true);
    expect(s.fishBay).toBe(3);

    h.pose((st) => h.debug.clearFloes(st));
    h.pose((st) => h.debug.clearBears(st));
    h.pose((st) => h.debug.removeCritter(st));
    h.pose((st) => h.debug.clearFish(st));
    s = h.snapshot();
    expect(s.floes).toHaveLength(0);
    expect(s.bears).toHaveLength(0);
    expect(s.critter.present).toBe(false);
    expect(s.fishBay).toBeNull();
    expect(s.bays[1]).toBe(true);

    h.pose((st) => h.debug.clearBays(st));
    s = h.snapshot();
    expect(s.bays).toEqual([false, false, false, false, false]);
    expect(s.level).toBe(1);
    expect(s.phase).toBe("crossing");
  });

  it("leaves a critter it has removed out of play entirely", async () => {
    startCrossing();
    h.pose((s) => h.debug.addFloe(s, 5, "raft4", tileCX(10) - 16));
    h.pose((s) => h.debug.setCritterTile(s, 11, 5));
    h.pose((s) => h.debug.setHopCooldown(s, 0.05));
    h.pose((s) => h.debug.removeCritter(s));
    const before = h.snapshot().critter;
    expect(before.present).toBe(false);
    expect(h.snapshot().waterLanes[5 - 2].speed).toBeGreaterThan(0);

    h.hold("ArrowUp");
    await h.advance(1);
    h.release("ArrowUp");

    const after = h.snapshot().critter;
    expect(after.present).toBe(false);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.hopCooldown).toBe(before.hopCooldown);
    expect(h.snapshot().lives).toBe(START_LIVES);
  });

  it("gives every entity a distinct id it keeps across a second", async () => {
    startCrossing();
    h.pose((s) => h.debug.addBear(s, 10, ROW_MEDIAN));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", 100));
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", 400));
    h.pose((s) => h.debug.addFloe(s, 5, "pan", 100));
    const before = h.snapshot();
    const ids = [
      ...before.bears.map((item) => item.id),
      ...before.vehicles.map((item) => item.id),
      ...before.floes.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 20));
    await h.advance(1);
    const after = h.snapshot();
    expect(after.vehicles.map((item) => item.id)).toEqual(
      before.vehicles.map((item) => item.id),
    );
  });

  it("restores the title state on reset, and leaves the mute bit alone", async () => {
    startCrossing(5);
    h.tap("KeyM");
    await h.frames(1);
    h.pose((s) => h.debug.setScore(s, 900));
    h.pose((s) => h.debug.setLives(s, 1));
    h.pose((s) => h.debug.addCritter(s, 3, 3));
    h.pose((s) => h.debug.addBear(s, 4, 4));
    h.pose((s) => h.debug.setBay(s, 2, true));
    h.pose((s) => h.debug.setFishBay(s, 4));
    h.pose((s) => h.debug.reset(s));

    const s = h.snapshot();
    expect(s.screen).toBe("title");
    expect(s.phase).toBe("crossing");
    expect(s.phaseTimer).toBe(0);
    expect(s.menuIndex).toBe(0);
    expect(s.score).toBe(0);
    expect(s.lives).toBe(START_LIVES);
    expect(s.level).toBe(1);
    expect(s.reachedLevel).toBe(1);
    expect(s.timer).toBe(crossingTimer(1));
    expect(s.critter.present).toBe(false);
    expect(s.bears).toHaveLength(0);
    expect(s.bays).toEqual([false, false, false, false, false]);
    expect(s.fishBay).toBeNull();
    expect(s.simTime).toBe(0);
    expect(s.bearEmergence).toBe(true);
    expect(s.catchTest).toBe(true);
    expect(s.fishCadence).toBe(true);
    expect(s.timerRunning).toBe(true);
    expect(s.vehicles.length).toBeGreaterThan(0);
    expect(s.muted).toBe(true);
  });

  it("reproduces a seeded run, and differs on another seed", async () => {
    const phasesFor = async (seed: number): Promise<number[]> => {
      h.pose((s) => h.debug.reset(s, { seed }));
      const laid = h.snapshot();
      h.pose((s) => h.debug.setScreen(s, "playing"));
      h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
      h.pose((s) => h.debug.setTimerRunning(s, false));
      h.pose((s) => h.debug.setBearEmergence(s, false));
      await h.advance(FISH_INTERVAL);
      const fish = h.snapshot().fishBay ?? -1;
      return [
        ...laid.vehicles.map((item) => item.x),
        ...laid.floes.map((item) => item.x),
        fish,
      ];
    };
    const first = await phasesFor(7);
    const again = await phasesFor(7);
    const other = await phasesFor(8);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("grants no bonus life for a posed score", () => {
    startCrossing();
    h.pose((s) => h.debug.setScore(s, BONUS_LIFE_EVERY * 3));
    expect(h.snapshot().lives).toBe(START_LIVES);
  });

  it("gates each world faculty on its own", async () => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.setBestRow(s, ROW_MEDIAN));
    await h.advance(10);
    let s = h.snapshot();
    expect(s.bears).toHaveLength(0);
    expect(s.fishBay).toBeNull();
    expect(s.timer).toBe(crossingTimer(1));

    h.pose((st) => h.debug.setTimerRunning(st, true));
    await h.advance(10);
    s = h.snapshot();
    expect(s.timer).toBeCloseTo(crossingTimer(1) - 10, 1);

    h.pose((st) => h.debug.setBearEmergence(st, true));
    await h.advance(1);
    expect(h.snapshot().bears).toHaveLength(1);
  });

  it("leaves the game unchanged when the surface is only read", async () => {
    startCrossing();
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    const before = h.snapshot();
    for (let index = 0; index < 5; index += 1) h.debug.snapshot(h.state);
    expect(h.snapshot()).toEqual(before);
    await h.frames(1);
  });
});

// ---- The render ---------------------------------------------------------

describe("the render", () => {
  it("draws every screen without touching the state", async () => {
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ] as const) {
      h.pose((s) => h.debug.setScreen(s, screen));
      h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
      h.pose((s) => h.debug.addBear(s, 21, ROW_MEDIAN));
      h.pose((s) => h.debug.setBay(s, 0, true));
      h.pose((s) => h.debug.setFishBay(s, 3));
      const before = h.snapshot();
      await h.frames(1);
      const after = h.snapshot();
      expect(after.screen).toBe(before.screen);
    }
  });

  it("draws the lunge where a bear caught the critter", async () => {
    startCrossing();
    h.pose((s) => h.debug.setCatchTest(s, true));
    h.pose((s) => h.debug.addCritter(s, 20, ROW_MEDIAN));
    h.pose((s) => h.debug.addBear(s, 20, ROW_MEDIAN));
    const id = lastBear();
    h.pose((s) => h.debug.setBearTravel(s, id, false));
    await h.frames(1);
    // The bear is off the roster on the tick of the catch, and the lunge is what
    // is drawn where it was: the render is exercised through the next frame.
    expect(h.snapshot().bears).toHaveLength(0);
    expect(h.snapshot().phase).toBe("dying");
    await h.frames(2);
    expect(h.snapshot().phase).toBe("dying");
  });
});

// ---- Timing arithmetic --------------------------------------------------

describe("the tick", () => {
  it("integrates a rate in whole ticks of TICK_DT", async () => {
    startCrossing();
    h.pose((s) => h.debug.addVehicle(s, ICE_TOP, "car", 0));
    h.pose((s) => h.debug.setLaneSpeed(s, ICE_TOP, 1));
    h.pose((s) => h.debug.setLaneDirection(s, ICE_TOP, 1));
    await h.frames(1);
    expect(h.snapshot().vehicles[0].x).toBeCloseTo(TILE * TICK_DT, 9);
  });
});
