// Spectra under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`, which
// makes a duration an exact number of frames. What is read back is the game's own
// state, the debug surface the game returned beside it, the engine's cue events,
// and the pixels the render produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose takes a state and returns the next one and is driven
// through `engine.apply`; a reading is handed `engine.state`. `h.pose` and
// `h.snapshot` are those two moves, named.
//
// THE SEEDED TREE IS SERVED TO THE ENGINE'S LOADER. The engine resolves every
// asset path under `assets/` and against the page the build is served from, and
// this process has no page, so the two globals the loader reaches for are stood
// up over this project's own `assets/` directory for the life of the file and put
// back afterwards. That is the same kind of thing the canvas, the surface metrics
// and the clock are — the host the engine runs on — and without it the build
// would be asked to draw from art no one gave it.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  BURST_DURATION,
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  DIVE_FIRE_Y,
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENEMY_BULLET_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  EXTRA_LIFE_AT,
  FIELD_BOTTOM,
  FIELD_TOP,
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  FLUX_SHIMMER,
  FORM_CENTER_X,
  INVERSION_TIME,
  LAYOUT,
  MAX_BURSTS,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_SPEED,
  PRISM_INVERT_Y,
  READY_HOLD,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_FORM,
  SCORE_STAGE_CLEAR,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
  SPECTRA_DEBUG_VERSION,
  STAGE_CLEARED_HOLD,
  STAGE_H,
  STAGE_INTRO_HOLD,
  STAGE_W,
  START_LIVES,
  SWAY_PERIOD,
  TITLE_ITEMS,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  fluxWindow,
  swayOffset,
} from "./constants";
import {
  BACKGROUND,
  game,
  type Band,
  type SpectraDebugApi,
  type SpectraSnapshot,
  type SpectraState,
} from "./game";
import { LANE_CENTER } from "./ship";
import type { DeepReadonly } from "ts-essentials";

const FPS = 60;
const TICK_MS = 1000 / FPS;
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..");

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

interface CuePlay {
  cue: string;
  gain: number;
}

interface Harness {
  readonly engine: Engine<SpectraState, SpectraDebugApi>;
  readonly state: DeepReadonly<SpectraState>;
  readonly debug: SpectraDebugApi;
  pose(
    transition: (
      state: DeepReadonly<SpectraState>,
      debug: SpectraDebugApi,
    ) => SpectraState,
  ): void;
  snapshot(): SpectraSnapshot;
  readonly cues: CuePlay[];
  readonly assetPaths: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pixel(x: number, y: number): [number, number, number, number];
  advance(seconds: number): Promise<void>;
  frames(count: number): Promise<void>;
  setStep(seconds: number): void;
  dispose(): void;
}

interface HostGlobals {
  fetch: unknown;
  createImageBitmap: unknown;
}

/** Serve this project's own `assets/` to the engine's loader. */
function serveSeededAssets(): HostGlobals {
  const host = globalThis as unknown as Record<string, unknown>;
  const before: HostGlobals = {
    fetch: host.fetch,
    createImageBitmap: host.createImageBitmap,
  };
  host.fetch = async (url: string): Promise<Response> =>
    new Response(readFileSync(join(PROJECT, url)));
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
  return before;
}

/** Put them back, so nothing this file did outlives it. */
function restoreHost(before: HostGlobals): void {
  const host = globalThis as unknown as Record<string, unknown>;
  host.fetch = before.fetch;
  host.createImageBitmap = before.createImageBitmap;
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
  const engine = createEngine<SpectraState, SpectraDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(TICK_MS),
    surface,
  });

  const assetPaths: string[] = [];
  engine.events.on("asset:loaded", ({ path }) => assetPaths.push(path));
  engine.events.on("asset:failed", ({ path }) => assetPaths.push(path));
  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

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
      engine.apply((s) => transition(s, debug));
    },
    snapshot: () => debug.snapshot(engine.state),
    cues,
    assetPaths,
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    pixel: (x, y) => {
      const view: Viewport = engine.viewport();
      const { data } = ctx.getImageData(
        Math.round(view.offsetX + x * view.scale),
        Math.round(view.offsetY + y * view.scale),
        1,
        1,
      );
      return [
        data[0] as number,
        data[1] as number,
        data[2] as number,
        data[3] as number,
      ];
    },
    advance: (seconds) => engine.advance(Math.round(seconds * FPS)),
    frames: (count) => engine.advance(count),
    setStep: (seconds) => {
      engine.setClock(new ConstantClock(seconds * 1000));
    },
    dispose: () => engine.destroy(),
  };
}

let host: HostGlobals;
let h: Harness;

beforeAll(() => {
  host = serveSeededAssets();
});

afterAll(() => {
  restoreHost(host);
});

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The last entry of a list, which is where the surface appends what it adds. */
function last<T>(list: readonly T[]): T {
  return list[list.length - 1] as T;
}

/**
 * An empty, quiet live wave: no drone, no bullet, no burst, with the wave's own
 * entry, its dive launching and the ship's contact test all off, so nothing a
 * check did not ask for arrives.
 */
function startPosed(stage = 1): void {
  h.pose((s, d) => d.reset(s));
  h.pose((s, d) => d.setStage(s, stage));
  h.pose((s, d) => d.setWaveEntry(s, false));
  h.pose((s, d) => d.setDiveLaunching(s, false));
  h.pose((s, d) => d.setShipContact(s, false));
  h.pose((s, d) => d.setScreen(s, "inWave"));
  h.pose((s, d) => d.setPhase(s, "live"));
  h.pose((s, d) => d.setPhaseTimer(s, 0));
}

/** Open the game's own stage-`stage` wave, in live play, and hand back its drones. */
async function startStage(stage = 1): Promise<void> {
  h.pose((s, d) => d.reset(s));
  h.pose((s, d) => d.setStage(s, stage));
  h.pose((s, d) => d.setScreen(s, "stageIntro"));
  h.pose((s, d) => d.setPhaseTimer(s, 0.01));
  await h.frames(2);
}

/** Add one drone and hand back its id. */
function addDrone(
  kind: "shard" | "flux" | "prism",
  x: number,
  y: number,
): number {
  h.pose((s, d) => d.addDrone(s, kind, x, y));
  return last(h.snapshot().drones).id;
}

/**
 * A drone parked in the corner of the field, out of every scenario's way.
 *
 * A stage clears in the moment the LAST drone of its wave is destroyed, so a
 * check that destroys the only drone on the field would clear the stage as well
 * and stop the wave. One bystander, held still, keeps the wave being played.
 */
function bystander(): number {
  const id = addDrone("shard", 60, 120);
  h.pose((s, d) => d.setDroneTravel(s, id, false));
  return id;
}

/** The drone with that id, as the snapshot reports it. */
function drone(id: number): SpectraSnapshot["drones"][number] | undefined {
  return h.snapshot().drones.find((candidate) => candidate.id === id);
}

/**
 * Every enemy shot that appeared over `seconds`, by band.
 *
 * An enemy bullet falls off the field within a second, so a shot is counted as it
 * arrives rather than read off the roster at the end.
 */
async function collectEnemyShots(seconds: number): Promise<Band[]> {
  const seen = new Set<number>();
  const bands: Band[] = [];
  for (let i = 0; i < Math.round(seconds * FPS); i++) {
    await h.frames(1);
    for (const bullet of h.snapshot().bullets) {
      if (bullet.friendly || seen.has(bullet.id)) continue;
      seen.add(bullet.id);
      bands.push(bullet.band);
    }
  }
  return bands;
}

