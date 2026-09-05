// Shatter under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` set to
// Shatter's own tick, which makes one advanced frame exactly one simulation tick
// and a duration an exact number of them. What is read back is the game's own
// state, the debug surface the game returned beside it, the engine's cue events,
// and the pixels the render produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose takes a state and returns the next one and is
// driven through `engine.apply`; a reading is handed `engine.state`. `h.pose`
// and `h.snapshot` are those two moves, named.
//
// `startPlaying` poses an EMPTY, QUIET field in live play: both world gates and
// the ship's contact test off, so nothing a check did not ask for arrives,
// spawns or costs a life. A check whose requirement IS one of those faculties
// turns that one back on, and nothing else does.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BULLET_LIFE,
  CORE_R,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  FIRE_INTERVAL_TICKS,
  INVULN_TIME,
  LAYOUT,
  MAX_BULLETS,
  MUZZLE_SPEED,
  ROCK_HEALTH,
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SAFE_X,
  SAFE_Y,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_SPEED,
  SAUCER_WEAVE_SPEED,
  SCORE_LARGE,
  SCORE_SAUCER,
  SHATTER_DEBUG_VERSION,
  SHIP_MAX,
  SHIP_R,
  SHIP_TURN,
  SPLIT_KICK,
  STAR_X,
  STAR_Y,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
  TORPEDO_RECHARGE,
  TORPEDO_SCATTER,
  TORPEDO_SPEED,
  WAVE_BANNER_TIME,
  WAVE_BASE_ROCKS,
  type RockSize,
} from "./constants";
import {
  BACKGROUND,
  game,
  type ShatterDebugApi,
  type ShatterSnapshot,
  type ShatterState,
} from "./game";
import { wrappedDistance } from "./geometry";
import type { DeepReadonly } from "ts-essentials";

const TICK_MS = 1000 / TICK_HZ;

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
  readonly engine: Engine<ShatterState, ShatterDebugApi>;
  readonly state: DeepReadonly<ShatterState>;
  readonly debug: ShatterDebugApi;
  pose(
    transition: (
      state: DeepReadonly<ShatterState>,
      debug: ShatterDebugApi,
    ) => ShatterState,
  ): void;
  snapshot(): ShatterSnapshot;
  readonly cues: CuePlay[];
  readonly loops: string[];
  readonly stops: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pixel(x: number, y: number): [number, number, number, number];
  ticks(count: number): Promise<void>;
  seconds(value: number): Promise<void>;
  dispose(): void;
}

async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx as SKRSContext2D,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options `src/main.ts` passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<ShatterState, ShatterDebugApi>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(TICK_MS),
    surface,
  });

  const cues: CuePlay[] = [];
  const loops: string[] = [];
  const stops: string[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));
  engine.events.on("cue:stopped", ({ cue }) => stops.push(cue));

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
    loops,
    stops,
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
    ticks: (count) => engine.advance(count),
    seconds: (value) => engine.advance(Math.round(value * TICK_HZ)),
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

/** The last entry of a list, which is where the surface appends what it adds. */
function last<T>(list: readonly T[]): T {
  return list[list.length - 1] as T;
}

/** Empty every roster, leaving the ship and the run as they stand. */
function clearWorld(): void {
  h.pose((s, d) => d.clearRocks(s));
  h.pose((s, d) => d.clearBullets(s));
  h.pose((s, d) => d.clearEnemyBullets(s));
  h.pose((s, d) => d.clearTorpedoes(s));
  h.pose((s, d) => d.removeSaucer(s));
}

/** An empty, quiet field in live play. */
function startPlaying(): void {
  clearWorld();
  h.pose((s, d) => d.setWaveSpawning(s, false));
  h.pose((s, d) => d.setSaucerSpawning(s, false));
  h.pose((s, d) => d.setShipCollision(s, false));
  h.pose((s, d) => d.setScreen(s, "playing"));
  h.pose((s, d) => d.setMenuIndex(s, 0));
  h.pose((s, d) => d.setScore(s, 0));
  h.pose((s, d) => d.setLives(s, START_LIVES));
  h.pose((s, d) => d.setWave(s, 1));
  h.pose((s, d) => d.setWaveBanner(s, 0));
  h.pose((s, d) => d.setShipPosition(s, SAFE_X, SAFE_Y));
  h.pose((s, d) => d.setShipVelocity(s, 0, 0));
  h.pose((s, d) => d.setShipAngle(s, FACE_UP));
  h.pose((s, d) => d.setShipInvuln(s, 0));
  h.pose((s, d) => d.setFireCooldown(s, 0));
  h.pose((s, d) => d.setTorpedoCharge(s, 1));
}

/** Put one rock on the field with a velocity, and report its id. */
function poseRock(
  size: RockSize,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): number {
  h.pose((s, d) => d.addRock(s, size, x, y));
  const id = last(h.snapshot().rocks).id;
  h.pose((s, d) => d.setRockVelocity(s, id, vx, vy));
  return id;
}

/**
 * A round on a target's doorstep, fired inward from the side facing AWAY from
 * the star, and carrying the target's own velocity as well as its own.
 *
 * Both of those matter. Approaching from the far side means the whole flight is
 * the standoff, so the core can never absorb the round on its way in; carrying
 * the target's velocity means a Small drifting at up to 210 units a second is
 * still hit.
 */
function aimedRound(
  target: { x: number; y: number; vx: number; vy: number; radius: number },
  speed = 600,
  standoff = 6,
): void {
  const outX = target.x - STAR_X;
  const outY = target.y - STAR_Y;
  const length = Math.hypot(outX, outY) || 1;
  const ux = outX / length;
  const uy = outY / length;
  const reach = target.radius + standoff;
  h.pose((s, d) =>
    d.addBullet(
      s,
      target.x + ux * reach,
      target.y + uy * reach,
      target.vx - ux * speed,
      target.vy - uy * speed,
    ),
  );
}

/**
 * Shoot the field down to at most `leave` rocks, every one of them a Small.
 *
 * Rounds go in through `addBullet` and the build's own collision and split code;
 * nothing here removes a rock. Stopping on Smalls as well as on a count is what
 * makes it a real clear: only destroying a Small takes a rock off the field.
 */
async function shootFieldDown(leave = 0): Promise<number> {
  let rounds = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    const rocks = h.snapshot().rocks;
    if (rocks.length <= leave && rocks.every((r) => r.size === "small")) break;

    const target = [...rocks].sort((a, b) => a.radius - b.radius)[0];
    if (target === undefined) break;
    aimedRound(target);
    rounds += 1;
    await h.ticks(4);
  }
  return rounds;
}

/**
 * Advance until the star has taken the rock with that id, and report it as it
 * re-entered — before the well has had a chance to work on its fresh speed.
 */
