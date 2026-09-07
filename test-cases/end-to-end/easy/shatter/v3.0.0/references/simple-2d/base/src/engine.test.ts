// Shatter under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` at
// Shatter's own tick rate, so one advanced frame is exactly one `TICK_DT`. Keys
// are driven by dispatching keyboard-shaped events at the surface's event
// target — the same listeners a player's keys reach — and what is read back is
// the debug surface `initialize` returned beside the state, the engine's cue
// events, and the pixels the render produced.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import { describe, expect, it } from "vitest";
import {
  BULLET_LIFE,
  CORE_R,
  CUES,
  FIELD_H,
  FIELD_W,
  FIRE_INTERVAL_TICKS,
  INVULN_TIME,
  MAX_BULLETS,
  MUZZLE_SPEED,
  ROCK_RADIUS,
  SAFE_X,
  SAFE_Y,
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_FIRST_DELAY,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_SPEED,
  SAUCER_WEAVE_SPEED,
  SCORE_LARGE,
  SCORE_MEDIUM,
  SCORE_SAUCER,
  SHIP_MAX,
  SHIP_R,
  SHIP_TURN,
  SPLIT_KICK,
  STAR_X,
  STAR_Y,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
  WAVE_BANNER_TIME,
  LAYOUT,
} from "./constants";
import { BACKGROUND, game, type ShatterState } from "./game";
import type { ShatterDebugApi, ShatterSnapshot } from "./debug";

const TICK_MS = 1000 / TICK_HZ;

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

interface CuePlay {
  cue: string;
  gain: number;
}

interface Harness {
  readonly engine: Engine<ShatterState, ShatterDebugApi>;
  readonly debug: ShatterDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  readonly loops: string[];
  readonly stops: string[];
  snap(): ShatterSnapshot;
  pose(
    act: (debug: ShatterDebugApi, state: ShatterState) => ShatterState,
  ): void;
  down(code: string): void;
  up(code: string): void;
  tap(code: string): Promise<void>;
  step(ticks: number): Promise<void>;
  pixel(x: number, y: number): [number, number, number];
}

async function harness(): Promise<Harness> {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => events,
  };

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

  const down = (code: string): void => {
    events.dispatchEvent(new KeyEvent("keydown", code));
  };
  const up = (code: string): void => {
    events.dispatchEvent(new KeyEvent("keyup", code));
  };

  return {
    engine,
    debug: engine.debug,
    ctx,
    cues,
    loops,
    stops,
    snap: () => engine.debug.snapshot(engine.state),
    pose: (act) => {
      engine.apply((s) => act(engine.debug, s as ShatterState));
    },
    down,
    up,
    async tap(code) {
      down(code);
      await engine.advance(1);
      up(code);
      await engine.advance(1);
    },
    step: (ticks) => engine.advance(ticks),
    pixel(x, y) {
      const data = ctx.getImageData(x, y, 1, 1).data;
      return [data[0], data[1], data[2]];
    },
  };
}

/** Pose a live field with both world spawners held, the way a scenario does. */
async function playing(h: Harness): Promise<void> {
  h.pose((d, s) => d.reset(s));
  h.pose((d, s) => d.setScreen(s, "playing"));
  h.pose((d, s) => d.setWaveSpawning(s, false));
  h.pose((d, s) => d.setSaucerSpawning(s, false));
  h.pose((d, s) => d.setShipCollision(s, false));
  await h.step(1);
}

