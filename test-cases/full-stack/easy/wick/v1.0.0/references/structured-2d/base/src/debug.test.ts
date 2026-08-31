// The debug surface of specs/instrumentation.md, driven exactly as a caller
// drives it: through `engine.debug` on a real engine, with `engine.advance`
// running the ticks between poses. Each pose is posed and read back, the
// domains throw, the no-op cases the specification fixes change nothing, and
// no pose sounds a cue.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAWN_TIME, TICK_DT, TICK_HZ } from "./constants";
import { createHarness, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

function playing(): Harness {
  h.debug.setScreen("playing");
  return h;
}

describe("the snapshot", () => {
  it("carries every field on every screen", () => {
    const snap = h.debug.snapshot();
    expect(snap.version).toBe(1);
    expect(snap.screen).toBe("title");
    for (const name of [
      "spawning",
      "events",
      "despawning",
      "enemyMotion",
      "enemyContact",
      "weaponFire",
      "effectMotion",
    ] as const) {
      expect(snap[name]).toBe(true);
    }
    expect(snap.run).toMatchObject({
      tick: 0,
      time: 0,
      level: 1,
      xp: 0,
      xpToNext: 5,
      kills: 0,
      player: { x: 0, y: 0, facing: "right", hp: 100 },
      maxHp: 100,
      armor: 0,
      moveSpeed: 180,
      pickupRadius: 48,
      weapons: [],
      passives: [],
      enemies: [],
      projectiles: [],
      zones: [],
      gems: [],
      pickups: [],
      offers: [],
      pool: [],
      nextOffers: null,
      pendingLevelUps: 0,
      chestResult: null,
      spawnTimer: 0,
      spawnWindow: 0,
      firedEvents: [],
      aliveCommons: 0,
      nextId: 0,
    });
    expect(snap.muted).toBe(false);
    expect(snap.accumulator).toBe(0);
    expect(snap.simTime).toBe(0);
    expect(snap.rngState).toBe(1);
    expect("autoStep" in snap).toBe(false);
  });

  it("is a copy, and reports the pool on levelup alone", () => {
    const { debug } = playing();
    const snap = debug.snapshot();
    snap.run.player.x = 99;
    expect(h.state.run.player.x).toBe(0);
    debug.setPendingLevelUps(1);
    debug.setScreen("levelup");
    const onOverlay = debug.snapshot();
    expect(onOverlay.run.pool.length).toBeGreaterThan(3);
    for (const id of onOverlay.run.offers) {
      expect(onOverlay.run.pool).toContain(id);
    }
    debug.choose(0);
    expect(debug.snapshot().run.pool).toEqual([]);
  });

  it("derives time, xpToNext, and the stats from the passives", () => {
    const { debug } = playing();
    debug.setTick(1800);
    debug.setLevel(4);
    debug.setPassive(0, "tallow", 2);
    debug.setPassive(1, "brass", 1);
    debug.setPassive(2, "bellows", 1);
    debug.setPassive(3, "lure", 2);
    const snap = debug.snapshot();
    expect(snap.run.time).toBe(30);
    expect(snap.run.spawnWindow).toBe(1);
    expect(snap.run.xpToNext).toBe(35);
    expect(snap.run.maxHp).toBe(130);
    expect(snap.run.armor).toBe(1);
    expect(snap.run.moveSpeed).toBeCloseTo(198);
    expect(snap.run.pickupRadius).toBe(72);
    expect(snap.run.player.hp).toBe(100);
  });
});

describe("reset", () => {
  it("restores the title state, the switches, and the seed, keeping muted", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    await h.step(5);
    h.engine.world.audio.setMuted(true);
    await h.step(1);
    debug.reset({ seed: 7 });
    const snap = debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.spawning).toBe(true);
    expect(snap.rngState).toBe(7);
    expect(snap.simTime).toBe(0);
    expect(snap.run.tick).toBe(0);
    expect(snap.muted).toBe(true);
    debug.reset();
    expect(debug.snapshot().rngState).toBe(1);
    expect(() => debug.reset({ seed: Number.NaN })).toThrow();
  });

  it("stops the music on the next tick of the mode", async () => {
    playing();
    await h.step(1);
    expect(h.engine.world.audio.looping("music")).toBe(true);
    h.debug.reset();
    await h.step(1);
    expect(h.engine.world.audio.looping("music")).toBe(false);
  });
});