async function runToRecycle(
  id: number,
): Promise<ShatterSnapshot["rocks"][number]> {
  const at = () => h.snapshot().rocks.find((r) => r.id === id);
  let previous = at();
  for (let i = 0; i < TICK_HZ * 5; i += 1) {
    await h.ticks(1);
    const now = at();
    if (previous !== undefined && now !== undefined) {
      const jumped = Math.hypot(now.x - previous.x, now.y - previous.y) > 200;
      if (jumped) return now;
    }
    previous = now;
  }
  throw new Error("the star never took the rock");
}

describe("the debug surface", () => {
  it("is returned beside the state and reports its version", () => {
    expect(h.debug.version).toBe(SHATTER_DEBUG_VERSION);
    expect(h.snapshot().version).toBe(SHATTER_DEBUG_VERSION);
  });

  it("opens on the title screen with every field at its opening value", () => {
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.wave).toBe(0);
    expect(snap.rocks).toEqual([]);
    expect(snap.saucer).toBeNull();
    expect(snap.waveSpawning).toBe(true);
    expect(snap.saucerSpawning).toBe(true);
    expect(snap.torpedoCharge).toBe(1);
    expect(snap.torpedoReady).toBe(true);
  });

  it("reads back every pose it makes", () => {
    h.pose((s, d) => d.setScreen(s, "gameover"));
    h.pose((s, d) => d.setMenuIndex(s, 1));
    h.pose((s, d) => d.setScore(s, 4242));
    h.pose((s, d) => d.setLives(s, 2));
    h.pose((s, d) => d.setWave(s, 7));
    h.pose((s, d) => d.setWaveBanner(s, 0.75));
    h.pose((s, d) => d.setShipPosition(s, 100, 200));
    h.pose((s, d) => d.setShipVelocity(s, -30, 40));
    h.pose((s, d) => d.setShipAngle(s, 1.25));
    h.pose((s, d) => d.setShipInvuln(s, 1.5));
    h.pose((s, d) => d.setFireCooldown(s, 9));
    h.pose((s, d) => d.setShipCollision(s, false));
    h.pose((s, d) => d.setWaveSpawning(s, false));
    h.pose((s, d) => d.setSaucerSpawning(s, false));
    h.pose((s, d) => d.setTorpedoCharge(s, 0.5));

    const snap = h.snapshot();
    expect(snap.screen).toBe("gameover");
    expect(snap.menuIndex).toBe(1);
    expect(snap.score).toBe(4242);
    expect(snap.lives).toBe(2);
    expect(snap.wave).toBe(7);
    expect(snap.waveBanner).toBeCloseTo(0.75);
    expect(snap.ship.x).toBe(100);
    expect(snap.ship.y).toBe(200);
    expect(snap.ship.vx).toBe(-30);
    expect(snap.ship.vy).toBe(40);
    expect(snap.ship.speed).toBeCloseTo(50);
    expect(snap.ship.angle).toBeCloseTo(1.25);
    expect(snap.ship.invuln).toBeCloseTo(1.5);
    expect(snap.ship.fireCooldown).toBe(9);
    expect(snap.ship.collision).toBe(false);
    expect(snap.waveSpawning).toBe(false);
    expect(snap.saucerSpawning).toBe(false);
    expect(snap.torpedoCharge).toBe(0.5);
    expect(snap.torpedoReady).toBe(false);
  });

  it("poses a rock at rest, at full health, appended, with a fresh id", () => {
    startPlaying();
    const first = poseRock("large", 200, 200);
    const second = poseRock("medium", 400, 200, 30, -20);

    const rocks = h.snapshot().rocks;
    expect(rocks).toHaveLength(2);
    expect(rocks[0]?.id).toBe(first);
    expect(rocks[1]?.id).toBe(second);
    expect(first).not.toBe(second);
    expect(rocks[0]?.vx).toBe(0);
    expect(rocks[0]?.vy).toBe(0);
    expect(rocks[0]?.health).toBe(ROCK_HEALTH.large);
    expect(rocks[0]?.radius).toBe(ROCK_RADIUS.large);
    expect(rocks[1]?.vx).toBe(30);
    expect(rocks[1]?.health).toBe(ROCK_HEALTH.medium);
  });

  it("clears one roster at a time", () => {
    startPlaying();
    poseRock("small", 200, 200);
    h.pose((s, d) => d.addBullet(s, 300, 300, 0, 0));
    h.pose((s, d) => d.addEnemyBullet(s, 320, 300, 0, 0));
    h.pose((s, d) => d.addTorpedo(s, 340, 300, 0));
    h.pose((s, d) => d.addSaucer(s, 400, 300));

    h.pose((s, d) => d.clearRocks(s));
    let snap = h.snapshot();
    expect(snap.rocks).toHaveLength(0);
    expect(snap.bullets).toHaveLength(1);
    expect(snap.enemyBullets).toHaveLength(1);
    expect(snap.torpedoes).toHaveLength(1);
    expect(snap.saucer).not.toBeNull();

    h.pose((s, d) => d.clearTorpedoes(s));
    snap = h.snapshot();
    expect(snap.torpedoes).toHaveLength(0);
    expect(snap.bullets).toHaveLength(1);
    expect(snap.enemyBullets).toHaveLength(1);
    expect(snap.saucer).not.toBeNull();

    h.pose((s, d) => d.clearBullets(s));
    h.pose((s, d) => d.clearEnemyBullets(s));
    h.pose((s, d) => d.removeSaucer(s));
    snap = h.snapshot();
    expect(snap.bullets).toHaveLength(0);
    expect(snap.enemyBullets).toHaveLength(0);
    expect(snap.saucer).toBeNull();
  });

  it("removes exactly the entity named by id", () => {
    startPlaying();
    const ids = [
      poseRock("small", 100, 100),
      poseRock("small", 200, 100),
      poseRock("small", 300, 100),
    ];
    h.pose((s, d) => d.removeRock(s, ids[1] as number));
    expect(h.snapshot().rocks.map((r) => r.id)).toEqual([ids[0], ids[2]]);

    for (const x of [100, 200, 300]) {
      h.pose((s, d) => d.addTorpedo(s, x, 400, 0));
    }
    const torpedoes = h.snapshot().torpedoes.map((t) => t.id);
    h.pose((s, d) => d.removeTorpedo(s, torpedoes[1] as number));
    expect(h.snapshot().torpedoes.map((t) => t.id)).toEqual([
      torpedoes[0],
      torpedoes[2],
    ]);
  });

  it("restores every declared field, and leaves muting alone", async () => {
    startPlaying();
    poseRock("large", 300, 300);
    h.pose((s, d) => d.addSaucer(s, 500, 300));
    h.pose((s, d) => d.setScore(s, 900));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.setWave(s, 5));
    h.tap("KeyM");
    await h.ticks(1);
    expect(h.snapshot().muted).toBe(true);

    h.pose((s, d) => d.reset(s));
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.wave).toBe(0);
    expect(snap.waveBanner).toBe(0);
    expect(snap.rocks).toEqual([]);
    expect(snap.saucer).toBeNull();
    expect(snap.ship.x).toBe(SAFE_X);
    expect(snap.ship.y).toBe(SAFE_Y);
    expect(snap.ship.collision).toBe(true);
    expect(snap.waveSpawning).toBe(true);
    expect(snap.saucerSpawning).toBe(true);
    expect(snap.simTime).toBe(0);
    expect(snap.torpedoCharge).toBe(1);
    expect(snap.muted).toBe(true);
  });

  it("advances exactly the time it is asked for, and nothing when it is not", async () => {
    startPlaying();
    const before = h.snapshot().simTime;
    await h.ticks(0);
    expect(h.snapshot().simTime).toBe(before);

    await h.ticks(240);
    expect(h.snapshot().simTime - before).toBeCloseTo(240 * TICK_DT, 6);
  });

  it("reaches the same place whether a second is one advance or many", async () => {
    startPlaying();
    poseRock("medium", 300, 200, 70, 40);
    await h.ticks(TICK_HZ);
    const inOne = h.snapshot();

    h.pose((s, d) => d.reset(s));
    startPlaying();
    poseRock("medium", 300, 200, 70, 40);
    for (let i = 0; i < TICK_HZ; i += 1) await h.ticks(1);
    const inMany = h.snapshot();

    expect(inMany.simTime).toBeCloseTo(inOne.simTime, 9);
    expect(inMany.rocks[0]?.x).toBeCloseTo(inOne.rocks[0]?.x ?? -1, 9);
    expect(inMany.rocks[0]?.y).toBeCloseTo(inOne.rocks[0]?.y ?? -1, 9);
  });

  it("seeds the game's randomness", async () => {
    const layout = async (seed: number): Promise<string> => {
      h.pose((s, d) => d.reset(s, { seed }));
      h.pose((s, d) => d.setMenuIndex(s, 0));
      h.tap("Enter");
      await h.ticks(1);
      return h
        .snapshot()
        .rocks.map((r) => `${r.x.toFixed(3)},${r.y.toFixed(3)}`)
        .join("|");
    };

    const seven = await layout(7);
    const sevenAgain = await layout(7);
    const eight = await layout(8);
    expect(sevenAgain).toBe(seven);
    expect(eight).not.toBe(seven);
  });
});