describe("the surface", () => {
  it("is returned beside the state and reports its version", async () => {
    const h = await harness();
    expect(h.debug.version).toBe(1);
    expect(h.snap().version).toBe(1);
  });

  it("opens on the title screen with three ships and no wave", async () => {
    const h = await harness();
    const s = h.snap();
    expect(s.screen).toBe("title");
    expect(s.lives).toBe(START_LIVES);
    expect(s.wave).toBe(0);
    expect(s.rocks).toHaveLength(0);
    expect(s.saucer).toBeNull();
    expect(s.ship.x).toBe(SAFE_X);
    expect(s.ship.y).toBe(SAFE_Y);
  });

  it("reads back every field a pose can set", async () => {
    const h = await harness();
    h.pose((d, s) => d.setScreen(s, "paused"));
    h.pose((d, s) => d.setMenuIndex(s, 2));
    h.pose((d, s) => d.setScore(s, 1234));
    h.pose((d, s) => d.setLives(s, 2));
    h.pose((d, s) => d.setWave(s, 7));
    h.pose((d, s) => d.setWaveBanner(s, 0.5));
    h.pose((d, s) => d.setWaveSpawning(s, false));
    h.pose((d, s) => d.setSaucerSpawning(s, false));
    h.pose((d, s) => d.setShipPosition(s, 100, 200));
    h.pose((d, s) => d.setShipVelocity(s, 30, -40));
    h.pose((d, s) => d.setShipAngle(s, 1.25));
    h.pose((d, s) => d.setShipInvuln(s, 1.5));
    h.pose((d, s) => d.setFireCooldown(s, 9));
    h.pose((d, s) => d.setShipCollision(s, false));

    const s = h.snap();
    expect(s.screen).toBe("paused");
    expect(s.menuIndex).toBe(2);
    expect(s.score).toBe(1234);
    expect(s.lives).toBe(2);
    expect(s.wave).toBe(7);
    expect(s.waveBanner).toBe(0.5);
    expect(s.waveSpawning).toBe(false);
    expect(s.saucerSpawning).toBe(false);
    expect(s.ship).toMatchObject({
      x: 100,
      y: 200,
      vx: 30,
      vy: -40,
      angle: 1.25,
      invuln: 1.5,
      collision: false,
      fireCooldown: 9,
    });
    expect(s.ship.speed).toBeCloseTo(50, 9);
  });

  it("setting the score grants no ship, and setting the wave spawns nothing", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setScore(s, 25_000));
    h.pose((d, s) => d.setWave(s, 4));
    const s = h.snap();
    expect(s.lives).toBe(START_LIVES);
    expect(s.rocks).toHaveLength(0);
  });

  it("gives every live entity a distinct id, appended last in its roster", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "large", 200, 200));
    h.pose((d, s) => d.addBullet(s, 300, 300, 10, 0));
    h.pose((d, s) => d.addEnemyBullet(s, 400, 300, 10, 0));
    h.pose((d, s) => d.addSaucer(s, 500, 300));
    h.pose((d, s) => d.addRock(s, "small", 260, 200));

    const s = h.snap();
    const ids = [
      ...s.rocks.map((r) => r.id),
      ...s.bullets.map((b) => b.id),
      ...s.enemyBullets.map((b) => b.id),
      s.saucer?.id ?? -1,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.rocks[s.rocks.length - 1].size).toBe("small");
  });

  it("clears one roster at a time and removes one entity at a time", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "large", 200, 200));
    h.pose((d, s) => d.addRock(s, "medium", 260, 200));
    h.pose((d, s) => d.addBullet(s, 300, 300, 10, 0));
    h.pose((d, s) => d.addEnemyBullet(s, 400, 300, 10, 0));
    h.pose((d, s) => d.addSaucer(s, 500, 300));

    const first = h.snap().rocks[0].id;
    h.pose((d, s) => d.removeRock(s, first));
    expect(h.snap().rocks).toHaveLength(1);

    h.pose((d, s) => d.clearRocks(s));
    let s = h.snap();
    expect(s.rocks).toHaveLength(0);
    expect(s.bullets).toHaveLength(1);
    expect(s.enemyBullets).toHaveLength(1);
    expect(s.saucer).not.toBeNull();

    h.pose((d, s2) => d.clearBullets(s2));
    h.pose((d, s2) => d.clearEnemyBullets(s2));
    h.pose((d, s2) => d.removeSaucer(s2));
    s = h.snap();
    expect(s.bullets).toHaveLength(0);
    expect(s.enemyBullets).toHaveLength(0);
    expect(s.saucer).toBeNull();
  });

  it("reset restores the title screen and reseeds the randomness", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "large", 100, 100));
    h.pose((d, s) => d.setScore(s, 900));
    h.pose((d, s) => d.reset(s, { seed: 5 }));

    const s = h.snap();
    expect(s.screen).toBe("title");
    expect(s.score).toBe(0);
    expect(s.lives).toBe(START_LIVES);
    expect(s.wave).toBe(0);
    expect(s.rocks).toHaveLength(0);
    expect(s.waveSpawning).toBe(true);
    expect(s.saucerSpawning).toBe(true);
    expect(s.simTime).toBe(0);
    expect(s.ship.collision).toBe(true);
  });

  it("advances exactly one tick per frame", async () => {
    const h = await harness();
    h.pose((d, s) => d.reset(s));
    await h.step(120);
    expect(h.snap().simTime).toBeCloseTo(1, 6);
  });
});

// `reconcile` brings every reported reading into agreement with the field without
// advancing anything. This build works its two derived readings — the ship's
// `speed` and each rock's `radius` — out at the READ, so the call has nothing to
// rewrite; what these two cases pin is that it still ANSWERS for a posed field and
// that it costs no simulation time, which is the whole difference between it and
// stepping a frame.
describe("reconcile", () => {
  it("re-derives a reading from a posed velocity", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipVelocity(s, 30, 40));
    h.pose((d, s) => d.reconcile(s));
    expect(h.snap().ship.speed).toBeCloseTo(50, 10);

    h.pose((d, s) => d.addRock(s, "medium", 300, 300));
    h.pose((d, s) => d.reconcile(s));
    expect(h.snap().rocks[0]?.radius).toBe(ROCK_RADIUS.medium);
  });

  it("advances nothing, and twice matches once", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, 400, 300));
    h.pose((d, s) => d.setShipVelocity(s, 120, -90));
    h.pose((d, s) => d.setShipInvuln(s, 2));
    h.pose((d, s) => d.setFireCooldown(s, 7));
    h.pose((d, s) => d.setWaveBanner(s, 1.5));
    h.pose((d, s) => d.addRock(s, "large", 700, 200));
    h.pose((d, s) => d.addBullet(s, 100, 100, 50, 0));
    h.pose((d, s) => d.addSaucer(s, 200, 500));

    const before = JSON.stringify(h.snap());
    h.pose((d, s) => d.reconcile(s));
    const once = JSON.stringify(h.snap());
    h.pose((d, s) => d.reconcile(s));
    const twice = JSON.stringify(h.snap());

    // The clock, the positions, the velocities and every timer are untouched, so
    // the whole snapshot is byte-identical rather than merely close.
    expect(once).toBe(before);
    expect(twice).toBe(once);
  });
});