describe("setScreen", () => {
  it("begins a fresh run from title, keeping rng and simTime and the switches", async () => {
    const { debug } = h;
    debug.setWeaponFire(false);
    await h.step(3);
    const before = debug.snapshot();
    expect(before.simTime).toBeCloseTo(3 * TICK_DT, 12);
    debug.setScreen("playing");
    const snap = debug.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.run.weapons).toEqual([{ id: "taper", level: 1, cooldown: 0 }]);
    expect(snap.simTime).toBe(before.simTime);
    expect(snap.rngState).toBe(before.rngState);
    expect(snap.weaponFire).toBe(false);
    expect(h.cues).toEqual([]);
  });

  it("resumes from paused, closes the chest, and is inert on levelup", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setTick(10);
    debug.setScreen("paused");
    expect(debug.snapshot().screen).toBe("paused");
    debug.setScreen("playing");
    expect(debug.snapshot().run.tick).toBe(10);
    debug.spawnPickup("chest", 0, 0);
    await h.step(1);
    expect(debug.snapshot().screen).toBe("chest");
    expect(debug.snapshot().run.chestResult).toEqual({
      kind: "level",
      item: "taper",
      level: 2,
    });
    debug.setScreen("playing");
    expect(debug.snapshot().screen).toBe("playing");
    expect(debug.snapshot().run.chestResult).toBeNull();
    expect(debug.snapshot().run.tick).toBe(11);
    debug.setPendingLevelUps(1);
    debug.setScreen("levelup");
    expect(debug.snapshot().screen).toBe("levelup");
    debug.setScreen("playing");
    expect(debug.snapshot().screen).toBe("levelup");
    debug.choose(0);
    expect(debug.snapshot().screen).toBe("playing");
  });

  it("needs a pending level-up to open the overlay", () => {
    const { debug } = playing();
    debug.setScreen("levelup");
    expect(debug.snapshot().screen).toBe("playing");
  });

  it("ends the run kept for the end screens, and leaves unlisted rows inert", () => {
    const { debug } = playing();
    debug.setKills(3);
    debug.setScreen("fallen");
    expect(debug.snapshot().screen).toBe("fallen");
    expect(debug.snapshot().run.kills).toBe(3);
    debug.setScreen("chest");
    expect(debug.snapshot().screen).toBe("fallen");
    debug.setScreen("levelup");
    expect(debug.snapshot().screen).toBe("fallen");
    debug.setScreen("paused");
    expect(debug.snapshot().screen).toBe("fallen");
    debug.setScreen("title");
    expect(debug.snapshot().run.kills).toBe(0);
    debug.setScreen("howto");
    expect(debug.snapshot().screen).toBe("howto");
    debug.setScreen("playing");
    debug.setScreen("dawn");
    expect(debug.snapshot().screen).toBe("dawn");
    expect(() => debug.setScreen("nowhere" as never)).toThrow();
    expect(h.cues).toEqual([]);
  });
});

describe("the clock", () => {
  it("advances one tick per frame on playing and frames alone elsewhere", async () => {
    await h.step(3);
    expect(h.debug.snapshot().run.tick).toBe(0);
    expect(h.debug.snapshot().simTime).toBeCloseTo(3 * TICK_DT, 12);
    h.debug.setScreen("playing");
    h.debug.setSpawning(false);
    await h.step(30);
    expect(h.debug.snapshot().run.tick).toBe(30);
    expect(h.debug.snapshot().accumulator).toBeCloseTo(0, 9);
  });

  it("setTick and setSpawnTimer pose the clock alone", async () => {
    const { debug } = playing();
    debug.spawnEnemy("moth", 100, 0);
    debug.setTick(35999);
    debug.setSpawnTimer(2);
    const snap = debug.snapshot();
    expect(snap.run.tick).toBe(35999);
    expect(snap.run.spawnTimer).toBe(2);
    expect(snap.run.enemies).toHaveLength(1);
    expect(() => debug.setTick(DAWN_TIME * TICK_HZ)).toThrow();
    expect(() => debug.setTick(-1)).toThrow();
    expect(() => debug.setSpawnTimer(-0.1)).toThrow();
    await h.step(1);
    expect(debug.snapshot().screen).toBe("dawn");
    expect(h.cues).toContain("dawn");
  });
});