describe("the world gates", () => {
  it("holds an emptied field empty while wave spawning is off", async () => {
    startPlaying();
    poseRock("small", 300, 200);
    await shootFieldDown();
    await h.seconds(10);
    expect(h.snapshot().rocks).toHaveLength(0);
    expect(h.snapshot().waveBanner).toBe(0);
    expect(h.snapshot().wave).toBe(1);
  });

  it("keeps the saucer away while saucer spawning is off", async () => {
    startPlaying();
    await h.seconds(60);
    expect(h.snapshot().saucer).toBeNull();
  });

  it("costs no life while the ship's contact test is off", async () => {
    startPlaying();
    poseRock("large", SAFE_X, SAFE_Y);
    await h.ticks(4);
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().screen).toBe("playing");
  });

  it("holds the saucer's course, gun and body apart", async () => {
    startPlaying();
    h.pose((s, d) => d.addSaucer(s, 200, 300));
    h.pose((s, d) => d.setSaucerMind(s, false));
    h.pose((s, d) => d.setSaucerGun(s, false));
    const before = h.snapshot().saucer;
    await h.seconds(4);
    expect(h.snapshot().saucer?.vy).toBe(before?.vy);
    expect(h.snapshot().enemyBullets).toHaveLength(0);

    h.pose((s, d) => d.setSaucerTravel(s, false));
    h.pose((s, d) => d.setSaucerGun(s, true));
    const held = h.snapshot().saucer;
    await h.seconds(2);
    expect(h.snapshot().saucer?.x).toBeCloseTo(held?.x ?? -1, 6);
    expect(h.snapshot().enemyBullets.length).toBeGreaterThan(0);
  });
});

describe("the well", () => {
  it("pulls a bullet by the inverse-square law, toward the star", async () => {
    startPlaying();
    for (const d of [200, 150, 120, 60]) {
      h.pose((s, api) => api.clearBullets(s));
      h.pose((s, api) => api.addBullet(s, STAR_X - d, STAR_Y, 0, 0));
      await h.ticks(1);
      const bullet = last(h.snapshot().bullets);
      const expected = (4_500_000 / Math.pow(Math.max(d, 90), 2)) * TICK_DT;
      expect(bullet.vx).toBeCloseTo(expected, 3);
      expect(bullet.vy).toBeCloseTo(0, 6);
    }
  });

  it("never touches the ship, the saucer or a torpedo", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipPosition(s, STAR_X, STAR_Y - 120));
    h.pose((s, d) => d.setShipVelocity(s, 0, 0));
    h.pose((s, d) => d.addSaucer(s, STAR_X, STAR_Y + 120));
    h.pose((s, d) => d.setSaucerMind(s, false));
    h.pose((s, d) => d.setSaucerTravel(s, false));
    h.pose((s, d) => d.setSaucerGun(s, false));
    h.pose((s, d) => d.addTorpedo(s, STAR_X - 300, STAR_Y - 120, 0));
    h.pose((s, d) => {
      const id = last(d.snapshot(s).torpedoes).id;
      return d.setTorpedoHoming(s, id, false);
    });

    const saucerBefore = h.snapshot().saucer;
    await h.seconds(1);
    const snap = h.snapshot();
    expect(snap.ship.speed).toBeCloseTo(0, 6);
    expect(snap.saucer?.vx).toBeCloseTo(saucerBefore?.vx ?? -1, 6);
    expect(snap.saucer?.vy).toBeCloseTo(saucerBefore?.vy ?? -1, 6);
    expect(snap.torpedoes[0]?.vy).toBeCloseTo(0, 6);
  });

  it("absorbs a shot at the core and recycles a rock", async () => {
    startPlaying();
    h.pose((s, d) => d.addBullet(s, STAR_X - 200, STAR_Y, 900, 0));
    await h.seconds(0.5);
    expect(h.snapshot().bullets).toHaveLength(0);
    expect(h.snapshot().score).toBe(0);

    const id = poseRock("large", STAR_X - 300, STAR_Y, 400, 0);
    const rock = await runToRecycle(id);
    expect(h.snapshot().rocks).toHaveLength(1);
    expect(wrappedDistance(rock.x, rock.y, STAR_X, STAR_Y)).toBeGreaterThan(
      CORE_R + ROCK_RADIUS.large,
    );
    const speed = Math.hypot(rock.vx, rock.vy);
    expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.large - 1e-6);
    expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.large + 1e-6);
    expect(h.snapshot().score).toBe(0);
  });

  it("slides the ship along the core without costing a life", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipCollision(s, true));
    h.pose((s, d) => d.setShipPosition(s, STAR_X - 120, STAR_Y - 20));
    h.pose((s, d) => d.setShipVelocity(s, 200, 0));
    h.pose((s, d) => d.setShipAngle(s, 0));
    await h.seconds(0.6);

    const snap = h.snapshot();
    expect(
      wrappedDistance(snap.ship.x, snap.ship.y, STAR_X, STAR_Y),
    ).toBeGreaterThanOrEqual(CORE_R + SHIP_R - 1);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.screen).toBe("playing");
    expect(snap.ship.angle).toBeCloseTo(0, 9);
  });
});

