import { afterEach, describe, expect, it } from "vitest";
import {
  EXTRA_LIFE_STEP,
  FACE_UP,
  ROCK_RADIUS,
  SAFE_X,
  SAFE_Y,
  SHATTER_DEBUG_VERSION,
  START_LIVES,
  TICK_DT,
} from "./constants";
import { createHarness, startPlaying, ticksFor, type Harness } from "./harness";

let harness: Harness | null = null;

async function open(): Promise<Harness> {
  harness = await createHarness();
  return harness;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the debug surface", () => {
  it("is reached off the engine and reports its version", async () => {
    const h = await open();
    expect(h.debug.version).toBe(SHATTER_DEBUG_VERSION);
    expect(typeof h.debug.snapshot).toBe("function");
  });

  it("is live: a posed rock reads back and then drifts", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.addRock("medium", 300, 200);
    const id = h.debug.snapshot().rocks[0].id;
    h.debug.setRockVelocity(id, 120, 0);

    expect(h.debug.snapshot().rocks[0]).toMatchObject({
      x: 300,
      y: 200,
      vx: 120,
      size: "medium",
      radius: ROCK_RADIUS.medium,
    });

    await h.seconds(1);
    expect(h.debug.snapshot().rocks[0].x).toBeGreaterThan(390);
  });

  it("reports every pose it accepts", async () => {
    const h = await open();
    startPlaying(h.debug);

    h.debug.setScreen("paused");
    h.debug.setMenuIndex(2);
    h.debug.setScore(1234);
    h.debug.setLives(2);
    h.debug.setWave(6);
    h.debug.setWaveBanner(0.75);
    h.debug.setWaveSpawning(true);
    h.debug.setSaucerSpawning(true);
    h.debug.setShipPosition(410, 120);
    h.debug.setShipVelocity(-30, 55);
    h.debug.setShipAngle(1.25);
    h.debug.setShipInvuln(1.5);
    h.debug.setFireCooldown(9);
    h.debug.setShipCollision(false);

    const seen = h.debug.snapshot();
    expect(seen).toMatchObject({
      screen: "paused",
      menuIndex: 2,
      score: 1234,
      lives: 2,
      wave: 6,
      waveBanner: 0.75,
      waveSpawning: true,
      saucerSpawning: true,
    });
    expect(seen.ship).toMatchObject({
      x: 410,
      y: 120,
      vx: -30,
      vy: 55,
      angle: 1.25,
      invuln: 1.5,
      fireCooldown: 9,
      collision: false,
    });
    expect(seen.ship.speed).toBeCloseTo(Math.hypot(-30, 55), 9);

    h.debug.addSaucer(200, 200);
    h.debug.setSaucerVelocity(-40, 20);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerTravel(false);
    expect(h.debug.snapshot().saucer).toMatchObject({
      x: 200,
      y: 200,
      vx: -40,
      vy: 20,
      mind: false,
      gun: false,
      travel: false,
    });
  });

  it("reports the whole documented shape over a populated field", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.addRock("large", 200, 200);
    h.debug.addRock("medium", 300, 200);
    h.debug.addRock("small", 400, 200);
    h.debug.addBullet(500, 200, 10, 0);
    h.debug.addEnemyBullet(600, 200, -10, 0);
    h.debug.addSaucer(700, 200);

    const seen = h.debug.snapshot();
    expect(Object.keys(seen).sort()).toEqual(
      [
        "bullets",
        "enemyBullets",
        "lives",
        "menuIndex",
        "muted",
        "rocks",
        "saucer",
        "saucerClock",
        "saucerDue",
        "saucerSpawning",
        "score",
        "screen",
        "ship",
        "simTime",
        "version",
        "waveBanner",
        "waveSpawning",
        "wave",
      ].sort(),
    );
    expect(seen.rocks.map((rock) => rock.size)).toEqual([
      "large",
      "medium",
      "small",
    ]);
    expect(seen.rocks.map((rock) => rock.radius)).toEqual([
      ROCK_RADIUS.large,
      ROCK_RADIUS.medium,
      ROCK_RADIUS.small,
    ]);
    expect(seen.bullets).toHaveLength(1);
    expect(seen.enemyBullets).toHaveLength(1);
    expect(seen.saucer).not.toBeNull();
    expect(typeof seen.muted).toBe("boolean");
  });
});