describe("the lamplighter and progression poses", () => {
  it("set the fields and check their domains", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setPlayerPosition(10, -20);
    debug.setFacing("left");
    debug.setHp(12.5);
    debug.setLevel(7);
    debug.setXp(3.5);
    debug.setKills(9);
    debug.setPendingLevelUps(2);
    debug.setNextOffers(["ember", "lure"]);
    const snap = debug.snapshot();
    expect(snap.run.player).toEqual({
      x: 10,
      y: -20,
      facing: "left",
      hp: 12.5,
    });
    expect(snap.run.level).toBe(7);
    expect(snap.run.xp).toBe(3.5);
    expect(snap.run.kills).toBe(9);
    expect(snap.run.pendingLevelUps).toBe(2);
    expect(snap.run.nextOffers).toEqual(["ember", "lure"]);
    expect(() => debug.setFacing("up" as never)).toThrow();
    expect(() => debug.setHp(101)).toThrow();
    expect(() => debug.setLevel(0)).toThrow();
    expect(() => debug.setXp(-1)).toThrow();
    expect(() => debug.setKills(1.5)).toThrow();
    expect(() => debug.setPendingLevelUps(-1)).toThrow();
    expect(() => debug.setNextOffers([])).toThrow();
    expect(() => debug.setNextOffers(["ember", "ember"])).toThrow();
    expect(() => debug.setNextOffers(["a", "b", "c", "d"] as never)).toThrow();
    expect(() => debug.setNextOffers(["sword"] as never)).toThrow();
    debug.setPendingLevelUps(0);
    debug.setHp(-5);
    await h.step(1);
    expect(debug.snapshot().screen).toBe("fallen");
  });

  it("is inert off a run screen", () => {
    const { debug } = h;
    debug.setPlayerPosition(10, 10);
    debug.setLevel(5);
    debug.spawnEnemy("moth", 0, 0);
    debug.spawnGem("small", 0, 0);
    expect(debug.snapshot().run.player.x).toBe(0);
    expect(debug.snapshot().run.level).toBe(1);
    expect(debug.snapshot().run.enemies).toEqual([]);
    expect(debug.snapshot().run.gems).toEqual([]);
  });

  it("accepts nextOffers on levelup for the queued overlay", () => {
    const { debug } = playing();
    debug.setPendingLevelUps(2);
    debug.setScreen("levelup");
    debug.setNextOffers(["lure"]);
    debug.choose(0);
    expect(debug.snapshot().screen).toBe("levelup");
    expect(debug.snapshot().run.offers).toEqual(["lure"]);
    debug.choose(5);
    expect(debug.snapshot().screen).toBe("levelup");
    expect(() => debug.choose(-1)).toThrow();
    expect(h.cues).toEqual([]);
  });

  it("discards a queued list that is no longer in the pool", () => {
    const { debug } = playing();
    debug.setWeapon(0, "taper", 8);
    debug.setNextOffers(["taper"]);
    debug.setPendingLevelUps(1);
    debug.setScreen("levelup");
    const snap = debug.snapshot();
    expect(snap.run.offers).not.toContain("taper");
    expect(snap.run.offers).toHaveLength(3);
    expect(snap.run.nextOffers).toBeNull();
  });
});