describe("the ship", () => {
  it("turns at the stated rate, in both directions, without moving", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipAngle(s, 0));
    h.hold("ArrowRight");
    await h.seconds(1);
    h.release("ArrowRight");
    expect(h.snapshot().ship.angle).toBeCloseTo(SHIP_TURN, 2);
    expect(h.snapshot().ship.speed).toBeCloseTo(0, 6);

    h.hold("KeyA");
    await h.seconds(1);
    h.release("KeyA");
    expect(h.snapshot().ship.angle).toBeCloseTo(0, 2);
  });

  it("thrusts along its facing and is capped", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipAngle(s, 0));
    h.hold("KeyW");
    await h.seconds(1);
    const snap = h.snapshot();
    expect(snap.ship.thrusting).toBe(true);
    expect(Math.atan2(snap.ship.vy, snap.ship.vx)).toBeCloseTo(0, 3);
    expect(snap.ship.speed).toBeGreaterThan(380);
    expect(snap.ship.speed).toBeLessThan(SHIP_THRUST_BOUND);

    await h.seconds(20);
    expect(h.snapshot().ship.speed).toBeLessThanOrEqual(SHIP_MAX + 1);
    h.release("KeyW");
    await h.ticks(2);
    expect(h.snapshot().ship.thrusting).toBe(false);
  });

  it("halves an un-thrusting speed every three seconds", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipVelocity(s, 400, 0));
    await h.seconds(3);
    expect(h.snapshot().ship.speed).toBeCloseTo(200, 1);
  });

  it("wraps at every edge, carrying its velocity", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipPosition(s, FIELD_W - 4, 300));
    h.pose((s, d) => d.setShipVelocity(s, 400, 0));
    await h.ticks(4);
    const snap = h.snapshot();
    expect(snap.ship.x).toBeLessThan(100);
    // Within what the four ticks of drag alone account for.
    expect(snap.ship.vx).toBeGreaterThan(395);
    expect(snap.ship.vx).toBeLessThanOrEqual(400);
  });
});

const SHIP_THRUST_BOUND = 480;

describe("the gun", () => {
  it("leaves the nose at the muzzle speed, carrying the ship's drift", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipAngle(s, 0));
    h.tap("Space");
    await h.ticks(1);
    let bullet = last(h.snapshot().bullets);
    expect(
      wrappedDistance(bullet.x, bullet.y, SAFE_X, SAFE_Y),
    ).toBeLessThanOrEqual(SHIP_R);
    expect(bullet.x).toBeGreaterThan(SAFE_X);
    expect(Math.hypot(bullet.vx, bullet.vy)).toBeCloseTo(MUZZLE_SPEED, 3);

    h.pose((s, d) => d.clearBullets(s));
    h.pose((s, d) => d.setFireCooldown(s, 0));
    h.pose((s, d) => d.setShipVelocity(s, 0, 300));
    h.tap("Space");
    await h.ticks(1);
    bullet = last(h.snapshot().bullets);
    expect(bullet.vx).toBeCloseTo(MUZZLE_SPEED, 2);
    // The ship's velocity as it stands when the round leaves, which is after
    // the tick's own drag has taken its fraction of a unit off it.
    expect(Math.abs(bullet.vy - 300)).toBeLessThan(2);
  });

  it("gates shots and caps them at four in flight", async () => {
    startPlaying();
    h.pose((s, d) => d.setFireCooldown(s, 10));
    h.hold("Space");
    await h.ticks(9);
    expect(h.snapshot().bullets).toHaveLength(0);
    await h.ticks(1);
    expect(h.snapshot().bullets).toHaveLength(1);

    await h.ticks(FIRE_INTERVAL_TICKS * 6);
    h.release("Space");
    expect(h.snapshot().bullets.length).toBeLessThanOrEqual(MAX_BULLETS);
  });

  it("expires after its stated life", async () => {
    startPlaying();
    h.pose((s, d) => d.addBullet(s, 200, 100, 0, 0));
    await h.seconds(BULLET_LIFE - 0.1);
    expect(h.snapshot().bullets).toHaveLength(1);
    await h.seconds(0.2);
    expect(h.snapshot().bullets).toHaveLength(0);
  });

  it("does not pass through a rock at speed", async () => {
    startPlaying();
    const speed = MUZZLE_SPEED + SHIP_MAX;
    const step = speed * TICK_DT;
    poseRock("small", 400, 620);
    h.pose((s, d) => d.addBullet(s, 400 - step, 620, speed, 0));
    await h.ticks(2);
    expect(h.snapshot().rocks).toHaveLength(0);

    startPlaying();
    poseRock("small", 400, 620);
    h.pose((s, d) => d.addBullet(s, 400 - step, 620 + 40, speed, 0));
    await h.ticks(3);
    expect(h.snapshot().rocks).toHaveLength(1);
  });
});

describe("the rocks", () => {
  it("takes three rounds to break a Large, and scores only on the last", async () => {
    startPlaying();
    poseRock("large", 320, 620);
    for (let shot = 0; shot < 2; shot += 1) {
      aimedRound({ x: 320, y: 620, vx: 0, vy: 0, radius: ROCK_RADIUS.large });
      await h.ticks(6);
      const snap = h.snapshot();
      expect(snap.rocks).toHaveLength(1);
      expect(snap.rocks[0]?.health).toBe(ROCK_HEALTH.large - shot - 1);
      expect(snap.score).toBe(0);
      expect(snap.bullets).toHaveLength(0);
    }
    aimedRound({ x: 320, y: 620, vx: 0, vy: 0, radius: ROCK_RADIUS.large });
    await h.ticks(6);
    const snap = h.snapshot();
    expect(snap.rocks).toHaveLength(2);
    expect(snap.rocks.every((r) => r.size === "medium")).toBe(true);
    expect(snap.rocks.every((r) => r.health === ROCK_HEALTH.medium)).toBe(true);
    expect(snap.score).toBe(SCORE_LARGE);
  });

  it("fans the fragments across the shot, carrying the parent's motion", async () => {
    startPlaying();
    const id = poseRock("large", 320, 620, -60, -60);
    h.pose((s, d) => d.setRockHealth(s, id, 1));

    // Fired horizontally, from the side of the rock facing away from the star.
    h.pose((s, d) => d.addBullet(s, 320 - ROCK_RADIUS.large - 6, 620, 700, 0));
    let parent = h.snapshot().rocks[0];
    for (let i = 0; i < 40 && h.snapshot().rocks.length === 1; i += 1) {
      parent = h.snapshot().rocks[0];
      await h.ticks(1);
    }
    const fragments = h.snapshot().rocks;
    expect(fragments).toHaveLength(2);

    const avgX = ((fragments[0]?.vx ?? 0) + (fragments[1]?.vx ?? 0)) / 2;
    const avgY = ((fragments[0]?.vy ?? 0) + (fragments[1]?.vy ?? 0)) / 2;
    expect(avgX).toBeCloseTo(parent?.vx ?? 0, 0);
    expect(avgY).toBeCloseTo(parent?.vy ?? 0, 0);

    const dX = (fragments[0]?.vx ?? 0) - (fragments[1]?.vx ?? 0);
    const dY = (fragments[0]?.vy ?? 0) - (fragments[1]?.vy ?? 0);
    expect(Math.hypot(dX, dY) / 2).toBeCloseTo(SPLIT_KICK, 0);
    // Across the SHOT, which ran along +x, rather than across the rock's own
    // diagonal course: a fan taken from the rock would put most of the
    // difference on x.
    expect(Math.abs(dX)).toBeLessThan(1);
  });

  it("passes rocks through one another", async () => {
    startPlaying();
    poseRock("medium", 300, 400, 120, 0);
    poseRock("medium", 500, 400, -120, 0);
    await h.seconds(1.2);
    expect(h.snapshot().rocks).toHaveLength(2);
  });
});