describe("reset", () => {
  it("restores every declared field to its title value", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.setScore(900);
    h.debug.setLives(1);
    h.debug.setWave(7);
    h.debug.setWaveBanner(1);
    h.debug.addRock("large", 100, 100);
    h.debug.addBullet(200, 200, 0, 0);
    h.debug.addEnemyBullet(300, 300, 0, 0);
    h.debug.addSaucer(400, 400);
    await h.advance(10);

    h.debug.reset();
    const seen = h.debug.snapshot();
    expect(seen).toMatchObject({
      screen: "title",
      menuIndex: 0,
      score: 0,
      lives: START_LIVES,
      wave: 0,
      waveBanner: 0,
      waveSpawning: true,
      saucerSpawning: true,
      simTime: 0,
    });
    expect(seen.rocks).toEqual([]);
    expect(seen.bullets).toEqual([]);
    expect(seen.enemyBullets).toEqual([]);
    expect(seen.saucer).toBeNull();
    expect(seen.ship).toMatchObject({
      x: SAFE_X,
      y: SAFE_Y,
      vx: 0,
      vy: 0,
      angle: FACE_UP,
      invuln: 0,
      collision: true,
      fireCooldown: 0,
    });
  });

  it("leaves muting exactly as it stands", async () => {
    const h = await open();
    await h.tap("KeyM");
    expect(h.debug.snapshot().muted).toBe(true);
    h.debug.reset();
    await h.advance(1);
    expect(h.debug.snapshot().muted).toBe(true);
  });

  it("seeds the game's randomness", async () => {
    const layout = async (seed: number): Promise<string> => {
      const h = await createHarness();
      h.debug.reset({ seed });
      await h.tap("Enter");
      const rocks = h.debug
        .snapshot()
        .rocks.map((rock) => `${rock.x.toFixed(2)},${rock.y.toFixed(2)}`)
        .join(" ");
      h.dispose();
      return rocks;
    };

    const first = await layout(7);
    expect(first).not.toBe("");
    expect(await layout(7)).toBe(first);
    expect(await layout(8)).not.toBe(first);
  });
});

describe("the clock", () => {
  it("advances exactly the time it is asked for", async () => {
    const h = await open();
    startPlaying(h.debug);
    await h.advance(120);
    expect(h.debug.snapshot().simTime).toBeCloseTo(120 * TICK_DT, 9);
  });

  it("reaches the same state however the time is divided", async () => {
    const run = async (chunks: number[]): Promise<string> => {
      const h = await createHarness();
      h.debug.reset({ seed: 5 });
      startPlaying(h.debug);
      h.debug.addRock("large", 300, 180);
      h.debug.setRockVelocity(h.debug.snapshot().rocks[0].id, 90, 40);
      for (const chunk of chunks) await h.advance(chunk);
      const rock = h.debug.snapshot().rocks[0];
      const reading = `${rock.x.toFixed(6)},${rock.y.toFixed(6)}`;
      h.dispose();
      return reading;
    };

    const single = await run([ticksFor(1)]);
    expect(await run(new Array<number>(120).fill(1))).toBe(single);
  });

  it("advances nothing when it is asked for nothing", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.addRock("large", 300, 180);
    h.debug.setRockVelocity(h.debug.snapshot().rocks[0].id, 90, 40);
    await h.advance(4);

    const before = h.debug.snapshot();
    await h.advance(0);
    expect(h.debug.snapshot()).toEqual(before);
  });
});