describe("the loadout poses", () => {
  it("appends, replaces, and keeps or zeroes the timer", () => {
    const { debug } = playing();
    debug.setWeaponCooldown(0, 0.5);
    debug.setWeapon(0, "taper", 4);
    expect(debug.snapshot().run.weapons[0]).toEqual({
      id: "taper",
      level: 4,
      cooldown: 0.5,
    });
    debug.setWeapon(0, "ember", 2);
    expect(debug.snapshot().run.weapons[0]).toEqual({
      id: "ember",
      level: 2,
      cooldown: 0,
    });
    debug.setWeapon(1, "pyre", 1);
    expect(debug.snapshot().run.weapons).toHaveLength(2);
    expect(() => debug.setWeapon(3, "pin", 1)).toThrow();
    expect(() => debug.setWeapon(2, "ember", 1)).toThrow();
    expect(() => debug.setWeapon(2, "beacon", 1)).toThrow();
    expect(() => debug.setWeapon(2, "taper", 1)).toThrow();
    expect(() => debug.setWeapon(2, "pin", 9)).toThrow();
    expect(() => debug.setWeapon(2, "hail", 2)).toThrow();
    expect(() => debug.setWeapon(2, "sword" as never, 1)).toThrow();
    debug.removeWeapon(0);
    expect(debug.snapshot().run.weapons).toEqual([
      { id: "pyre", level: 1, cooldown: 0 },
    ]);
    expect(() => debug.removeWeapon(1)).toThrow();
    expect(() => debug.setWeaponCooldown(0, -1)).toThrow();
  });

  it("holds six weapons at most", () => {
    const { debug } = playing();
    for (const [i, id] of (
      ["ember", "pin", "lantern", "halo", "flare"] as const
    ).entries()) {
      debug.setWeapon(i + 1, id, 1);
    }
    expect(debug.snapshot().run.weapons).toHaveLength(6);
    expect(() => debug.setWeapon(6, "spark", 1)).toThrow();
  });

  it("places passives, leaving hp, and removes them", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setPassive(0, "tallow", 3);
    expect(debug.snapshot().run.player.hp).toBe(100);
    expect(debug.snapshot().run.maxHp).toBe(145);
    debug.setPassive(0, "tallow", 5);
    debug.setPassive(1, "brass", 3);
    expect(() => debug.setPassive(2, "brass", 1)).toThrow();
    expect(() => debug.setPassive(1, "brass", 4)).toThrow();
    expect(() => debug.setPassive(1, "wick", 0)).toThrow();
    expect(() => debug.setPassive(1, "lantern" as never, 1)).toThrow();
    expect(() => debug.setPassive(3, "wick", 1)).toThrow();
    debug.setHp(160);
    debug.removePassive(0);
    expect(debug.snapshot().run.passives).toEqual([{ id: "brass", level: 3 }]);
    expect(debug.snapshot().run.player.hp).toBe(160);
    await h.step(1);
    expect(debug.snapshot().run.player.hp).toBe(100);
  });

  it("creates the aura and the Chandelier set on the next playing tick", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setWeapon(1, "halo", 1);
    debug.setWeapon(2, "chandelier", 1);
    expect(debug.snapshot().run.zones).toEqual([]);
    await h.step(1);
    const { zones } = debug.snapshot().run;
    expect(zones.filter((zone) => zone.kind === "aura")).toHaveLength(1);
    expect(zones.filter((zone) => zone.weapon === "chandelier")).toHaveLength(
      4,
    );
    debug.clearZones();
    expect(debug.snapshot().run.zones).toEqual([]);
    await h.step(1);
    expect(debug.snapshot().run.zones).toHaveLength(5);
  });
});