describe("waves", () => {
  it("turns over on the tick the last rock is destroyed, and not before", async () => {
    startPlaying();
    h.pose((s, d) => d.setWaveSpawning(s, true));
    poseRock("small", 400, 620);
    expect(h.snapshot().waveBanner).toBe(0);

    await shootFieldDown();
    let snap = h.snapshot();
    expect(snap.waveBanner).toBeGreaterThan(0);
    expect(snap.wave).toBe(2);
    expect(snap.rocks).toHaveLength(0);

    await h.seconds(WAVE_BANNER_TIME - 0.1);
    snap = h.snapshot();
    expect(snap.waveBanner).toBeGreaterThan(0);
    expect(snap.rocks).toHaveLength(0);

    await h.seconds(0.2);
    snap = h.snapshot();
    expect(snap.waveBanner).toBe(0);
    expect(snap.rocks).toHaveLength(WAVE_BASE_ROCKS + 2);
    expect(snap.rocks.every((r) => r.size === "large")).toBe(true);
  });

  it("does not clear a field that was merely emptied", async () => {
    startPlaying();
    h.pose((s, d) => d.setWaveSpawning(s, true));
    poseRock("small", 400, 620);
    h.pose((s, d) => d.clearRocks(s));
    await h.seconds(10);
    expect(h.snapshot().waveBanner).toBe(0);
    expect(h.snapshot().wave).toBe(1);
    expect(h.snapshot().rocks).toHaveLength(0);
  });

  it("spawns clear of the ship and of the star, and faster each wave", async () => {
    h.pose((s, d) => d.reset(s, { seed: 3 }));
    h.tap("Enter");
    await h.ticks(1);
    let snap = h.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.wave).toBe(1);
    expect(snap.rocks).toHaveLength(WAVE_BASE_ROCKS + 1);
    for (const rock of snap.rocks) {
      expect(
        wrappedDistance(rock.x, rock.y, snap.ship.x, snap.ship.y),
      ).toBeGreaterThanOrEqual(300);
      expect(
        wrappedDistance(rock.x, rock.y, STAR_X, STAR_Y),
      ).toBeGreaterThanOrEqual(200);
      const speed = Math.hypot(rock.vx, rock.vy);
      expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.large - 1e-6);
      expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.large + 1e-6);
    }

    h.pose((s, d) => d.setWave(s, 20));
    h.pose((s, d) => d.clearRocks(s));
    h.pose((s, d) => d.setWaveBanner(s, 0.05));
    await h.ticks(6);
    snap = h.snapshot();
    expect(snap.rocks).toHaveLength(WAVE_BASE_ROCKS + 20);
    for (const rock of snap.rocks) {
      const speed = Math.hypot(rock.vx, rock.vy);
      expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.large * 1.4 - 1);
      expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.large * 1.4 + 1);
    }
  });
});

describe("the saucer", () => {
  it("arrives on its own cadence and leaves on its own clock", async () => {
    startPlaying();
    h.pose((s, d) => d.setSaucerSpawning(s, true));
    await h.seconds(16);
    expect(h.snapshot().saucer).toBeNull();
    let arrival = h.snapshot().saucer;
    for (let i = 0; i < TICK_HZ * 4 && arrival === null; i += 1) {
      await h.ticks(1);
      arrival = h.snapshot().saucer;
    }
    expect(arrival).not.toBeNull();
    expect(
      Math.min(arrival?.x ?? 0, FIELD_W - (arrival?.x ?? 0)),
    ).toBeLessThanOrEqual(40);
    expect(arrival?.y).toBeGreaterThanOrEqual(SAUCER_R);
    expect(arrival?.y).toBeLessThanOrEqual(FIELD_H - SAUCER_R);
    expect(Math.abs(arrival?.vx ?? 0)).toBeCloseTo(SAUCER_SPEED, 6);
    expect(h.cues.some((c) => c.cue === "saucer")).toBe(true);
  });

  it("leaves twelve seconds after it enters", async () => {
    startPlaying();
    h.pose((s, d) => d.addSaucer(s, 100, 300));
    h.pose((s, d) => d.setSaucerMind(s, false));
    h.pose((s, d) => d.setSaucerGun(s, false));
    await h.seconds(SAUCER_LIFETIME - 0.5);
    expect(h.snapshot().saucer).not.toBeNull();
    await h.seconds(1);
    expect(h.snapshot().saucer).toBeNull();
  });

  it("weaves at the stated speed on the stated interval", async () => {
    startPlaying();
    h.pose((s, d) => d.addSaucer(s, 200, 300));
    h.pose((s, d) => d.setSaucerGun(s, false));
    h.pose((s, d) => d.setSaucerTravel(s, false));

    const flips: number[] = [];
    let previous = h.snapshot().saucer?.vy ?? 0;
    for (let i = 0; i < TICK_HZ * 4; i += 1) {
      await h.ticks(1);
      const vy = h.snapshot().saucer?.vy ?? 0;
      expect(Math.abs(vy)).toBeLessThanOrEqual(SAUCER_WEAVE_SPEED + 1e-6);
      if (Math.sign(vy) !== Math.sign(previous)) flips.push(i);
      previous = vy;
    }
    expect(flips.length).toBeGreaterThanOrEqual(3);
    const gap = (flips[2] as number) - (flips[1] as number);
    expect(gap / TICK_HZ).toBeCloseTo(1, 1);
  });

  it("never overlaps the star's core, crossing on any row", async () => {
    let worst = Infinity;
    for (const row of [-80, -40, 0, 40, 80]) {
      for (const fromLeft of [true, false]) {
        startPlaying();
        h.pose((s, d) =>
          d.addSaucer(
            s,
            fromLeft ? SAUCER_R : FIELD_W - SAUCER_R,
            STAR_Y + row,
          ),
        );
        if (!fromLeft) {
          h.pose((s, d) => d.setSaucerVelocity(s, -SAUCER_SPEED, 0));
        }
        h.pose((s, d) => d.setSaucerGun(s, false));

        let previous = h.snapshot().saucer;
        for (let i = 0; i < 140; i += 1) {
          await h.ticks(8);
          const now = h.snapshot().saucer;
          if (now === null || previous === null) break;
          worst = Math.min(
            worst,
            segmentDistance(
              previous.x,
              previous.y,
              now.x,
              now.y,
              STAR_X,
              STAR_Y,
            ),
          );
          previous = now;
        }
      }
    }
    expect(worst).toBeGreaterThan(CORE_R + SAUCER_R);
  });

  it("aims at the ship, with a fresh error every shot", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipPosition(s, 700, 300));

    const bearings: number[] = [];
    for (let shot = 0; shot < 30; shot += 1) {
      h.pose((s, d) => d.clearEnemyBullets(s));
      h.pose((s, d) => d.addSaucer(s, 300, 300));
      h.pose((s, d) => d.setSaucerMind(s, false));
      h.pose((s, d) => d.setSaucerTravel(s, false));
      h.pose((s, d) => d.setSaucerVelocity(s, 0, 0));
      await h.seconds(1.6);
      const bullet = last(h.snapshot().enemyBullets);
      bearings.push((Math.atan2(bullet.vy, bullet.vx) * 180) / Math.PI);
      expect(Math.hypot(bullet.vx, bullet.vy)).toBeCloseTo(300, 3);
    }
    const mean = bearings.reduce((a, b) => a + b, 0) / bearings.length;
    expect(Math.abs(mean)).toBeLessThan(4);
    for (const bearing of bearings) expect(Math.abs(bearing)).toBeLessThan(10);
    const spread = Math.max(...bearings) - Math.min(...bearings);
    expect(spread).toBeGreaterThan(4);
  });

  it("is destroyed by a round, for its own score", async () => {
    startPlaying();
    h.pose((s, d) => d.addSaucer(s, 400, 620));
    h.pose((s, d) => d.setSaucerMind(s, false));
    h.pose((s, d) => d.setSaucerGun(s, false));
    h.pose((s, d) => d.setSaucerTravel(s, false));
    h.pose((s, d) => d.addBullet(s, 340, 620, 600, 0));
    await h.seconds(0.4);
    expect(h.snapshot().saucer).toBeNull();
    expect(h.snapshot().score).toBe(SCORE_SAUCER);
  });
});