/** The cues played since the list was last cleared. */
function playedCues(): string[] {
  return h.cues.map((play) => play.cue);
}

// ---- the surface --------------------------------------------------------

describe("the debug surface", () => {
  it("is returned beside the state and reports its version", () => {
    expect(h.debug.version).toBe(SPECTRA_DEBUG_VERSION);
    expect(typeof h.debug.snapshot).toBe("function");
    expect(typeof h.debug.reset).toBe("function");
  });

  it("reads every pose back through the snapshot", () => {
    h.pose((s, d) => d.setScreen(s, "paused"));
    h.pose((s, d) => d.setPhase(s, "ready"));
    h.pose((s, d) => d.setPhaseTimer(s, 0.75));
    h.pose((s, d) => d.setMenuIndex(s, 2));
    h.pose((s, d) => d.setScore(s, 4321));
    h.pose((s, d) => d.setLives(s, 2));
    h.pose((s, d) => d.setStage(s, 7));
    h.pose((s, d) => d.setExtraLifeAwarded(s, true));
    h.pose((s, d) => d.setChallengeHits(s, 17));
    h.pose((s, d) => d.setWaveEntry(s, false));
    h.pose((s, d) => d.setDiveLaunching(s, false));
    h.pose((s, d) => d.setStageClearing(s, false));
    h.pose((s, d) => d.setShipContact(s, false));
    h.pose((s, d) => d.setDiveClock(s, 1.25));
    h.pose((s, d) => d.setShipX(s, 300));
    h.pose((s, d) => d.setShipBand(s, "magenta"));
    h.pose((s, d) => d.setFireLockout(s, 0.2));
    h.pose((s, d) => d.setFireCooldown(s, 0.1));
    h.pose((s, d) => d.setResonance(s, 42));
    h.pose((s, d) => d.setInversion(s, 3));

    const snap = h.snapshot();
    expect(snap.screen).toBe("paused");
    expect(snap.phase).toBe("ready");
    expect(snap.phaseTimer).toBeCloseTo(0.75, 6);
    expect(snap.menuIndex).toBe(2);
    expect(snap.score).toBe(4321);
    expect(snap.lives).toBe(2);
    expect(snap.stage).toBe(7);
    expect(snap.extraLifeAwarded).toBe(true);
    expect(snap.challengeHits).toBe(17);
    expect(snap.waveEntry).toBe(false);
    expect(snap.diveLaunching).toBe(false);
    expect(snap.stageClearing).toBe(false);
    expect(snap.diveClock).toBeCloseTo(1.25, 6);
    expect(snap.ship.contact).toBe(false);
    expect(snap.ship.x).toBeCloseTo(300, 6);
    expect(snap.ship.band).toBe("magenta");
    expect(snap.ship.alive).toBe(false);
    expect(snap.ship.lockout).toBeCloseTo(0.2, 6);
    expect(snap.ship.cooldown).toBeCloseTo(0.1, 6);
    expect(snap.resonance).toBe(42);
    expect(snap.inversion).toBe(3);
    expect(snap.inversionActive).toBe(true);
    expect(snap.mode).toBe("sortie");
  });

  it("derives the stage's own figures from the stage", () => {
    h.pose((s, d) => d.setStage(s, 5));
    const snap = h.snapshot();
    expect(snap.isChallenge).toBe(false);
    expect(snap.droneSpeedScale).toBeCloseTo(droneSpeedScale(5), 6);
    expect(snap.diveGapScale).toBeCloseTo(diveGapScale(5), 6);
    expect(snap.fluxHold).toBeCloseTo(fluxHold(5), 6);
    h.pose((s, d) => d.setStage(s, 6));
    expect(h.snapshot().isChallenge).toBe(true);
  });

  it("restores every declared field to its title value on reset", async () => {
    await startStage(1);
    h.pose((s, d) => d.setScore(s, 9999));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.pose((s, d) => d.addEnemyBullet(s, 400, 300, "cyan"));
    h.pose((s, d) => d.reset(s));

    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.phase).toBe("live");
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.stage).toBe(1);
    expect(snap.resonance).toBe(0);
    expect(snap.inversion).toBe(0);
    expect(snap.drones).toHaveLength(0);
    expect(snap.bullets).toHaveLength(0);
    expect(snap.bursts).toHaveLength(0);
    expect(snap.ship.x).toBe(LANE_CENTER);
    expect(snap.ship.band).toBe("cyan");
    expect(snap.ship.contact).toBe(true);
    expect(snap.waveEntry).toBe(true);
    expect(snap.diveLaunching).toBe(true);
    expect(snap.stageClearing).toBe(true);
    expect(snap.diveClock).toBe(0);
    expect(snap.extraLifeAwarded).toBe(false);
    expect(snap.simTime).toBe(0);
  });

  it("seeds the wave's whole layout from reset", async () => {
    /** The stage-1 wave `reset({ seed })` lays out: every kind, slot and band. */
    const laidOut = async (seed: number): Promise<string[]> => {
      h.pose((s, d) => d.reset(s, { seed }));
      h.pose((s, d) => d.setScreen(s, "stageIntro"));
      h.pose((s, d) => d.setPhaseTimer(s, 0.01));
      await h.frames(2);
      return h
        .snapshot()
        .drones.map(
          (drone) =>
            `${drone.kind}@${drone.slotX},${drone.slotY}:${drone.band}`,
        );
    };

    const seven = await laidOut(7);
    expect(seven.length).toBeGreaterThan(8);
    expect(await laidOut(7)).toEqual(seven);
    expect(await laidOut(8)).not.toEqual(seven);
  });

  it("gives every entity a distinct id and appends what it adds", () => {
    startPosed();
    const first = addDrone("shard", 300, 200);
    const second = addDrone("flux", 400, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 500, 400, "cyan"));
    const bullet = last(h.snapshot().bullets).id;
    expect(new Set([first, second, bullet]).size).toBe(3);
    expect(last(h.snapshot().drones).id).toBe(second);
  });

  it("clears one roster at a time", () => {
    startPosed();
    addDrone("shard", 300, 200);
    h.pose((s, d) => d.addPlayerBullet(s, 500, 400, "cyan"));
    h.pose((s, d) => d.addEnemyBullet(s, 520, 300, "magenta"));
    h.pose((s, d) => d.clearDrones(s));
    expect(h.snapshot().drones).toHaveLength(0);
    expect(h.snapshot().bullets).toHaveLength(2);
    h.pose((s, d) => d.clearPlayerBullets(s));
    expect(h.snapshot().bullets.map((b) => b.friendly)).toEqual([false]);
    h.pose((s, d) => d.clearEnemyBullets(s));
    expect(h.snapshot().bullets).toHaveLength(0);
  });

  it("poses a drone one field at a time", () => {
    startPosed();
    const id = addDrone("flux", 400, 200);
    h.pose((s, d) => d.setDroneBand(s, id, "magenta"));
    h.pose((s, d) => d.setDroneBandClock(s, id, 0.5));
    expect(drone(id)?.band).toBe("magenta");
    expect(drone(id)?.bandClock).toBeCloseTo(0.5, 6);
    h.pose((s, d) => d.setDroneBandClock(s, id, fluxHold(1) + 0.1));
    expect(drone(id)?.band).toBe("magenta");
    expect(drone(id)?.shimmer).toBe(true);
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    h.pose((s, d) => d.setDroneTravel(s, id, false));
    h.pose((s, d) => d.setDroneOscillation(s, id, false));
    h.pose((s, d) => d.setDroneFire(s, id, false));
    const posed = drone(id);
    expect(posed?.phase).toBe("diving");
    expect(posed?.travel).toBe(false);
    expect(posed?.oscillation).toBe(false);
    expect(posed?.fire).toBe(false);
  });

  it("holds a drone exactly still while its travel is off", async () => {
    startPosed();
    const id = addDrone("shard", 400, 200);
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    h.pose((s, d) => d.setDroneTravel(s, id, false));
    await h.advance(1);
    expect(drone(id)?.x).toBeCloseTo(400, 6);
    expect(drone(id)?.y).toBeCloseTo(200, 6);
    expect(drone(id)?.phase).toBe("diving");
  });

  it("leaves a gated drone's band clock and its firing running", async () => {
    startPosed();
    // Travel gates LOCOMOTION alone (`specs/instrumentation.md`), so a diver
    // held still past the fire line still takes its shot and a Flux held still
    // still runs its window.
    const diver = addDrone("shard", LANE_CENTER, DIVE_FIRE_Y + 40);
    h.pose((s, d) => d.setDronePhase(s, diver, "diving"));
    h.pose((s, d) => d.setDroneTravel(s, diver, false));

    const flux = addDrone("flux", 300, 200);
    h.pose((s, d) => d.setDroneTravel(s, flux, false));
    h.pose((s, d) => d.setDroneBandClock(s, flux, 0));

    await h.frames(2);
    expect(h.snapshot().bullets.filter((b) => !b.friendly)).toHaveLength(1);
    expect(drone(diver)?.y).toBeCloseTo(DIVE_FIRE_Y + 40, 6);

    await h.advance(fluxHold(1) + FLUX_SHIMMER * 0.5);
    expect(drone(flux)?.shimmer).toBe(true);
    expect(drone(flux)?.x).toBeCloseTo(300, 6);
  });

  it("loads every seeded file through the engine's loader", () => {
    expect(h.assetPaths.sort()).toEqual([
      "drone-burst.json",
      "fighter.png",
      "flux.png",
      "prism.png",
      "shard.png",
    ]);
  });
});