describe("the enemy poses", () => {
  it("spawns through the real path and poses each field", () => {
    const { debug } = playing();
    debug.setTick(3600);
    debug.spawnEnemy("moth", 30, 40);
    debug.spawnEnemy("owl", 0, 0);
    const [moth, owl] = debug.snapshot().run.enemies;
    expect(moth).toMatchObject({ id: 0, type: "moth", x: 30, y: 40, age: 0 });
    expect(moth.maxHp).toBeCloseTo(5 * 1.15);
    expect(moth.hp).toBe(moth.maxHp);
    expect(moth.heading.x).toBeCloseTo(-0.6);
    expect(moth.heading.y).toBeCloseTo(-0.8);
    expect(owl.maxHp).toBe(2000);
    expect(owl.heading).toEqual({ x: 1, y: 0 });
    expect(debug.snapshot().run.aliveCommons).toBe(1);
    debug.setEnemyPosition(0, -5, 5);
    debug.setEnemyHp(0, 2);
    debug.setEnemyHeading(0, 0, 3);
    debug.setEnemyAge(0, 1.5);
    debug.setEnemyContactCooldown(0, 0.25);
    expect(debug.snapshot().run.enemies[0]).toMatchObject({
      x: -5,
      y: 5,
      hp: 2,
      heading: { x: 0, y: 1 },
      age: 1.5,
      contactCooldown: 0.25,
    });
    expect(() => debug.setEnemyHp(0, 0)).toThrow();
    expect(() => debug.setEnemyHp(0, 100)).toThrow();
    expect(() => debug.setEnemyHeading(0, 0, 0)).toThrow();
    expect(() => debug.setEnemyAge(0, -1)).toThrow();
    expect(() => debug.setEnemyPosition(7, 0, 0)).toThrow();
    expect(() => debug.spawnEnemy("dragon" as never, 0, 0)).toThrow();
    debug.removeEnemy(0);
    expect(debug.snapshot().run.enemies.map((enemy) => enemy.id)).toEqual([1]);
    expect(debug.snapshot().run.kills).toBe(0);
    debug.clearEnemies();
    expect(debug.snapshot().run.enemies).toEqual([]);
    expect(debug.snapshot().run.nextId).toBe(2);
    expect(h.cues).toEqual([]);
  });

  it("spawns on paused as well", () => {
    const { debug } = playing();
    debug.setScreen("paused");
    debug.spawnEnemy("bat", 10, 0);
    expect(debug.snapshot().run.enemies).toHaveLength(1);
  });
});