/** The distance from a point to the segment between two samples. */
function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

describe("lives and the run", () => {
  it("loses a ship to a rock, and puts the next one up safely", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipCollision(s, true));
    h.pose((s, d) => d.setShipPosition(s, 300, 300));
    poseRock("large", 300, 300);
    await h.ticks(2);

    const snap = h.snapshot();
    expect(snap.lives).toBe(START_LIVES - 1);
    expect(snap.ship.x).toBeCloseTo(SAFE_X, 6);
    expect(snap.ship.y).toBeCloseTo(SAFE_Y, 6);
    expect(snap.ship.speed).toBeCloseTo(0, 6);
    expect(snap.ship.angle).toBeCloseTo(FACE_UP, 6);
    expect(snap.ship.invuln).toBeGreaterThan(INVULN_TIME - 2 * TICK_DT);
    expect(snap.ship.invuln).toBeLessThanOrEqual(INVULN_TIME);
    expect(snap.torpedoCharge).toBe(1);
    expect(h.cues.some((c) => c.cue === "death")).toBe(true);
  });

  it("ignores a rock inside the grace and takes one after it", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipCollision(s, true));
    h.pose((s, d) => d.setShipInvuln(s, 2));
    poseRock("large", SAFE_X, SAFE_Y);
    await h.seconds(1);
    expect(h.snapshot().lives).toBe(START_LIVES);

    h.pose((s, d) => d.clearRocks(s));
    h.pose((s, d) => d.setShipInvuln(s, 0));
    poseRock("large", SAFE_X, SAFE_Y);
    await h.ticks(2);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("does not pass through a rock closing fast", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipCollision(s, true));
    h.pose((s, d) => d.setShipPosition(s, 400, 620));
    const speed = MUZZLE_SPEED + SHIP_MAX;
    poseRock("small", 400 - speed * TICK_DT, 620, speed, 0);
    await h.ticks(2);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("ends the run when the last ship is lost", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipCollision(s, true));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.setShipPosition(s, 300, 300));
    poseRock("large", 300, 300);
    await h.ticks(2);

    const snap = h.snapshot();
    expect(snap.lives).toBe(0);
    expect(snap.screen).toBe("gameover");
    expect(
      wrappedDistance(snap.ship.x, snap.ship.y, SAFE_X, SAFE_Y),
    ).toBeGreaterThan(1);
  });

  it("awards a ship on every ten thousand, through play alone", async () => {
    startPlaying();
    h.pose((s, d) => d.setScore(s, 9_960));
    expect(h.snapshot().lives).toBe(START_LIVES);

    poseRock("small", 400, 620);
    await shootFieldDown();
    const snap = h.snapshot();
    expect(snap.score).toBe(10_060);
    expect(snap.lives).toBe(START_LIVES + 1);
    expect(h.cues.some((c) => c.cue === "extra-life")).toBe(true);
  });
});