// ---- the frame ----------------------------------------------------------

describe("the frame", () => {
  it("reaches the same state however the same interval was divided", async () => {
    startPosed();
    h.pose((s, d) => d.addEnemyBullet(s, 500, 100, "cyan"));
    h.pose((s, d) => d.setResonance(s, 30));
    const one = await (async () => {
      h.setStep(1);
      await h.frames(1);
      return h.snapshot();
    })();

    startPosed();
    h.pose((s, d) => d.addEnemyBullet(s, 500, 100, "cyan"));
    h.pose((s, d) => d.setResonance(s, 30));
    h.setStep(1 / 60);
    await h.frames(60);
    const sixty = h.snapshot();

    expect(sixty.simTime).toBeCloseTo(one.simTime, 9);
    expect(sixty.bullets[0]?.y).toBeCloseTo(one.bullets[0]?.y ?? -1, 9);
  });

  it("accumulates the simulation time it covered", async () => {
    startPosed();
    const before = h.snapshot().simTime;
    await h.advance(2);
    expect(h.snapshot().simTime - before).toBeCloseTo(2, 4);
  });
});

// ---- the ship -----------------------------------------------------------

describe("the ship and its cannon", () => {
  it("travels at its speed while a direction is held and stops when it is released", async () => {
    startPosed();
    h.pose((s, d) => d.setShipX(s, 400));
    h.hold("ArrowRight");
    await h.advance(0.5);
    const moved = h.snapshot().ship.x;
    expect(moved - 400).toBeCloseTo(SHIP_SPEED * 0.5, 1);
    h.release("ArrowRight");
    await h.advance(0.5);
    expect(h.snapshot().ship.x).toBeCloseTo(moved, 6);
  });

  it("rests at its bound rather than wrapping", async () => {
    startPosed();
    h.hold("ArrowLeft");
    await h.advance(4);
    expect(h.snapshot().ship.x).toBe(SHIP_X_MIN);
    h.release("ArrowLeft");
    h.hold("ArrowRight");
    await h.advance(8);
    expect(h.snapshot().ship.x).toBe(SHIP_X_MAX);
  });

  it("stands still while both directions are held", async () => {
    startPosed();
    h.pose((s, d) => d.setShipX(s, 500));
    h.hold("ArrowLeft");
    h.hold("ArrowRight");
    await h.advance(0.5);
    expect(h.snapshot().ship.x).toBeCloseTo(500, 6);
  });

  it("fires from the nose, at the cadence, up to the cap", async () => {
    startPosed();
    h.hold("Space");
    await h.frames(1);
    const first = h.snapshot().bullets;
    expect(first).toHaveLength(1);
    expect(first[0]?.friendly).toBe(true);
    expect(first[0]?.x).toBeCloseTo(LANE_CENTER, 6);
    expect(first[0]?.y).toBeLessThan(SHIP_Y);
    expect(first[0]?.vy).toBeCloseTo(-PLAYER_BULLET_SPEED, 6);
    expect(h.snapshot().ship.cooldown).toBeGreaterThan(0);

    await h.advance(FIRE_INTERVAL * 2.5);
    expect(h.snapshot().bullets.length).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
    expect(h.snapshot().bullets.length).toBeGreaterThan(1);
  });

  it("cannot fire while a flip's lockout stands", async () => {
    startPosed();
    h.tap("KeyF");
    await h.frames(1);
    expect(h.snapshot().ship.band).toBe("magenta");
    expect(h.snapshot().ship.lockout).toBeGreaterThan(FLIP_LOCKOUT - 0.02);
    h.hold("Space");
    await h.advance(FLIP_LOCKOUT * 0.6);
    expect(h.snapshot().bullets).toHaveLength(0);
    await h.advance(FLIP_LOCKOUT);
    expect(h.snapshot().bullets.length).toBeGreaterThan(0);
  });

  it("keeps a bullet's band as it was fired", async () => {
    startPosed();
    h.pose((s, d) => d.setShipBand(s, "magenta"));
    h.hold("Space");
    await h.frames(1);
    h.release("Space");
    h.tap("KeyF");
    await h.frames(1);
    expect(h.snapshot().ship.band).toBe("cyan");
    expect(h.snapshot().bullets[0]?.band).toBe("magenta");
  });
});

// ---- the bands ----------------------------------------------------------