describe("the field and the well", () => {
  it("wraps every body and carries its velocity across", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, FIELD_W - 4, 300));
    h.pose((d, s) => d.setShipVelocity(s, 600, 0));
    await h.step(2);
    const ship = h.snap().ship;
    expect(ship.x).toBeLessThan(100);
    expect(ship.vx).toBeGreaterThan(500);
  });

  it("pulls a bullet, a rock and a saucer round, and never the powered craft", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, 200, 360));
    h.pose((d, s) => d.setShipVelocity(s, 0, 0));
    h.pose((d, s) => d.addBullet(s, 200, 200, 0, 0));
    h.pose((d, s) => d.addEnemyBullet(s, 1080, 200, 0, 0));
    h.pose((d, s) => d.addRock(s, "small", 200, 560));
    h.pose((d, s) => d.addSaucer(s, 300, 120));
    h.pose((d, s) => d.setSaucerMind(s, false));
    h.pose((d, s) => d.setSaucerVelocity(s, 0, 0));
    await h.step(30);

    const s = h.snap();
    expect(Math.hypot(s.bullets[0].vx, s.bullets[0].vy)).toBeGreaterThan(1);
    expect(
      Math.hypot(s.enemyBullets[0].vx, s.enemyBullets[0].vy),
    ).toBeGreaterThan(1);
    expect(Math.hypot(s.rocks[0].vx, s.rocks[0].vy)).toBeGreaterThan(1);
    expect(s.ship.vx).toBe(0);
    expect(s.saucer?.vx).toBe(0);
    expect(s.saucer?.vy).toBe(0);
  });

  it("pulls at the stated magnitude and caps inside the softening radius", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addBullet(s, STAR_X, STAR_Y - 200, 0, 0));
    h.pose((d, s) => d.addBullet(s, STAR_X, STAR_Y - 60, 0, 0));
    await h.step(1);
    const s = h.snap();
    expect(s.bullets[0].vy / TICK_DT).toBeCloseTo(112.5, 4);
    expect(s.bullets[1].vy / TICK_DT).toBeCloseTo(4_500_000 / (90 * 90), 4);
  });

  it("uses the direct vector to the star rather than a wrapped one", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addBullet(s, 20, 20, 0, 0));
    await h.step(1);
    const b = h.snap().bullets[0];
    // Toward the middle of the field, not out through the corner.
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vy).toBeGreaterThan(0);
  });
});

describe("the star's core", () => {
  it("absorbs a shot of either gun", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addBullet(s, STAR_X - 200, STAR_Y, 900, 0));
    h.pose((d, s) => d.addEnemyBullet(s, STAR_X + 200, STAR_Y, -900, 0));
    await h.step(40);
    const s = h.snap();
    expect(s.bullets).toHaveLength(0);
    expect(s.enemyBullets).toHaveLength(0);
    expect(s.score).toBe(0);
  });

  it("recycles a rock it swallows, keeping the count and the size", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "medium", STAR_X - 150, STAR_Y));
    h.pose((d, s) => {
      const id = d.snapshot(s).rocks[0].id;
      return d.setRockVelocity(s, id, 400, 0);
    });

    let landed = h.snap().rocks[0];
    for (let i = 0; i < 90; i += 1) {
      await h.step(1);
      const now = h.snap().rocks[0];
      // The recycle is the one tick the rock jumps across the field.
      if (Math.hypot(now.x - landed.x, now.y - landed.y) > 200) {
        landed = now;
        break;
      }
      landed = now;
    }

    const s = h.snap();
    expect(s.rocks).toHaveLength(1);
    expect(s.rocks[0].size).toBe("medium");
    expect(s.score).toBe(0);
    const onEdge =
      landed.x <= 1 ||
      landed.x >= FIELD_W - 1 ||
      landed.y <= 1 ||
      landed.y >= FIELD_H - 1;
    expect(onEdge).toBe(true);
    // ...and heading into the field from the edge it re-entered at.
    const inward =
      (landed.x <= 1 && landed.vx > 0) ||
      (landed.x >= FIELD_W - 1 && landed.vx < 0) ||
      (landed.y <= 1 && landed.vy > 0) ||
      (landed.y >= FIELD_H - 1 && landed.vy < 0);
    expect(inward).toBe(true);
  });

  it("slides the ship along the core, keeping its facing and its life", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipAngle(s, 0));
    h.pose((d, s) => d.setShipPosition(s, STAR_X - 200, STAR_Y - 20));
    h.pose((d, s) => d.setShipVelocity(s, 300, 0));
    await h.step(120);

    const s = h.snap();
    const away = Math.hypot(s.ship.x - STAR_X, s.ship.y - STAR_Y);
    expect(away).toBeGreaterThanOrEqual(CORE_R + SHIP_R - 0.001);
    expect(s.ship.angle).toBe(0);
    expect(s.lives).toBe(START_LIVES);
  });
});