describe("the screens", () => {
  it("walks the title, the how-to and a new game", async () => {
    expect(h.snapshot().screen).toBe("title");
    h.tap("ArrowDown");
    await h.ticks(1);
    expect(h.snapshot().menuIndex).toBe(1);
    h.tap("Space");
    await h.ticks(1);
    expect(h.snapshot().screen).toBe("howto");

    h.tap("Escape");
    await h.ticks(1);
    expect(h.snapshot().screen).toBe("title");
    // The how-to leaves the title's highlight alone, so the return lands on the
    // entry that opened it (`specs/ui.md`).
    expect(h.snapshot().menuIndex).toBe(1);

    h.tap("ArrowUp");
    await h.ticks(1);
    h.tap("Enter");
    await h.ticks(1);
    const snap = h.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.wave).toBe(1);
    expect(snap.torpedoReady).toBe(true);
  });

  it("freezes the field while paused, and resumes it exactly", async () => {
    startPlaying();
    poseRock("medium", 300, 200, 90, 30);
    await h.ticks(10);
    const before = h.snapshot();

    h.tap("KeyP");
    await h.ticks(1);
    expect(h.snapshot().screen).toBe("paused");
    const paused = h.snapshot();

    await h.seconds(2);
    const still = h.snapshot();
    expect(still.rocks[0]?.x).toBeCloseTo(paused.rocks[0]?.x ?? -1, 9);
    expect(still.rocks[0]?.y).toBeCloseTo(paused.rocks[0]?.y ?? -1, 9);
    expect(still.simTime).toBeGreaterThan(paused.simTime);

    h.tap("Enter");
    await h.ticks(1);
    expect(h.snapshot().screen).toBe("playing");
    expect(h.snapshot().score).toBe(before.score);
  });

  it("restarts from the pause menu with a clean game and no saucer", async () => {
    startPlaying();
    h.pose((s, d) => d.setLives(s, 2));
    h.pose((s, d) => d.setScore(s, 1_234));
    h.pose((s, d) => d.addSaucer(s, 400, 300));
    h.tap("Escape");
    await h.ticks(1);
    expect(h.snapshot().screen).toBe("paused");
    expect(h.snapshot().saucer).not.toBeNull();

    h.pose((s, d) => d.setMenuIndex(s, 1));
    h.tap("Enter");
    await h.ticks(1);
    let snap = h.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.saucer).toBeNull();
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.score).toBe(0);

    await h.seconds(2);
    snap = h.snapshot();
    expect(snap.saucer).toBeNull();
  });

  it("keeps a menu selection inside its own entries", async () => {
    for (let i = 0; i < 10; i += 1) {
      h.tap("ArrowDown");
      await h.ticks(1);
      expect(h.snapshot().menuIndex).toBeGreaterThanOrEqual(0);
      expect(h.snapshot().menuIndex).toBeLessThan(2);
    }
    for (let i = 0; i < 10; i += 1) {
      h.tap("KeyW");
      await h.ticks(1);
      expect(h.snapshot().menuIndex).toBeGreaterThanOrEqual(0);
      expect(h.snapshot().menuIndex).toBeLessThan(2);
    }
  });
});

describe("the torpedo", () => {
  it("launches one on a press, spends the charge, and refills linearly", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipAngle(s, 0));
    h.tap("KeyF");
    await h.ticks(1);
    let snap = h.snapshot();
    expect(snap.torpedoes).toHaveLength(1);
    expect(snap.torpedoCharge).toBe(0);
    expect(snap.torpedoReady).toBe(false);
    const torpedo = snap.torpedoes[0];
    expect(
      wrappedDistance(torpedo?.x ?? 0, torpedo?.y ?? 0, SAFE_X, SAFE_Y),
    ).toBeLessThanOrEqual(SHIP_R);
    expect(torpedo?.heading).toBeCloseTo(0, 9);
    expect(Math.hypot(torpedo?.vx ?? 0, torpedo?.vy ?? 0)).toBeCloseTo(
      TORPEDO_SPEED,
      6,
    );

    await h.seconds(TORPEDO_RECHARGE / 2);
    expect(h.snapshot().torpedoCharge).toBeCloseTo(0.5, 2);
    await h.seconds(TORPEDO_RECHARGE / 2);
    snap = h.snapshot();
    expect(snap.torpedoCharge).toBe(1);
    expect(snap.torpedoReady).toBe(true);
  });

  it("carries none of the ship's drift", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipAngle(s, 0));
    h.pose((s, d) => d.setShipVelocity(s, 0, 300));
    h.tap("KeyF");
    await h.ticks(1);
    const torpedo = h.snapshot().torpedoes[0];
    expect(torpedo?.vx).toBeCloseTo(TORPEDO_SPEED, 2);
    expect(torpedo?.vy).toBeCloseTo(0, 2);
  });

  it("refuses a launch while recharging and while one is up", async () => {
    startPlaying();
    h.pose((s, d) => d.setTorpedoCharge(s, 0.5));
    h.tap("KeyF");
    await h.ticks(1);
    expect(h.snapshot().torpedoes).toHaveLength(0);

    h.pose((s, d) => d.addTorpedo(s, 200, 200, 0));
    h.pose((s, d) => d.setTorpedoCharge(s, 1));
    h.tap("KeyF");
    await h.ticks(1);
    expect(h.snapshot().torpedoes).toHaveLength(1);
  });

  it("flies true through the well with its guidance off", async () => {
    startPlaying();
    // Past the well, and clear of the core itself, which absorbs a torpedo that
    // reaches it exactly as it absorbs a round.
    const row = STAR_Y + 60;
    h.pose((s, d) => d.addTorpedo(s, 200, row, 0));
    const id = last(h.snapshot().torpedoes).id;
    h.pose((s, d) => d.setTorpedoHoming(s, id, false));

    for (let i = 0; i < 240; i += 1) {
      await h.ticks(1);
      const torpedo = h.snapshot().torpedoes[0];
      expect(torpedo).toBeDefined();
      expect(torpedo?.heading).toBeCloseTo(0, 9);
      expect(torpedo?.y).toBeCloseTo(row, 6);
    }
    expect(h.snapshot().torpedoes[0]?.x).toBeGreaterThan(1000);
  });

  it("turns onto the nearer body inside its forward cone alone", async () => {
    startPlaying();
    h.pose((s, d) => d.addTorpedo(s, 200, 620, 0));
    const id = last(h.snapshot().torpedoes).id;
    poseRock("small", 120, 620); // Behind it: never acquired.
    await h.seconds(0.5);
    expect(h.snapshot().torpedoes[0]?.heading).toBeCloseTo(0, 6);
    expect(h.snapshot().rocks).toHaveLength(1);

    h.pose((s, d) => d.removeTorpedo(s, id));
    h.pose((s, d) => d.clearRocks(s));
    h.pose((s, d) => d.addTorpedo(s, 200, 620, 0));
    poseRock("small", 700, 620 + 60); // Inside the cone, and nearer.
    poseRock("small", 900, 620 - 20);
    await h.seconds(0.2);
    expect(h.snapshot().torpedoes[0]?.heading).toBeGreaterThan(0);
  });

  it("expires after its own lifetime", async () => {
    startPlaying();
    h.pose((s, d) => d.addTorpedo(s, 200, 100, 0));
    const id = last(h.snapshot().torpedoes).id;
    h.pose((s, d) => d.setTorpedoHoming(s, id, false));
    await h.seconds(3.4);
    expect(h.snapshot().torpedoes).toHaveLength(1);
    await h.seconds(0.2);
    expect(h.snapshot().torpedoes).toHaveLength(0);
  });
});