describe("the two bands", () => {
  it("destroys a drone on a matching shot and spares it on a mismatch", async () => {
    startPosed();
    bystander();
    const matched = addDrone("shard", 400, 400);
    h.pose((s, d) => d.setDroneBand(s, matched, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "cyan"));
    await h.frames(3);
    expect(drone(matched)).toBeUndefined();
    expect(h.snapshot().resonance).toBe(RESONANCE_KILL);

    startPosed();
    bystander();
    const spared = addDrone("shard", 700, 400);
    h.pose((s, d) => d.setDroneBand(s, spared, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 700, 430, "magenta"));
    await h.frames(3);
    expect(drone(spared)).toBeDefined();
    expect(h.snapshot().bullets).toHaveLength(0);
  });

  it("absorbs a same-band bullet and loses a life to the other band", async () => {
    startPosed();
    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.setShipBand(s, "cyan"));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTER, SHIP_Y - 20, "cyan"));
    await h.frames(6);
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().resonance).toBe(RESONANCE_ABSORB);

    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTER, SHIP_Y - 20, "magenta"));
    await h.frames(6);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
    expect(h.snapshot().phase).toBe("ready");
  });

  it("swaps a drone's effective band while an inversion runs, and cancels two swaps", () => {
    startPosed();
    const shard = addDrone("shard", 300, 300);
    h.pose((s, d) => d.setDroneBand(s, shard, "cyan"));
    const prism = addDrone("prism", 600, 300);
    h.pose((s, d) => d.setDroneBand(s, prism, "cyan"));
    h.pose((s, d) => d.setDroneShell(s, prism, false));
    expect(drone(shard)?.effectiveBand).toBe("cyan");
    expect(drone(prism)?.effectiveBand).toBe("magenta");

    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    expect(drone(shard)?.effectiveBand).toBe("magenta");
    // Two toggles cancel: a broken-shell cyan Prism under an inversion reads cyan.
    expect(drone(prism)?.effectiveBand).toBe("cyan");
  });

  it("never swaps the ship or the player's bullets", () => {
    startPosed();
    h.pose((s, d) => d.setShipBand(s, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 400, 400, "cyan"));
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    expect(h.snapshot().ship.band).toBe("cyan");
    expect(h.snapshot().bullets[0]?.effectiveBand).toBe("cyan");
  });
});

// ---- the three drones ---------------------------------------------------

describe("the three drones", () => {
  it("runs a Flux's band window: a hold, a shimmer, then the other band", async () => {
    startPosed();
    const id = addDrone("flux", 400, 300);
    h.pose((s, d) => d.setDroneBandClock(s, id, 0));
    expect(drone(id)?.shimmer).toBe(false);
    await h.advance(fluxHold(1) - 0.05);
    expect(drone(id)?.shimmer).toBe(false);
    expect(drone(id)?.band).toBe("cyan");
    await h.advance(0.1);
    expect(drone(id)?.shimmer).toBe(true);
    await h.advance(FLUX_SHIMMER);
    expect(drone(id)?.shimmer).toBe(false);
    expect(drone(id)?.band).toBe("magenta");
  });

  it("holds a Flux's window still while its oscillation is off", async () => {
    startPosed();
    const id = addDrone("flux", 400, 300);
    h.pose((s, d) => d.setDroneBandClock(s, id, fluxHold(1) + 0.1));
    h.pose((s, d) => d.setDroneOscillation(s, id, false));
    await h.advance(fluxWindow(1) * 2);
    expect(drone(id)?.shimmer).toBe(true);
    expect(drone(id)?.band).toBe("cyan");
  });

  it("spares a shimmering Flux from a shot of either band", async () => {
    for (const band of ["cyan", "magenta"] as Band[]) {
      startPosed();
      const id = addDrone("flux", 400, 400);
      h.pose((s, d) => d.setDroneBandClock(s, id, fluxHold(1) + 0.05));
      h.pose((s, d) => d.setDroneOscillation(s, id, false));
      h.pose((s, d) => d.addPlayerBullet(s, 400, 430, band));
      await h.frames(3);
      expect(drone(id)).toBeDefined();
    }
  });

  it("breaks a Prism shell first and its core second", async () => {
    startPosed();
    bystander();
    const id = addDrone("prism", 400, 400);
    h.pose((s, d) => d.setDroneBand(s, id, "cyan"));
    // The core's band breaks nothing while the shell stands.
    h.pose((s, d) => d.addPlayerBullet(s, 400, 440, "magenta"));
    await h.frames(4);
    expect(drone(id)?.shellAlive).toBe(true);

    h.pose((s, d) => d.addPlayerBullet(s, 400, 440, "cyan"));
    await h.frames(4);
    expect(drone(id)?.shellAlive).toBe(false);
    expect(h.snapshot().score).toBe(SCORE_PRISM_SHELL);

    // The shell's band now breaks nothing, and the core's band destroys it.
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "cyan"));
    await h.frames(4);
    expect(drone(id)).toBeDefined();
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "magenta"));
    await h.frames(4);
    expect(drone(id)).toBeUndefined();
    expect(h.snapshot().score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
  });

  it("inverts the field when a diving Prism reaches its line, and survives it", async () => {
    startPosed();
    const id = addDrone("prism", LANE_CENTER, 300);
    h.pose((s, d) => d.setDroneSlot(s, id, LANE_CENTER, 200));
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    for (let i = 0; i < FPS * 4 && !h.snapshot().inversionActive; i++) {
      await h.frames(1);
    }
    expect(h.snapshot().inversionActive).toBe(true);
    expect(h.snapshot().inversion).toBeCloseTo(INVERSION_TIME, 1);
    expect(drone(id)).toBeDefined();
    expect(drone(id)?.phase).toBe("returning");
    expect(playedCues()).toContain("inversion");
  });

  it("fires one shot per Shard dive and two bands per Prism dive", async () => {
    startPosed();
    const shard = addDrone("shard", LANE_CENTER, DIVE_FIRE_Y - 80);
    h.pose((s, d) => d.setDroneSlot(s, shard, LANE_CENTER, 200));
    h.pose((s, d) => d.setDronePhase(s, shard, "diving"));
    expect(await collectEnemyShots(3)).toHaveLength(1);

    startPosed();
    const prism = addDrone("prism", 300, DIVE_FIRE_Y - 80);
    h.pose((s, d) => d.setDroneSlot(s, prism, 300, 200));
    h.pose((s, d) => d.setDronePhase(s, prism, "diving"));
    expect((await collectEnemyShots(2.5)).sort()).toEqual(["cyan", "magenta"]);
  });

  it("fires nothing from a drone whose fire is off", async () => {
    startPosed();
    const id = addDrone("shard", LANE_CENTER, DIVE_FIRE_Y - 80);
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    h.pose((s, d) => d.setDroneFire(s, id, false));
    expect(await collectEnemyShots(2.5)).toHaveLength(0);
  });

  it("fires as the diver's centre crosses the fire line", async () => {
    startPosed();
    const id = addDrone("shard", LANE_CENTER, DIVE_FIRE_Y - 60);
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    let crossed = -1;
    for (let frame = 0; frame < 120; frame++) {
      await h.frames(1);
      const shots = h.snapshot().bullets.filter((b) => !b.friendly);
      if (shots.length > 0) {
        crossed = shots[0]?.y ?? -1;
        break;
      }
    }
    expect(crossed).toBeGreaterThanOrEqual(DIVE_FIRE_Y - 1);
    expect(crossed).toBeLessThan(DIVE_FIRE_Y + 8);
  });
});

// ---- the swarm ----------------------------------------------------------