describe("the ship", () => {
  it("turns at the stated rate, in both directions, without moving", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipAngle(s, 0));
    h.pose((d, s) => d.setShipVelocity(s, 0, 0));
    h.down("ArrowRight");
    await h.step(60);
    h.up("ArrowRight");
    let s = h.snap();
    expect(s.ship.angle).toBeCloseTo(SHIP_TURN * 0.5, 4);
    expect(s.ship.speed).toBe(0);

    h.pose((d, st) => d.setShipAngle(st, 0));
    h.down("KeyA");
    await h.step(60);
    h.up("KeyA");
    s = h.snap();
    expect(s.ship.angle).toBeCloseTo(-SHIP_TURN * 0.5, 4);
  });

  it("thrusts along the facing and caps its speed", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipAngle(s, 0));
    h.pose((d, s) => d.setShipPosition(s, 200, 200));
    h.pose((d, s) => d.setShipVelocity(s, 0, 0));
    h.down("KeyW");
    await h.step(20);
    let s = h.snap();
    expect(s.ship.thrusting).toBe(true);
    expect(s.ship.vx).toBeGreaterThan(50);
    expect(Math.abs(s.ship.vy)).toBeLessThan(1e-9);

    await h.step(600);
    h.up("KeyW");
    s = h.snap();
    expect(s.ship.speed).toBeLessThanOrEqual(SHIP_MAX + 1e-9);
    expect(s.ship.speed).toBeGreaterThan(SHIP_MAX - 1);
  });

  it("halves a coasting speed every three seconds", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipVelocity(s, 400, 0));
    await h.step(360);
    expect(h.snap().ship.speed).toBeCloseTo(200, 3);
  });
});

describe("the gun", () => {
  it("fires from the nose, carrying the ship's velocity", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, 300, 300));
    h.pose((d, s) => d.setShipAngle(s, 0));
    h.pose((d, s) => d.setShipVelocity(s, 100, 0));
    h.down("Space");
    await h.step(1);
    h.up("Space");

    const s = h.snap();
    expect(s.bullets).toHaveLength(1);
    const b = s.bullets[0];
    // The round leaves with exactly its muzzle velocity: the well first moves
    // it on the tick after the one it was fired on.
    expect(b.vx).toBeCloseTo(s.ship.vx + MUZZLE_SPEED, 9);
    expect(b.vy).toBeCloseTo(s.ship.vy, 9);
    expect(b.life).toBeCloseTo(BULLET_LIFE, 9);
    expect(Math.hypot(b.x - s.ship.x, b.y - s.ship.y)).toBeLessThanOrEqual(
      SHIP_R + 1e-9,
    );
  });

  it("gates the gun and caps the rounds in flight", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, 300, 120));
    h.pose((d, s) => d.setShipAngle(s, -Math.PI / 2));
    h.down("Space");
    await h.step(2);
    expect(h.snap().bullets).toHaveLength(1);
    await h.step(FIRE_INTERVAL_TICKS - 2);
    expect(h.snap().bullets).toHaveLength(1);
    await h.step(2);
    expect(h.snap().bullets).toHaveLength(2);
    await h.step(FIRE_INTERVAL_TICKS * 6);
    expect(h.snap().bullets.length).toBeLessThanOrEqual(MAX_BULLETS);
    h.up("Space");
  });

  it("removes a round when its life runs out", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addBullet(s, 100, 100, 0, 0));
    await h.step(BULLET_LIFE * TICK_HZ - 1);
    expect(h.snap().bullets).toHaveLength(1);
    await h.step(1);
    expect(h.snap().bullets).toHaveLength(0);
  });

  it("does not pass through a rock at speed", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "large", 640, 120));
    h.pose((d, s) => d.addBullet(s, 200, 120, 60_000, 0));
    await h.step(1);
    const s = h.snap();
    expect(s.bullets).toHaveLength(0);
    expect(s.score).toBe(SCORE_LARGE);
  });
});