describe("the effect, gem, and pickup poses", () => {
  it("makes projectiles and puddles from the table rows", () => {
    const { debug } = playing();
    debug.setPassive(0, "glass", 2);
    debug.setPassive(1, "wick", 1);
    debug.spawnProjectile("ember", 1, 2, 100, 0, 0);
    debug.setWeapon(1, "pin", 8);
    debug.spawnProjectile("pin", 0, 0, 0, 0, -1);
    debug.spawnProjectile("sconce", 0, 0, 600, 0, -1);
    debug.spawnPuddle("oil-splash", 5, 5);
    debug.spawnPuddle("blaze", 5, 5);
    const { projectiles, zones } = debug.snapshot().run;
    expect(projectiles[0]).toMatchObject({
      weapon: "ember",
      x: 1,
      y: 2,
      vx: 100,
      vy: 0,
      ax: 0,
      ay: 0,
      ttl: 2,
      pierce: 0,
      hits: [],
    });
    expect(projectiles[0].radius).toBeCloseTo(8 * 1.2);
    expect(projectiles[0].damage).toBeCloseTo(11);
    expect(projectiles[1].radius).toBeCloseTo(7 * 1.2);
    expect(projectiles[1].damage).toBeCloseTo(16.5);
    expect(projectiles[2].ax).toBeCloseTo(-600);
    expect(projectiles[2].ay).toBe(0);
    expect(zones[0]).toMatchObject({
      kind: "puddle",
      weapon: "oil-splash",
      ttl: 2.5,
    });
    expect(zones[0].radius).toBeCloseTo(60);
    expect(zones[1]).toMatchObject({ weapon: "blaze", ttl: 4 });
    expect(zones[1].radius).toBeCloseTo(84);
    expect(() => debug.spawnProjectile("sconce", 0, 0, 0, 0, 0)).toThrow();
    expect(() =>
      debug.spawnProjectile("taper" as never, 0, 0, 1, 0, 0),
    ).toThrow();
    expect(() => debug.spawnProjectile("ember", 0, 0, 1, 0, -2)).toThrow();
    expect(() => debug.spawnPuddle("halo" as never, 0, 0)).toThrow();
    debug.clearProjectiles();
    debug.clearZones();
    expect(debug.snapshot().run.projectiles).toEqual([]);
    expect(debug.snapshot().run.zones).toEqual([]);
  });

  it("integrates a posed projectile from the next tick and expires it", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.spawnProjectile("sconce", 0, 0, 600, 0, -1);
    await h.step(1);
    let [sconce] = debug.snapshot().run.projectiles;
    expect(sconce.x).toBeCloseTo(10);
    expect(sconce.vx).toBeCloseTo(590);
    expect(sconce.ttl).toBeCloseTo(2.5 - TICK_DT);
    debug.setEffectMotion(false);
    await h.step(1);
    [sconce] = debug.snapshot().run.projectiles;
    expect(sconce.x).toBeCloseTo(10);
    expect(sconce.ttl).toBeCloseTo(2.5 - 2 * TICK_DT);
    await h.step(148);
    expect(debug.snapshot().run.projectiles).toEqual([]);
  });

  it("places gems and pickups and clears them without effect", () => {
    const { debug } = playing();
    debug.spawnGem("large", 200, 0);
    debug.setGemAttracted(0, true);
    debug.spawnPickup("bread", 300, 0);
    expect(debug.snapshot().run.gems).toEqual([
      { id: 0, tier: "large", x: 200, y: 0, attracted: true },
    ]);
    expect(debug.snapshot().run.pickups).toEqual([
      { id: 1, kind: "bread", x: 300, y: 0 },
    ]);
    expect(() => debug.setGemAttracted(1, true)).toThrow();
    expect(() => debug.spawnGem("huge" as never, 0, 0)).toThrow();
    expect(() => debug.spawnPickup("gold" as never, 0, 0)).toThrow();
    debug.clearGems();
    debug.clearPickups();
    expect(debug.snapshot().run.gems).toEqual([]);
    expect(debug.snapshot().run.pickups).toEqual([]);
    expect(debug.snapshot().run.xp).toBe(0);
    expect(debug.snapshot().run.nextId).toBe(2);
  });

  it("collects a posed gem and a posed chest through the real path", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setWeapon(0, "taper", 8);
    debug.setPassive(0, "wick", 1);
    debug.spawnGem("medium", 0, 0);
    debug.spawnPickup("chest", 0, 0);
    await h.step(1);
    const snap = debug.snapshot();
    expect(snap.screen).toBe("chest");
    expect(snap.run.xp).toBe(3);
    expect(snap.run.chestResult).toEqual({ kind: "evolve", weapon: "pyre" });
    expect(snap.run.weapons[0]).toEqual({ id: "pyre", level: 1, cooldown: 0 });
    expect(h.cues).toContain("evolve");
    expect(h.cues).toContain("chest");
  });
});

describe("the switches", () => {
  it("each set its own field on any screen and nothing else", () => {
    const { debug } = h;
    debug.setEnemyMotion(false);
    debug.setEnemyContact(false);
    debug.setEvents(false);
    debug.setDespawning(false);
    debug.setEffectMotion(false);
    const snap = debug.snapshot();
    expect(snap.enemyMotion).toBe(false);
    expect(snap.enemyContact).toBe(false);
    expect(snap.events).toBe(false);
    expect(snap.despawning).toBe(false);
    expect(snap.effectMotion).toBe(false);
    expect(snap.spawning).toBe(true);
    expect(snap.weaponFire).toBe(true);
    expect(() => debug.setSpawning("no" as never)).toThrow();
  });

  it("hold their faculties: no spawn, no motion, no fire while off", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setEnemyMotion(false);
    debug.setWeaponFire(false);
    debug.spawnEnemy("moth", 100, 0);
    await h.step(60);
    const snap = debug.snapshot();
    expect(snap.run.enemies).toHaveLength(1);
    expect(snap.run.enemies[0].x).toBe(100);
    expect(snap.run.enemies[0].age).toBeCloseTo(1, 9);
    expect(snap.run.zones).toEqual([]);
    expect(snap.run.weapons[0].cooldown).toBe(0);
  });
});