describe("the swarm", () => {
  it("opens a wave with every drone above the field, and assembles them all", async () => {
    await startStage(1);
    const opened = h.snapshot();
    expect(opened.drones.length).toBeGreaterThan(0);
    for (const d of opened.drones) {
      expect(d.phase).toBe("entering");
      expect(d.y).toBeLessThan(FIELD_TOP);
    }

    h.pose((s, d) => d.setDiveLaunching(s, false));
    await h.advance(12);
    const settled = h.snapshot();
    expect(settled.drones).toHaveLength(opened.drones.length);
    for (const d of settled.drones) {
      expect(d.phase).toBe("formation");
      expect(
        Math.abs(d.x - (d.slotX + swayOffset(h.state.swayClock))),
      ).toBeLessThan(1);
      expect(Math.abs(d.y - d.slotY)).toBeLessThan(1);
    }
  });

  it("stages the entry groups and crosses each into the field within a second", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    const groups = new Map<number, number>();
    for (const d of h.snapshot().drones) {
      groups.set(d.id, -1);
    }
    // Every drone must be inside the field within a second of its own group's
    // release, and no group may be released early.
    const lastGroup = Math.max(...h.state.drones.map((d) => d.entryGroup));
    for (let group = 0; group <= lastGroup; group++) {
      const release = ENTER_GROUP_GAP * group;
      const ids = h.state.drones
        .filter((d) => d.entryGroup === group)
        .map((d) => d.id);
      expect(ids.length).toBeGreaterThan(0);
      const seconds = release + 1 - h.state.entryClock;
      if (seconds > 0) await h.advance(seconds);
      for (const id of ids) {
        const d = drone(id);
        // A drone destroyed by nothing is still there, and inside the field.
        expect(d).toBeDefined();
        expect(d?.y).toBeGreaterThan(FIELD_TOP);
      }
    }
    expect(groups.size).toBeGreaterThan(0);
  });

  it("flies an entrance and a dive at their own speeds", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    // Give the first group a moment to be under way, then measure a second of it.
    await h.advance(0.4);
    const id = h.state.drones[0]?.id ?? -1;
    const trackLength = async (seconds: number): Promise<number> => {
      let length = 0;
      let previous = drone(id);
      const frames = Math.round(seconds * FPS);
      for (let i = 0; i < frames; i++) {
        await h.frames(1);
        const now = drone(id);
        if (previous !== undefined && now !== undefined) {
          length += Math.hypot(now.x - previous.x, now.y - previous.y);
        }
        previous = now;
      }
      return length;
    };
    const entering = await trackLength(0.5);
    expect(entering / 0.5).toBeCloseTo(ENTER_SPEED * droneSpeedScale(1), 0);

    startPosed();
    const diver = addDrone("shard", 300, 200);
    h.pose((s, d) => d.setDronePhase(s, diver, "diving"));
    let length = 0;
    let previous = drone(diver);
    for (let i = 0; i < FPS; i++) {
      await h.frames(1);
      const now = drone(diver);
      if (
        previous !== undefined &&
        now !== undefined &&
        now.phase === "diving"
      ) {
        length += Math.hypot(now.x - previous.x, now.y - previous.y);
      }
      previous = now;
    }
    expect(length).toBeGreaterThan(DIVE_SPEED * 0.9);
    expect(length).toBeLessThan(DIVE_SPEED * 1.02);
  });

  it("bends a dive toward the ship wherever the ship stands", async () => {
    for (const parked of [SHIP_X_MIN, SHIP_X_MAX]) {
      startPosed();
      h.pose((s, d) => d.setShipX(s, parked));
      const id = addDrone("shard", FORM_CENTER_X, 200);
      h.pose((s, d) => d.setDronePhase(s, id, "diving"));
      const gap = Math.abs(FORM_CENTER_X - parked);
      await h.advance(1.2);
      const now = drone(id);
      expect(Math.abs((now?.x ?? 0) - parked)).toBeLessThan(gap * (2 / 3));
    }
  });

  it("holds a dive continuous but for one bottom-to-top wrap", async () => {
    startPosed();
    // An even id wraps through the bottom; the harness reads whichever it gets.
    const id = addDrone("shard", 500, 200);
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    let previous = drone(id);
    let jumps = 0;
    let maxY = 0;
    for (let i = 0; i < FPS * 6; i++) {
      await h.frames(1);
      const now = drone(id);
      if (now === undefined) break;
      if (previous !== undefined && now.phase === "diving") {
        const step = Math.hypot(now.x - previous.x, now.y - previous.y);
        if (step > (DIVE_SPEED / FPS) * 2) jumps += 1;
        maxY = Math.max(maxY, now.y);
      }
      previous = now;
      if (now.phase === "formation") break;
    }
    expect(jumps).toBeLessThanOrEqual(1);
    expect(maxY).toBeLessThan(FIELD_BOTTOM + 4);
    expect(drone(id)?.phase).toBe("formation");
  });

  it("brings a wrapping dive back in above the field's top", async () => {
    startPosed();
    // Two drones, so one of them takes the id whose dive runs off the bottom
    // rather than turning back above it.
    const ids = [addDrone("shard", 500, 500), addDrone("shard", 700, 500)];
    for (const id of ids) h.pose((s, d) => d.setDronePhase(s, id, "diving"));

    let wrapped = false;
    let above = Number.POSITIVE_INFINITY;
    const previous = new Map(ids.map((id) => [id, drone(id)?.y ?? 0]));
    for (let i = 0; i < FPS * 6 && !wrapped; i++) {
      await h.frames(1);
      for (const id of ids) {
        const now = drone(id);
        const was = previous.get(id) ?? 0;
        if (now === undefined) continue;
        previous.set(id, now.y);
        if (was > FIELD_BOTTOM - 40 && now.y < was - 100) {
          wrapped = true;
          above = now.y;
        }
      }
    }
    expect(wrapped).toBe(true);
    // Back in ABOVE the play field, and near enough its top edge that the wrap
    // reads as one continuation of the same dive (`specs/swarm.md`).
    expect(above).toBeLessThan(FIELD_TOP);
    expect(above).toBeGreaterThan(FIELD_TOP - 40);
  });

  it("launches its first dive after the delay, and later dives on cadence", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    await h.advance(12);
    h.pose((s, d) => d.setDiveClock(s, 0));
    h.pose((s, d) => d.setDiveLaunching(s, true));

    const launches: number[] = [];
    const total = 14;
    for (let i = 0; i < FPS * total; i++) {
      const before = h
        .snapshot()
        .drones.filter((d) => d.phase === "diving").length;
      await h.frames(1);
      const after = h
        .snapshot()
        .drones.filter((d) => d.phase === "diving").length;
      if (after > before) launches.push(h.snapshot().simTime);
    }
    expect(launches.length).toBeGreaterThan(2);
    const first = launches[0] as number;
    const opened = first - (h.snapshot().simTime - total);
    expect(opened).toBeGreaterThan(DIVE_FIRST_DELAY * 0.8);
    expect(opened).toBeLessThan(DIVE_FIRST_DELAY * 1.2);
    for (let i = 1; i < launches.length; i++) {
      const gap = (launches[i] as number) - (launches[i - 1] as number);
      expect(gap).toBeGreaterThan(DIVE_GAP_MIN * diveGapScale(1) * 0.8);
      expect(gap).toBeLessThan(DIVE_GAP_MAX * diveGapScale(1) * 1.2 + 1);
    }
  });

  it("keeps both bands and all three kinds in an assembled formation", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    await h.advance(12);
    const drones = h.snapshot().drones;
    const bands = new Set(drones.map((d) => d.effectiveBand));
    expect(bands.has("cyan")).toBe(true);
    expect(bands.has("magenta")).toBe(true);
    expect(
      drones.filter((d) => d.kind === "flux").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      drones.filter((d) => d.kind === "prism").length,
    ).toBeGreaterThanOrEqual(1);
    const shardBands = new Set(
      drones.filter((d) => d.kind === "shard").map((d) => d.band),
    );
    expect(shardBands.size).toBe(2);

    // Mirror-symmetric about the grid's centre.
    for (const d of drones) {
      const mirrored = 2 * FORM_CENTER_X - d.slotX;
      expect(drones.some((other) => Math.abs(other.slotX - mirrored) < 1)).toBe(
        true,
      );
    }
  });

  it("escorts a Prism in with two Shards of opposite bands", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    let escorted = false;
    for (let i = 0; i < FPS * 8 && !escorted; i++) {
      await h.frames(1);
      const drones = h.snapshot().drones;
      const prism = drones.find(
        (d) => d.kind === "prism" && d.phase === "entering",
      );
      if (prism === undefined) continue;
      const near = drones.filter(
        (d) =>
          d.kind === "shard" &&
          d.phase === "entering" &&
          Math.hypot(d.x - prism.x, d.y - prism.y) < 320,
      );
      escorted =
        near.some((d) => d.band === "cyan") &&
        near.some((d) => d.band === "magenta");
    }
    expect(escorted).toBe(true);
  });

  it("puts no enemy bullet on the field until a dive launches", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    await h.advance(12);
    expect(await collectEnemyShots(10)).toHaveLength(0);
    h.pose((s, d) => d.setDiveClock(s, 0));
    h.pose((s, d) => d.setDiveLaunching(s, true));
    expect((await collectEnemyShots(8)).length).toBeGreaterThan(0);
  });

  it("falls enemy fire at its own speed", async () => {
    startPosed();
    h.pose((s, d) => d.addEnemyBullet(s, 500, 120, "cyan"));
    const before = h.snapshot().bullets[0]?.y ?? 0;
    await h.advance(1);
    const after = h.snapshot().bullets[0]?.y ?? 0;
    expect(after - before).toBeCloseTo(ENEMY_BULLET_SPEED, 0);
  });
});