describe("rocks", () => {
  it("splits a Large into two Mediums at its position, fanned across the shot", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "large", 320, 620));
    h.pose((d, s) => {
      const id = d.snapshot(s).rocks[0].id;
      return d.setRockVelocity(s, id, -60, -60);
    });
    // On the parent's doorstep, travelling horizontally, so the two kick
    // conventions differ by construction.
    const before = h.snap().rocks[0];
    h.pose((d, s) =>
      d.addBullet(s, before.x - ROCK_RADIUS.large - 6, before.y, 800, 0),
    );

    let parent = h.snap().rocks[0];
    for (let i = 0; i < 20; i += 1) {
      const next = h.snap();
      if (next.rocks.length === 2) break;
      parent = next.rocks[0];
      await h.step(1);
    }

    const s = h.snap();
    expect(s.rocks).toHaveLength(2);
    expect(s.rocks.every((r) => r.size === "medium")).toBe(true);
    expect(s.rocks[0].x).toBeCloseTo(s.rocks[1].x, 6);
    expect(s.rocks[0].y).toBeCloseTo(s.rocks[1].y, 6);

    const meanVx = (s.rocks[0].vx + s.rocks[1].vx) / 2;
    const meanVy = (s.rocks[0].vy + s.rocks[1].vy) / 2;
    // The parent read here is the snapshot from the tick BEFORE the round
    // landed, so the well's own contribution over that one tick — about a
    // quarter of a unit at this distance — sits inside the tolerance.
    expect(Math.abs(meanVx - parent.vx)).toBeLessThan(0.5);
    expect(Math.abs(meanVy - parent.vy)).toBeLessThan(0.5);

    // The kick is across the BULLET's travel, which was horizontal.
    const kickX = (s.rocks[0].vx - s.rocks[1].vx) / 2;
    const kickY = (s.rocks[0].vy - s.rocks[1].vy) / 2;
    expect(Math.hypot(kickX, kickY)).toBeCloseTo(SPLIT_KICK, 6);
    // Across the round's own travel, which was horizontal, rather than across
    // the parent's diagonal drift.
    expect(Math.abs(kickX)).toBeLessThan(1);
  });

  it("leaves nothing when a Small is destroyed, and scores each size", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "small", 400, 200));
    h.pose((d, s) => d.addBullet(s, 400 - ROCK_RADIUS.small - 4, 200, 700, 0));
    await h.step(3);
    const s = h.snap();
    expect(s.rocks).toHaveLength(0);
    expect(s.score).toBe(100);
  });

  it("scores a Medium at its own figure", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "medium", 400, 200));
    h.pose((d, s) => d.addBullet(s, 400 - ROCK_RADIUS.medium - 4, 200, 700, 0));
    await h.step(3);
    expect(h.snap().score).toBe(SCORE_MEDIUM);
  });

  it("passes two rocks through each other", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addRock(s, "large", 200, 90));
    h.pose((d, s) => d.addRock(s, "large", 400, 90));
    h.pose((d, s) => {
      const [a, b] = d.snapshot(s).rocks;
      return d.setRockVelocity(
        d.setRockVelocity(s, a.id, 200, 0),
        b.id,
        -200,
        0,
      );
    });
    await h.step(120);
    expect(h.snap().rocks).toHaveLength(2);
  });
});