describe("the rosters", () => {
  it("each clear empties one roster and leaves the rest standing", async () => {
    const h = await open();
    startPlaying(h.debug);
    const populate = (): void => {
      h.debug.addRock("large", 100, 100);
      h.debug.addBullet(200, 100, 0, 0);
      h.debug.addEnemyBullet(300, 100, 0, 0);
      h.debug.addSaucer(400, 100);
    };

    populate();
    h.debug.clearRocks();
    let seen = h.debug.snapshot();
    expect(seen.rocks).toEqual([]);
    expect(seen.bullets).toHaveLength(1);
    expect(seen.enemyBullets).toHaveLength(1);
    expect(seen.saucer).not.toBeNull();

    startPlaying(h.debug);
    populate();
    h.debug.clearBullets();
    seen = h.debug.snapshot();
    expect(seen.bullets).toEqual([]);
    expect(seen.rocks).toHaveLength(1);
    expect(seen.enemyBullets).toHaveLength(1);
    expect(seen.saucer).not.toBeNull();

    startPlaying(h.debug);
    populate();
    h.debug.clearEnemyBullets();
    seen = h.debug.snapshot();
    expect(seen.enemyBullets).toEqual([]);
    expect(seen.rocks).toHaveLength(1);
    expect(seen.bullets).toHaveLength(1);
    expect(seen.saucer).not.toBeNull();

    startPlaying(h.debug);
    populate();
    h.debug.removeSaucer();
    seen = h.debug.snapshot();
    expect(seen.saucer).toBeNull();
    expect(seen.rocks).toHaveLength(1);
    expect(seen.bullets).toHaveLength(1);
    expect(seen.enemyBullets).toHaveLength(1);
  });

  it("removes exactly the entry named by id", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.addRock("large", 100, 100);
    h.debug.addRock("large", 200, 100);
    h.debug.addRock("large", 300, 100);
    const ids = h.debug.snapshot().rocks.map((rock) => rock.id);
    h.debug.removeRock(ids[1]);
    expect(h.debug.snapshot().rocks.map((rock) => rock.id)).toEqual([
      ids[0],
      ids[2],
    ]);

    h.debug.addBullet(10, 10, 0, 0);
    h.debug.addBullet(20, 10, 0, 0);
    const bullets = h.debug.snapshot().bullets.map((bullet) => bullet.id);
    h.debug.removeBullet(bullets[0]);
    expect(h.debug.snapshot().bullets.map((bullet) => bullet.id)).toEqual([
      bullets[1],
    ]);

    h.debug.addEnemyBullet(10, 10, 0, 0);
    h.debug.addEnemyBullet(20, 10, 0, 0);
    const enemy = h.debug.snapshot().enemyBullets.map((bullet) => bullet.id);
    h.debug.removeEnemyBullet(enemy[1]);
    expect(h.debug.snapshot().enemyBullets.map((bullet) => bullet.id)).toEqual([
      enemy[0],
    ]);
  });

  it("gives every entity a distinct id and appends it to its roster", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.addRock("large", 100, 100);
    h.debug.addBullet(200, 100, 0, 0);
    h.debug.addEnemyBullet(300, 100, 0, 0);
    h.debug.addRock("small", 400, 100);
    h.debug.addSaucer(500, 100);

    const seen = h.debug.snapshot();
    const ids = [
      ...seen.rocks.map((rock) => rock.id),
      ...seen.bullets.map((bullet) => bullet.id),
      ...seen.enemyBullets.map((bullet) => bullet.id),
      seen.saucer?.id ?? -1,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    // The last rock added is the last entry of its roster.
    expect(seen.rocks[seen.rocks.length - 1].size).toBe("small");

    await h.advance(30);
    expect(h.debug.snapshot().rocks.map((rock) => rock.id)).toEqual(
      seen.rocks.map((rock) => rock.id),
    );
  });
});

describe("the world gates", () => {
  it("wave spawning off leaves an emptied field empty", async () => {
    const h = await open();
    startPlaying(h.debug);
    await h.seconds(10);
    const seen = h.debug.snapshot();
    expect(seen.rocks).toEqual([]);
    expect(seen.waveBanner).toBe(0);
    expect(seen.wave).toBe(1);
  });

  it("saucer spawning off keeps the saucer away, and on brings one", async () => {
    const h = await open();
    startPlaying(h.debug);
    await h.seconds(30);
    expect(h.debug.snapshot().saucer).toBeNull();

    h.debug.setSaucerSpawning(true);
    await h.seconds(20);
    expect(h.debug.snapshot().saucer).not.toBeNull();
  });

  it("posing the score grants no extra ship", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.setScore(EXTRA_LIFE_STEP - 10);
    await h.advance(1);
    h.debug.setScore(EXTRA_LIFE_STEP + 10);
    await h.advance(1);
    expect(h.debug.snapshot().lives).toBe(START_LIVES);
  });

  it("posing the wave spawns nothing and clears nothing", async () => {
    const h = await open();
    startPlaying(h.debug);
    h.debug.addRock("large", 200, 200);
    const before = h.debug.snapshot().rocks;
    h.debug.setWave(9);
    const after = h.debug.snapshot();
    expect(after.wave).toBe(9);
    expect(after.rocks).toEqual(before);
  });
});