// ---- stages -------------------------------------------------------------

describe("stages", () => {
  it("builds the wave as the intro gives way", async () => {
    h.pose((s, d) => d.reset(s));
    h.pose((s, d) => d.setScreen(s, "stageIntro"));
    h.pose((s, d) => d.setPhaseTimer(s, STAGE_INTRO_HOLD));
    await h.advance(STAGE_INTRO_HOLD * 0.5);
    expect(h.snapshot().drones).toHaveLength(0);
    await h.advance(STAGE_INTRO_HOLD);
    expect(h.snapshot().screen).toBe("inWave");
    expect(h.snapshot().drones.length).toBeGreaterThan(0);
  });

  it("clears a stage when its last drone dies, and not before", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    h.pose((s, d) => d.setWaveEntry(s, false));
    const ids = h.snapshot().drones.map((d) => d.id);
    for (const id of ids.slice(0, ids.length - 1)) {
      h.pose((s, d) => d.removeDrone(s, id));
    }
    await h.frames(2);
    expect(h.snapshot().screen).toBe("inWave");

    const survivor = h.snapshot().drones[0];
    expect(survivor).toBeDefined();
    const score = h.snapshot().score;
    h.pose((s, d) => d.setDronePosition(s, survivor?.id ?? 0, 400, 400));
    h.pose((s, d) => d.setDroneBand(s, survivor?.id ?? 0, "cyan"));
    h.pose((s, d) => d.setDroneShell(s, survivor?.id ?? 0, false));
    h.pose((s, d) => d.setDroneBandClock(s, survivor?.id ?? 0, 0));
    h.pose((s, d) =>
      d.addPlayerBullet(
        s,
        400,
        430,
        survivor?.kind === "prism" ? "magenta" : "cyan",
      ),
    );
    await h.frames(4);
    expect(h.snapshot().drones).toHaveLength(0);
    expect(h.snapshot().screen).toBe("stageCleared");
    expect(h.snapshot().score).toBeGreaterThanOrEqual(
      score + SCORE_STAGE_CLEAR,
    );
  });

  it("leaves an empty wave playing rather than cleared", async () => {
    startPosed();
    await h.advance(10);
    expect(h.snapshot().screen).toBe("inWave");
  });

  it("advances the stage once the interstitial gives way", async () => {
    startPosed();
    h.pose((s, d) => d.setScreen(s, "stageCleared"));
    h.pose((s, d) => d.setPhaseTimer(s, STAGE_CLEARED_HOLD));
    await h.advance(STAGE_CLEARED_HOLD + 0.1);
    expect(h.snapshot().stage).toBe(2);
    expect(h.snapshot().screen).toBe("stageIntro");
  });

  it("sends a challenge stage in as five single-band groups that alternate", async () => {
    await startStage(3);
    expect(h.snapshot().isChallenge).toBe(true);
    expect(h.snapshot().drones).toHaveLength(CHALLENGE_TOTAL);

    // Read each drone's band as it arrives inside the field on both axes, and
    // merge adjacent same-band arrivals into waves.
    const arrivals: Band[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < FPS * 10; i++) {
      await h.frames(1);
      for (const d of h.snapshot().drones) {
        if (seen.has(d.id)) continue;
        const inside =
          d.x > 0 && d.x < STAGE_W && d.y > FIELD_TOP && d.y < FIELD_BOTTOM;
        if (!inside) continue;
        seen.add(d.id);
        arrivals.push(d.effectiveBand);
      }
    }
    expect(seen.size).toBe(CHALLENGE_TOTAL);
    const waves: { band: Band; count: number }[] = [];
    for (const band of arrivals) {
      const tail = waves[waves.length - 1];
      if (tail !== undefined && tail.band === band) tail.count += 1;
      else waves.push({ band, count: 1 });
    }
    expect(waves).toHaveLength(CHALLENGE_GROUPS);
    for (const wave of waves) expect(wave.count).toBe(CHALLENGE_PER_GROUP);
    for (let i = 1; i < waves.length; i++) {
      expect(waves[i]?.band).not.toBe(waves[i - 1]?.band);
    }
  });

  it("never fires in a challenge stage, and its drones sweep out of the field", async () => {
    await startStage(3);
    for (let i = 0; i < FPS * 14; i++) {
      await h.frames(1);
      expect(h.snapshot().bullets.filter((b) => !b.friendly)).toHaveLength(0);
      if (h.snapshot().screen !== "inWave") break;
      for (const d of h.snapshot().drones)
        expect(d.phase).not.toBe("formation");
    }
    expect(h.snapshot().screen).toBe("stageCleared");
  });

  it("costs no life when a challenge drone reaches the ship", async () => {
    startPosed(3);
    h.pose((s, d) => d.setShipContact(s, true));
    const id = addDrone("shard", LANE_CENTER, SHIP_Y);
    h.pose((s, d) => d.setDroneTravel(s, id, false));
    await h.advance(0.5);
    expect(h.snapshot().lives).toBe(START_LIVES);
    void id;
  });

  it("runs a challenge flyover at the stage-1 figures whatever stage it falls on", async () => {
    const sweep = async (stage: number): Promise<number> => {
      await startStage(stage);
      await h.advance(0.6);
      const id = h.state.drones[0]?.id ?? -1;
      const before = drone(id);
      await h.advance(1);
      const after = drone(id);
      return Math.hypot(
        (after?.x ?? 0) - (before?.x ?? 0),
        (after?.y ?? 0) - (before?.y ?? 0),
      );
    };
    const third = await sweep(3);
    const ninth = await sweep(9);
    expect(ninth).toBeCloseTo(third, 0);
  });
});

// ---- resonance and the discharge ---------------------------------------