describe("the saucer", () => {
  it("arrives on its own cadence, at an edge, heading into the field", async () => {
    const h = await harness();
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.setWaveSpawning(s, false));
    h.pose((d, s) => d.setShipCollision(s, false));

    await h.step(SAUCER_FIRST_DELAY * TICK_HZ - 2);
    expect(h.snap().saucer).toBeNull();
    await h.step(3);

    const saucer = h.snap().saucer;
    expect(saucer).not.toBeNull();
    const nearLeft = saucer!.x <= SAUCER_R * 2;
    const nearRight = saucer!.x >= FIELD_W - SAUCER_R * 2;
    expect(nearLeft || nearRight).toBe(true);
    expect(nearLeft ? saucer!.vx > 0 : saucer!.vx < 0).toBe(true);
    expect(Math.abs(saucer!.vx)).toBeCloseTo(SAUCER_SPEED, 6);
    expect(saucer!.vy).toBe(0);
    expect(h.cues.some((c) => c.cue === CUES.saucer)).toBe(true);
  });

  it("leaves after its lifetime, and only one is ever up", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addSaucer(s, 100, 300));
    h.pose((d, s) => d.setSaucerMind(s, false));
    h.pose((d, s) => d.setSaucerGun(s, false));
    const first = h.snap().saucer!.id;

    h.pose((d, s) => d.addSaucer(s, 400, 300));
    const second = h.snap().saucer!.id;
    expect(second).not.toBe(first);

    await h.step(SAUCER_LIFETIME * TICK_HZ - 1);
    expect(h.snap().saucer).not.toBeNull();
    await h.step(1);
    expect(h.snap().saucer).toBeNull();
  });

  it("weaves vertically at the stated speed, once an interval", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addSaucer(s, 200, 100));
    h.pose((d, s) => d.setSaucerGun(s, false));
    h.pose((d, s) => d.setSaucerTravel(s, false));

    await h.step(TICK_HZ - 1);
    expect(h.snap().saucer!.vy).toBe(0);
    await h.step(1);
    const first = h.snap().saucer!.vy;
    expect(Math.abs(first)).toBeCloseTo(SAUCER_WEAVE_SPEED, 6);
    await h.step(TICK_HZ);
    expect(h.snap().saucer!.vy).toBeCloseTo(-first, 6);
  });

  it("holds its course with its mind off and its centre with its travel off", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addSaucer(s, 200, 100));
    h.pose((d, s) => d.setSaucerMind(s, false));
    h.pose((d, s) => d.setSaucerGun(s, false));
    await h.step(240);
    let s = h.snap();
    expect(s.saucer!.vy).toBe(0);
    expect(s.saucer!.x).toBeGreaterThan(200);

    h.pose((d, st) => d.setSaucerTravel(st, false));
    const held = h.snap().saucer!.x;
    await h.step(120);
    s = h.snap();
    expect(s.saucer!.x).toBe(held);
  });

  it("clears the core on every crossing", async () => {
    const h = await harness();
    let worst = Number.POSITIVE_INFINITY;

    for (const row of [-80, -40, 0, 40, 80]) {
      for (const fromLeft of [true, false]) {
        await playing(h);
        h.pose((d, s) => d.setShipPosition(s, 640, 700));
        h.pose((d, s) =>
          d.addSaucer(
            s,
            fromLeft ? SAUCER_R : FIELD_W - SAUCER_R,
            STAR_Y + row,
          ),
        );
        h.pose((d, s) => d.setSaucerGun(s, false));
        h.pose((d, s) =>
          d.setSaucerVelocity(s, fromLeft ? SAUCER_SPEED : -SAUCER_SPEED, 0),
        );

        let previous = h.snap().saucer!;
        for (let i = 0; i < 140; i += 1) {
          await h.step(8);
          const now = h.snap().saucer;
          if (now === null) break;
          worst = Math.min(worst, segmentToStar(previous, now));
          previous = now;
        }
      }
    }

    expect(worst).toBeGreaterThan(CORE_R + SAUCER_R);
  });

  it("fires an aimed round on its own cadence, carrying its velocity", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, 300, 420));
    h.pose((d, s) => d.addSaucer(s, 300, 200));
    h.pose((d, s) => d.setSaucerMind(s, false));
    h.pose((d, s) => d.setSaucerTravel(s, false));

    await h.step(SAUCER_FIRE_INTERVAL * TICK_HZ - 1);
    expect(h.snap().enemyBullets).toHaveLength(0);
    await h.step(1);

    const s = h.snap();
    expect(s.enemyBullets).toHaveLength(1);
    const shot = s.enemyBullets[0];
    const own = { vx: shot.vx - s.saucer!.vx, vy: shot.vy - s.saucer!.vy };
    expect(Math.hypot(own.vx, own.vy)).toBeCloseTo(SAUCER_BULLET_SPEED, 4);
    const bearing = Math.atan2(own.vy, own.vx);
    expect(Math.abs(bearing - Math.PI / 2)).toBeLessThanOrEqual(
      (10 * Math.PI) / 180 + 1e-9,
    );
  });

  it("is destroyed by one of the ship's rounds", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.addSaucer(s, 400, 200));
    h.pose((d, s) => d.setSaucerMind(s, false));
    h.pose((d, s) => d.setSaucerGun(s, false));
    h.pose((d, s) => d.setSaucerTravel(s, false));
    h.pose((d, s) => d.addBullet(s, 400 - SAUCER_R - 6, 200, 700, 0));
    await h.step(3);
    const s = h.snap();
    expect(s.saucer).toBeNull();
    expect(s.score).toBe(SCORE_SAUCER);
  });
});

/** The star's distance to the straight line between two saucer samples. */
function segmentToStar(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(STAR_X - a.x, STAR_Y - a.y);
  let t = ((STAR_X - a.x) * dx + (STAR_Y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(STAR_X - (a.x + dx * t), STAR_Y - (a.y + dy * t));
}

describe("waves", () => {
  it("clears on the tick the last rock is destroyed, and not on an empty field", async () => {
    const h = await harness();
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.setSaucerSpawning(s, false));
    h.pose((d, s) => d.setShipCollision(s, false));
    h.pose((d, s) => d.setWave(s, 1));
    h.pose((d, s) => d.clearRocks(s));

    await h.step(60);
    expect(h.snap().wave).toBe(1);
    expect(h.snap().waveBanner).toBe(0);

    h.pose((d, s) => d.addRock(s, "small", 400, 200));
    h.pose((d, s) => d.addBullet(s, 400 - ROCK_RADIUS.small - 4, 200, 700, 0));
    await h.step(3);
    let s = h.snap();
    expect(s.wave).toBe(2);
    expect(s.waveBanner).toBeGreaterThan(0);
    expect(s.rocks).toHaveLength(0);

    await h.step(WAVE_BANNER_TIME * TICK_HZ - 4);
    s = h.snap();
    expect(s.waveBanner).toBeGreaterThan(0);
    expect(s.rocks).toHaveLength(0);

    await h.step(3);
    s = h.snap();
    expect(s.waveBanner).toBe(0);
    expect(s.rocks).toHaveLength(5);
    expect(s.rocks.every((r) => r.size === "large")).toBe(true);
  });

  it("spawns wave one clear of the ship and the star", async () => {
    const h = await harness();
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setSaucerSpawning(s, false));
    await h.tap("Enter");

    const s = h.snap();
    expect(s.screen).toBe("playing");
    expect(s.wave).toBe(1);
    expect(s.rocks).toHaveLength(4);
    for (const rock of s.rocks) {
      expect(
        Math.hypot(rock.x - s.ship.x, rock.y - s.ship.y),
      ).toBeGreaterThanOrEqual(300);
      expect(
        Math.hypot(rock.x - STAR_X, rock.y - STAR_Y),
      ).toBeGreaterThanOrEqual(200);
    }
  });
});