describe("detonation", () => {
  it("destroys a full-health Large outright and scores like a gun kill", async () => {
    startPlaying();
    poseRock("large", 400, 620);
    h.pose((s, d) => d.addTorpedo(s, 400 - ROCK_RADIUS.large - 20, 620, 0));
    const id = last(h.snapshot().torpedoes).id;
    h.pose((s, d) => d.setTorpedoHoming(s, id, false));
    await h.seconds(0.3);

    const snap = h.snapshot();
    expect(snap.torpedoes).toHaveLength(0);
    expect(snap.rocks).toHaveLength(2);
    expect(snap.rocks.every((r) => r.size === "medium")).toBe(true);
    expect(snap.score).toBe(SCORE_LARGE);
  });

  it("blasts the fragments apart far harder than the gun", async () => {
    startPlaying();
    poseRock("large", 400, 620);
    h.pose((s, d) => d.addTorpedo(s, 400 - ROCK_RADIUS.large - 20, 620, 0));
    const id = last(h.snapshot().torpedoes).id;
    h.pose((s, d) => d.setTorpedoHoming(s, id, false));
    for (let i = 0; i < 60 && h.snapshot().rocks.length < 2; i += 1) {
      await h.ticks(1);
    }
    const fragments = h.snapshot().rocks;
    expect(fragments).toHaveLength(2);
    const dX = (fragments[0]?.vx ?? 0) - (fragments[1]?.vx ?? 0);
    const dY = (fragments[0]?.vy ?? 0) - (fragments[1]?.vy ?? 0);
    expect(Math.hypot(dX, dY) / 2).toBeCloseTo(TORPEDO_SCATTER, 0);
  });

  it("leaves a neighbouring rock and the ship alone, and stops at the core", async () => {
    startPlaying();
    poseRock("small", 400, 620);
    poseRock("small", 400 + ROCK_RADIUS.small * 2 + 20, 620);
    h.pose((s, d) => d.addTorpedo(s, 340, 620, 0));
    let id = last(h.snapshot().torpedoes).id;
    h.pose((s, d) => d.setTorpedoHoming(s, id, false));
    await h.seconds(0.25);
    expect(h.snapshot().rocks).toHaveLength(1);

    startPlaying();
    h.pose((s, d) => d.setShipCollision(s, true));
    h.pose((s, d) => d.setShipPosition(s, 400, 300));
    h.pose((s, d) => d.addTorpedo(s, 300, 300, 0));
    id = last(h.snapshot().torpedoes).id;
    h.pose((s, d) => d.setTorpedoHoming(s, id, false));
    await h.seconds(0.35);
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(h.snapshot().torpedoes).toHaveLength(1);

    startPlaying();
    h.pose((s, d) => d.addTorpedo(s, STAR_X - 200, STAR_Y, 0));
    id = last(h.snapshot().torpedoes).id;
    h.pose((s, d) => d.setTorpedoHoming(s, id, false));
    await h.seconds(0.6);
    expect(h.snapshot().torpedoes).toHaveLength(0);
    expect(h.snapshot().score).toBe(0);
  });
});

describe("armor and recycling", () => {
  it("carries damage across a recycle and resets the speed alone", async () => {
    startPlaying();
    const id = poseRock("large", STAR_X - 400, STAR_Y, 400, 0);
    h.pose((s, api) => api.setRockHealth(s, id, 1));
    const rock = await runToRecycle(id);

    expect(rock.health).toBe(1);
    expect(rock.size).toBe("large");
    const speed = Math.hypot(rock.vx, rock.vy);
    expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.large - 1e-6);
    expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.large + 1e-6);
  });

  it("poses a rock's health inside its own range", () => {
    startPlaying();
    const id = poseRock("medium", 300, 300);
    h.pose((s, d) => d.setRockHealth(s, id, 1));
    expect(h.snapshot().rocks[0]?.health).toBe(1);
    h.pose((s, d) => d.setRockHealth(s, id, 9));
    expect(h.snapshot().rocks[0]?.health).toBe(ROCK_HEALTH.medium);
  });
});

describe("audio and the drawing", () => {
  it("strikes a cue per event and holds the thrust cue", async () => {
    startPlaying();
    h.tap("Space");
    await h.ticks(1);
    expect(h.cues.filter((c) => c.cue === "fire")).toHaveLength(1);

    h.hold("ArrowUp");
    await h.ticks(2);
    expect(h.loops).toContain("thrust");
    h.release("ArrowUp");
    await h.ticks(2);
    expect(h.stops).toContain("thrust");

    poseRock("small", 400, 620);
    await shootFieldDown();
    expect(h.cues.some((c) => c.cue === "shatter")).toBe(true);
  });

  it("silences every cue while muted", async () => {
    startPlaying();
    h.tap("KeyM");
    await h.ticks(1);
    expect(h.snapshot().muted).toBe(true);
    const before = h.cues.length;
    h.tap("Space");
    await h.ticks(1);
    expect(h.cues.slice(before).every((c) => c.gain === 0)).toBe(true);
  });

  it("draws a dark field, and every body apart from it", async () => {
    startPlaying();
    h.pose((s, d) => d.setShipPosition(s, 200, 620));
    poseRock("large", 500, 620);
    h.pose((s, d) => d.addSaucer(s, 800, 620));
    h.pose((s, d) => d.addBullet(s, 1000, 620, 0, 0));
    await h.ticks(1);

    const background = h.pixel(60, 660);
    const luminance = (background[0] + background[1] + background[2]) / 3 / 255;
    expect(luminance).toBeLessThan(0.25);

    const far = (a: [number, number, number, number], threshold: number) =>
      Math.hypot(
        a[0] - background[0],
        a[1] - background[1],
        a[2] - background[2],
      ) > threshold;
    expect(far(h.pixel(200, 620), 60)).toBe(true);
    expect(far(h.pixel(500, 620), 60)).toBe(true);
    expect(far(h.pixel(800, 620), 60)).toBe(true);
    expect(far(h.pixel(1000, 620), 60)).toBe(true);
    expect(far(h.pixel(STAR_X, STAR_Y), 60)).toBe(true);
  });

  it("draws a body straddling a seam on both sides", async () => {
    startPlaying();
    poseRock("large", FIELD_W - 4, 620);
    await h.ticks(1);
    const background = h.pixel(60, 60);
    const inked = (x: number, y: number): boolean => {
      const p = h.pixel(x, y);
      return (
        Math.hypot(
          p[0] - background[0],
          p[1] - background[1],
          p[2] - background[2],
        ) > 40
      );
    };
    expect(inked(FIELD_W - 10, 620)).toBe(true);
    expect(inked(10, 620)).toBe(true);
  });

  it("draws a trail behind a moving bullet", async () => {
    startPlaying();
    h.pose((s, d) => d.addBullet(s, 400, 620, 600, 0));
    await h.ticks(18);
    const bullet = last(h.snapshot().bullets);
    const background = h.pixel(60, 60);
    const behind = h.pixel(Math.round(bullet.x - 30), Math.round(bullet.y));
    expect(
      Math.hypot(
        behind[0] - background[0],
        behind[1] - background[1],
        behind[2] - background[2],
      ),
    ).toBeGreaterThan(20);
  });

  it("draws every screen's copy", async () => {
    for (const screen of ["title", "howto", "paused", "gameover"] as const) {
      h.pose((s, d) => d.setScreen(s, screen));
      await h.ticks(1);
      const middle = h.pixel(FIELD_W / 2, 200);
      expect(middle[3]).toBeGreaterThan(0);
    }
  });
});