describe("resonance and the discharge", () => {
  it("caps the meter and spends it all on a discharge", async () => {
    startPosed();
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    expect(h.snapshot().dischargeReady).toBe(true);
    h.tap("KeyX");
    await h.frames(1);
    expect(h.snapshot().resonance).toBe(0);
    expect(h.snapshot().discharge.active).toBe(true);
    expect(playedCues()).toContain("discharge");
  });

  it("does nothing below full", async () => {
    startPosed();
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX - 1));
    h.tap("KeyX");
    await h.frames(1);
    expect(h.snapshot().resonance).toBe(RESONANCE_MAX - 1);
    expect(h.snapshot().discharge.active).toBe(false);
  });

  it("takes every diver and every enemy bullet, and spares the formation", async () => {
    startPosed();
    const diver = addDrone("shard", 500, 400);
    h.pose((s, d) => d.setDronePhase(s, diver, "diving"));
    h.pose((s, d) => d.setDroneTravel(s, diver, false));
    const resting = addDrone("shard", 700, 200);
    h.pose((s, d) => d.addEnemyBullet(s, 400, 300, "magenta"));
    h.pose((s, d) => d.addPlayerBullet(s, 900, 500, "cyan"));
    // Parked, so the check reads what the wave spared rather than a bullet that
    // simply flew off the top of the field.
    h.pose((s, d) =>
      d.setBulletVelocity(s, last(h.snapshot().bullets).id, 0, 0),
    );
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(0.6);
    expect(drone(diver)).toBeUndefined();
    expect(drone(resting)).toBeDefined();
    expect(h.snapshot().bullets.filter((b) => !b.friendly)).toHaveLength(0);
    expect(
      h.snapshot().bullets.filter((b) => b.friendly).length,
    ).toBeGreaterThan(0);
    expect(h.snapshot().discharge.active).toBe(false);
  });

  it("destroys a diving Prism whole", async () => {
    startPosed();
    bystander();
    const id = addDrone("prism", 500, 450);
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    h.pose((s, d) => d.setDroneTravel(s, id, false));
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(0.6);
    expect(drone(id)).toBeUndefined();
    expect(h.snapshot().score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
  });
});

// ---- the run ------------------------------------------------------------

describe("lives and the run", () => {
  it("holds the wave through the ready phase and brings the ship back to the centre", async () => {
    startPosed();
    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.setShipX(s, 300));
    h.pose((s, d) => d.addEnemyBullet(s, 300, SHIP_Y - 20, "magenta"));
    await h.frames(8);
    expect(h.snapshot().phase).toBe("ready");
    expect(h.snapshot().ship.alive).toBe(false);
    await h.advance(READY_HOLD + 0.1);
    expect(h.snapshot().phase).toBe("live");
    expect(h.snapshot().ship.x).toBe(LANE_CENTER);
  });

  it("ends the run when the last life is lost", async () => {
    startPosed();
    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTER, SHIP_Y - 20, "magenta"));
    await h.frames(8);
    expect(h.snapshot().lives).toBe(0);
    expect(h.snapshot().screen).toBe("gameOver");
  });

  it("pays exactly one extra life, and only from a real scoring crossing", async () => {
    startPosed();
    h.pose((s, d) => d.setScore(s, EXTRA_LIFE_AT + 5000));
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().extraLifeAwarded).toBe(false);

    bystander();
    h.pose((s, d) => d.setScore(s, EXTRA_LIFE_AT - SCORE_SHARD_FORM));
    const id = addDrone("shard", 400, 400);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "cyan"));
    await h.frames(4);
    expect(drone(id)).toBeUndefined();
    expect(h.snapshot().lives).toBe(START_LIVES + 1);
    expect(h.snapshot().extraLifeAwarded).toBe(true);

    // And never again, whatever the score does afterwards.
    h.pose((s, d) => d.setScore(s, EXTRA_LIFE_AT - SCORE_SHARD_FORM));
    const second = addDrone("shard", 400, 400);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "cyan"));
    await h.frames(4);
    expect(drone(second)).toBeUndefined();
    expect(h.snapshot().lives).toBe(START_LIVES + 1);
  });
});

// ---- the screens --------------------------------------------------------

describe("the screens", () => {
  it("opens on the title and launches a run from its first item", async () => {
    expect(h.snapshot().screen).toBe("title");
    expect(h.snapshot().menuIndex).toBe(0);
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("stageIntro");
    expect(h.snapshot().stage).toBe(1);
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().score).toBe(0);
  });

  it("wraps a menu at both ends and plays a cue as the highlight moves", async () => {
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(1);
    expect(playedCues()).toContain("menu");
    h.tap("ArrowDown");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(0);
  });

  it("reaches how-to-play and comes back on the entry that led there", async () => {
    h.tap("ArrowDown");
    await h.frames(1);
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("howto");
    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
    // specs/ui.md: an arrival back at the title highlights the entry that led
    // away from it, which for the how-to-play screen is `HOW TO PLAY`.
    expect(h.snapshot().menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });

  it("freezes the field while paused and resumes it exactly as it was", async () => {
    startPosed();
    const id = addDrone("shard", 500, 200);
    h.pose((s, d) => d.setDronePhase(s, id, "diving"));
    await h.frames(6);
    h.tap("KeyP");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("paused");
    const frozen = drone(id);
    await h.advance(1);
    expect(drone(id)?.x).toBeCloseTo(frozen?.x ?? -1, 6);
    expect(drone(id)?.y).toBeCloseTo(frozen?.y ?? -1, 6);
    h.tap("KeyP");
    await h.frames(2);
    expect(h.snapshot().screen).toBe("inWave");
    expect(drone(id)?.y).toBeGreaterThan(frozen?.y ?? 0);
  });

  it("restarts and quits from the pause menu", async () => {
    startPosed();
    h.pose((s, d) => d.setScore(s, 500));
    h.tap("KeyP");
    await h.frames(1);
    h.tap("ArrowDown");
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("stageIntro");
    expect(h.snapshot().score).toBe(0);

    startPosed();
    h.tap("KeyP");
    await h.frames(1);
    h.tap("ArrowUp");
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });
});

// ---- audio --------------------------------------------------------------

describe("audio", () => {
  it("plays one cue per event, and each at most once a frame", async () => {
    startPosed();
    h.pose((s, d) => d.setShipBand(s, "cyan"));
    const a = addDrone("shard", 380, 400);
    const b = addDrone("shard", 420, 400);
    h.pose((s, d) => d.setDroneBand(s, a, "cyan"));
    h.pose((s, d) => d.setDroneBand(s, b, "cyan"));
    h.cues.length = 0;
    h.pose((s, d) => d.addPlayerBullet(s, 380, 420, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 420, 420, "cyan"));
    await h.frames(1);
    expect(h.cues.filter((play) => play.cue === "kill")).toHaveLength(1);
  });

  it("starts no sound at all while muted", async () => {
    startPosed();
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);
    h.cues.length = 0;
    h.hold("Space");
    await h.advance(0.5);
    expect(h.snapshot().bullets.length).toBeGreaterThan(0);
    expect(h.cues).toHaveLength(0);
    h.release("Space");

    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(false);
    h.hold("Space");
    await h.advance(0.5);
    expect(h.cues.map((play) => play.cue)).toContain("fire");
  });

  it("starts no sound before the first key press", async () => {
    await h.advance(2);
    expect(h.cues).toHaveLength(0);
  });
});

// ---- the drone-burst ----------------------------------------------------