describe("lives and the run", () => {
  it("loses a ship to a rock, respawns it safe, and ends the game at zero", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipCollision(s, true));
    h.pose((d, s) => d.setShipPosition(s, 300, 300));
    h.pose((d, s) => d.addRock(s, "large", 300, 300));
    await h.step(1);

    let s = h.snap();
    expect(s.lives).toBe(START_LIVES - 1);
    expect(s.ship.x).toBe(SAFE_X);
    expect(s.ship.y).toBe(SAFE_Y);
    expect(s.ship.speed).toBe(0);
    expect(s.ship.invuln).toBeCloseTo(INVULN_TIME, 6);
    expect(h.cues.some((c) => c.cue === CUES.death)).toBe(true);

    h.pose((d, st) => d.setLives(st, 1));
    h.pose((d, st) => d.setShipInvuln(st, 0));
    h.pose((d, st) => d.setShipPosition(st, 300, 300));
    await h.step(1);
    s = h.snap();
    expect(s.lives).toBe(0);
    expect(s.screen).toBe("gameover");
  });

  it("ignores a rock through the respawn grace and answers to it after", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipCollision(s, true));
    h.pose((d, s) => d.setShipInvuln(s, 0.5));
    h.pose((d, s) => d.setShipPosition(s, 300, 300));
    h.pose((d, s) => d.addRock(s, "large", 300, 300));
    h.pose((d, s) => {
      const id = d.snapshot(s).rocks[0].id;
      return d.setRockVelocity(s, id, 0, 0);
    });

    await h.step(30);
    expect(h.snap().lives).toBe(START_LIVES);
    await h.step(45);
    expect(h.snap().lives).toBe(START_LIVES - 1);
  });

  it("grants an extra ship each time the score crosses a multiple", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setScore(s, 9_980));
    h.pose((d, s) => d.addRock(s, "small", 400, 200));
    h.pose((d, s) => d.addBullet(s, 400 - ROCK_RADIUS.small - 4, 200, 700, 0));
    await h.step(3);
    const s = h.snap();
    expect(s.score).toBe(10_080);
    expect(s.lives).toBe(START_LIVES + 1);
    expect(h.cues.some((c) => c.cue === CUES.extraLife)).toBe(true);
  });
});

describe("the screens", () => {
  it("plays, pauses, resumes, restarts and quits", async () => {
    const h = await harness();
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setSaucerSpawning(s, false));
    await h.tap("Enter");
    expect(h.snap().screen).toBe("playing");

    await h.tap("KeyP");
    expect(h.snap().screen).toBe("paused");

    const frozen = h.snap();
    await h.step(120);
    const later = h.snap();
    expect(later.ship.x).toBe(frozen.ship.x);
    expect(later.rocks[0].x).toBe(frozen.rocks[0].x);
    expect(later.simTime).toBeGreaterThan(frozen.simTime);

    await h.tap("Enter");
    expect(h.snap().screen).toBe("playing");

    h.pose((d, s) => d.setLives(s, 2));
    h.pose((d, s) => d.setScore(s, 500));
    await h.tap("Escape");
    h.pose((d, s) => d.setMenuIndex(s, 1));
    await h.tap("Enter");
    let s = h.snap();
    expect(s.screen).toBe("playing");
    expect(s.lives).toBe(START_LIVES);
    expect(s.score).toBe(0);

    await h.tap("Escape");
    h.pose((d, st) => d.setMenuIndex(st, 2));
    await h.tap("Enter");
    s = h.snap();
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
  });

  it("a restart begins a game with no saucer on the field", async () => {
    const h = await harness();
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setSaucerSpawning(s, false));
    await h.tap("Enter");
    h.pose((d, s) => d.setLives(s, 2));
    h.pose((d, s) => d.addSaucer(s, 300, 200));
    await h.tap("KeyP");
    expect(h.snap().saucer).not.toBeNull();

    h.pose((d, s) => d.setMenuIndex(s, 1));
    await h.tap("Enter");
    const s = h.snap();
    expect(s.screen).toBe("playing");
    expect(s.saucer).toBeNull();
    expect(s.lives).toBe(START_LIVES);
  });

  it("reaches how-to and comes back, and wraps a menu at both ends", async () => {
    const h = await harness();
    h.pose((d, s) => d.reset(s));
    await h.tap("ArrowDown");
    expect(h.snap().menuIndex).toBe(1);
    await h.tap("ArrowDown");
    expect(h.snap().menuIndex).toBe(0);
    await h.tap("ArrowUp");
    expect(h.snap().menuIndex).toBe(1);

    await h.tap("Enter");
    expect(h.snap().screen).toBe("howto");
    await h.tap("Escape");
    const s = h.snap();
    expect(s.screen).toBe("title");
    // The how-to leaves the title's highlight alone, so the return lands on the
    // entry that opened it (`specs/ui.md`).
    expect(s.menuIndex).toBe(1);
  });
});

describe("what the frame draws", () => {
  it("draws a dark field, a bright core, and a halo that fades and stops", async () => {
    const h = await harness();
    await playing(h);
    await h.step(1);

    const [br, bg, bb] = h.pixel(120, 120);
    expect((0.2126 * br + 0.7152 * bg + 0.0722 * bb) / 255).toBeLessThan(0.25);

    const core = h.pixel(STAR_X, STAR_Y);
    expect(core[0] + core[1] + core[2]).toBeGreaterThan(600);

    const near = h.pixel(STAR_X + 45, STAR_Y);
    const far = h.pixel(STAR_X + 150, STAR_Y);
    const beyond = h.pixel(STAR_X + 185, STAR_Y);
    const lum = (p: [number, number, number]): number => p[0] + p[1] + p[2];
    expect(lum(near)).toBeGreaterThan(lum(far));
    expect(lum(far)).toBeGreaterThan(lum(beyond));
    expect(beyond).toEqual([br, bg, bb]);
  });

  it("draws the ship, a rock, the saucer and a round apart from each other", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, 200, 150));
    h.pose((d, s) => d.setShipAngle(s, 0));
    h.pose((d, s) => d.addRock(s, "large", 500, 150));
    h.pose((d, s) => d.addSaucer(s, 800, 150));
    h.pose((d, s) => d.setSaucerTravel(s, false));
    h.pose((d, s) => d.setSaucerMind(s, false));
    h.pose((d, s) => d.setSaucerGun(s, false));
    h.pose((d, s) => d.addBullet(s, 1050, 150, 400, 0));
    await h.step(1);

    const field = h.pixel(120, 500);
    const ship = h.pixel(200, 150);
    const rock = h.pixel(500, 150);
    const saucer = h.pixel(800, 150);
    const bullet = h.pixel(1053, 150);

    const apart = (
      a: [number, number, number],
      b: [number, number, number],
    ): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    for (const body of [ship, rock, saucer, bullet]) {
      expect(apart(body, field)).toBeGreaterThan(60);
    }
    expect(apart(ship, rock)).toBeGreaterThan(60);
    expect(apart(ship, saucer)).toBeGreaterThan(60);
    expect(apart(rock, saucer)).toBeGreaterThan(60);
    expect(apart(rock, bullet)).toBeGreaterThan(60);
  });

  it("draws a flame only while the ship burns, and blinks it through the grace", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setShipPosition(s, 300, 400));
    h.pose((d, s) => d.setShipAngle(s, 0));
    await h.step(1);
    const cold = h.pixel(300 - 24, 400);

    h.down("ArrowUp");
    await h.step(2);
    h.up("ArrowUp");
    const hot = h.pixel(300 - 24, 400);
    expect(hot).not.toEqual(cold);

    h.pose((d, s) => d.setShipInvuln(s, 1.0));
    await h.step(1);
    const first = h.pixel(300, 400 - SHIP_R - 7);
    await h.step(Math.round(0.09 * TICK_HZ));
    const second = h.pixel(300, 400 - SHIP_R - 7);
    expect(first).not.toEqual(second);
  });

  it("draws the score, the reserve glyphs and the wave banner", async () => {
    const h = await harness();
    await playing(h);
    h.pose((d, s) => d.setScore(s, 4321));
    h.pose((d, s) => d.setLives(s, 3));
    h.pose((d, s) => d.setWaveBanner(s, 1));
    h.pose((d, s) => d.setWave(s, 3));
    await h.step(1);

    const ink = (x0: number, y0: number, w: number, hgt: number): number => {
      const data = h.ctx.getImageData(x0, y0, w, hgt).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] > 200) lit += 1;
      }
      return lit;
    };

    expect(ink(20, 24, 220, 44)).toBeGreaterThan(50);
    expect(ink(20, 62, 120, 34)).toBeGreaterThan(20);
    expect(ink(480, 320, 320, 90)).toBeGreaterThan(80);
  });
});