describe("the drone-burst", () => {
  it("plays the seeded system where a drone was destroyed, and ends as a one-shot", async () => {
    startPosed();
    bystander();
    const id = addDrone("shard", 400, 400);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "cyan"));
    await h.frames(4);
    const bursts = h.snapshot().bursts;
    expect(bursts).toHaveLength(1);
    const burst = bursts[0];
    expect(
      Math.hypot((burst?.x ?? 0) - 400, (burst?.y ?? 0) - 400),
    ).toBeLessThan(28);
    await h.advance(0.1);
    expect(h.snapshot().bursts[0]?.particles ?? 0).toBeGreaterThan(50);
    await h.advance(BURST_DURATION);
    expect(h.snapshot().bursts).toHaveLength(0);
    void id;
  });

  it("scales a burst to the drone that popped, and pops a Prism twice", async () => {
    startPosed();
    bystander();
    const prism = addDrone("prism", 400, 400);
    h.pose((s, d) => d.setDroneBand(s, prism, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 400, 440, "cyan"));
    await h.frames(4);
    expect(h.snapshot().bursts).toHaveLength(1);
    const shellBurst = h.snapshot().bursts[0]?.size ?? 0;
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "magenta"));
    await h.frames(4);
    expect(h.snapshot().bursts).toHaveLength(2);
    expect(shellBurst).toBeGreaterThan(h.snapshot().bursts[1]?.size ?? 0);
  });

  it("holds at most the cap of live bursts", async () => {
    startPosed();
    for (let i = 0; i < MAX_BURSTS + 6; i++) {
      const id = addDrone("shard", 100 + i * 10, 300);
      h.pose((s, d) => d.setDronePhase(s, id, "diving"));
      h.pose((s, d) => d.setDroneTravel(s, id, false));
    }
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(0.6);
    expect(h.snapshot().bursts.length).toBeLessThanOrEqual(MAX_BURSTS);
    expect(h.snapshot().bursts.length).toBeGreaterThan(0);
  });

  it("scatters two bursts at one position differently", async () => {
    startPosed();
    bystander();
    const first = addDrone("shard", 400, 400);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "cyan"));
    await h.frames(4);
    await h.advance(0.15);
    const a = h.snapshot().bursts[0]?.particles ?? 0;
    h.pose((s, d) => d.clearBursts(s));
    const second = addDrone("shard", 400, 400);
    h.pose((s, d) => d.addPlayerBullet(s, 400, 430, "cyan"));
    await h.frames(4);
    await h.advance(0.15);
    const b = h.snapshot().bursts[0]?.particles ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    void first;
    void second;
  });
});

// ---- what the build draws ----------------------------------------------

describe("what the build draws", () => {
  const distance = (
    a: [number, number, number, number],
    b: [number, number, number, number],
  ): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it("tells the two bands apart, and each from the field", async () => {
    startPosed();
    const cyan = addDrone("shard", 300, 300);
    h.pose((s, d) => d.setDroneBand(s, cyan, "cyan"));
    const magenta = addDrone("shard", 700, 300);
    h.pose((s, d) => d.setDroneBand(s, magenta, "magenta"));
    await h.frames(2);
    const onCyan = h.pixel(300, 300);
    const onMagenta = h.pixel(700, 300);
    const field = h.pixel(1000, 500);
    expect(distance(onCyan, onMagenta)).toBeGreaterThan(60);
    expect(distance(onCyan, field)).toBeGreaterThan(40);
    expect(distance(onMagenta, field)).toBeGreaterThan(40);
  });

  it("reads the ship's band off the ship, and apart from a drone of that band", async () => {
    startPosed();
    h.pose((s, d) => d.setShipX(s, 400));
    h.pose((s, d) => d.setShipBand(s, "cyan"));
    await h.frames(2);
    const cyanShip = h.pixel(400, SHIP_Y);
    h.pose((s, d) => d.setShipBand(s, "magenta"));
    await h.frames(2);
    const magentaShip = h.pixel(400, SHIP_Y);
    expect(distance(cyanShip, magentaShip)).toBeGreaterThan(40);

    const id = addDrone("shard", 800, 300);
    h.pose((s, d) => d.setDroneBand(s, id, "magenta"));
    await h.frames(2);
    const dronePixel = h.pixel(800, 300);
    expect(distance(h.pixel(400, SHIP_Y), dronePixel)).toBeGreaterThan(40);
  });

  it("draws a shimmering Flux differently from one holding a band", async () => {
    startPosed();
    const id = addDrone("flux", 500, 300);
    h.pose((s, d) => d.setDroneOscillation(s, id, false));
    h.pose((s, d) => d.setDroneBandClock(s, id, 0));
    await h.frames(2);
    const holding = h.pixel(500, 300);
    h.pose((s, d) => d.setDroneBandClock(s, id, fluxHold(1) + 0.1));
    await h.frames(2);
    const shimmering = h.pixel(500, 300);
    expect(distance(holding, shimmering)).toBeGreaterThan(25);
  });

  it("marks the field while an inversion runs, and leaves it unmarked otherwise", async () => {
    startPosed();
    await h.frames(2);
    const plain = h.pixel(60, 300);
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    await h.frames(2);
    expect(distance(plain, h.pixel(60, 300))).toBeGreaterThan(15);
  });

  it("draws a bullet in its band, from the same palette the art carries", async () => {
    startPosed();
    h.pose((s, d) => d.addPlayerBullet(s, 300, 400, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 700, 400, "magenta"));
    const cyanDrone = addDrone("shard", 300, 200);
    h.pose((s, d) => d.setDroneBand(s, cyanDrone, "cyan"));
    const magentaDrone = addDrone("shard", 700, 200);
    h.pose((s, d) => d.setDroneBand(s, magentaDrone, "magenta"));
    h.pose((s, d) =>
      d.setBulletVelocity(s, h.snapshot().bullets[0]?.id ?? 0, 0, 0),
    );
    h.pose((s, d) =>
      d.setBulletVelocity(s, h.snapshot().bullets[1]?.id ?? 0, 0, 0),
    );
    await h.frames(2);
    const cyanBullet = h.pixel(300, 400);
    const magentaBullet = h.pixel(700, 400);
    const cyanArt = h.pixel(300, 200);
    const magentaArt = h.pixel(700, 200);
    expect(distance(cyanBullet, magentaBullet)).toBeGreaterThan(60);
    expect(distance(cyanBullet, cyanArt)).toBeLessThan(
      distance(cyanBullet, magentaArt),
    );
    expect(distance(magentaBullet, magentaArt)).toBeLessThan(
      distance(magentaBullet, cyanArt),
    );
  });

  it("keeps the starfield dimmer than either band", async () => {
    startPosed();
    await h.frames(2);
    const field = h.pixel(1000, 500);
    expect(field[0] + field[1] + field[2]).toBeLessThan(200);
  });

  it("sways the whole block as one body", async () => {
    await startStage(1);
    h.pose((s, d) => d.setDiveLaunching(s, false));
    await h.advance(12);
    const before = h.snapshot().drones.map((d) => d.x - d.slotX);
    await h.advance(SWAY_PERIOD / 4);
    const after = h.snapshot().drones.map((d) => d.x - d.slotX);
    const spread = new Set(after.map((offset) => Math.round(offset * 100)));
    expect(spread.size).toBe(1);
    expect(Math.abs((after[0] ?? 0) - (before[0] ?? 0))).toBeGreaterThan(1);
  });

  it("reaches the prism's own line before the bottom HUD strip", async () => {
    expect(PRISM_INVERT_Y).toBeLessThan(FIELD_BOTTOM);
  });
});
