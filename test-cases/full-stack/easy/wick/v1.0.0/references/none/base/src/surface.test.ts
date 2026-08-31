import { describe, expect, it } from "vitest";
import { DAWN_TICK, TICK_DT } from "./constants";
import { Game } from "./game";
import { createApi, type Clock, type WickDebugApi } from "./surface";

/** A clock that runs frames the way the runtime does, without a canvas. */
function build(): {
  api: WickDebugApi;
  game: Game;
  clock: Clock & { auto: boolean };
} {
  const mute = { on: false };
  const game = new Game({
    toggleMute: () => {
      mute.on = !mute.on;
    },
    isMuted: () => mute.on,
  });
  const clock = {
    auto: true,
    setAutoStep(auto: boolean) {
      this.auto = auto;
      game.autoStep = auto;
    },
    step(ticks: number) {
      for (let i = 0; i < ticks; i += 1) {
        game.state.simTime += TICK_DT;
        game.tickOnce();
        game.drainCues();
      }
    },
    advance(seconds: number) {
      game.state.simTime += seconds;
      game.update(seconds);
      game.drainCues();
    },
  };
  return { api: createApi(game, clock), game, clock };
}

function playing(): ReturnType<typeof build> {
  const built = build();
  built.api.setScreen("playing");
  return built;
}

describe("the snapshot", () => {
  it("carries every field on every screen", () => {
    const { api } = build();
    const snap = api.snapshot();
    expect(snap.version).toBe(1);
    expect(snap.screen).toBe("title");
    expect(snap.autoStep).toBe(true);
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
  });

  it("is a copy, and reports the pool on levelup alone", () => {
    const { api, game } = playing();
    const snap = api.snapshot();
    snap.run.player.x = 99;
    expect(game.state.run.player.x).toBe(0);
    api.setPendingLevelUps(1);
    api.setScreen("levelup");
    const onOverlay = api.snapshot();
    expect(onOverlay.run.pool.length).toBeGreaterThan(3);
    for (const id of onOverlay.run.offers) {
      expect(onOverlay.run.pool).toContain(id);
    }
    api.choose(0);
    expect(api.snapshot().run.pool).toEqual([]);
  });

  it("derives time, xpToNext, and the stats from the passives", () => {
    const { api } = playing();
    api.setTick(1800);
    api.setLevel(4);
    api.setPassive(0, "tallow", 2);
    api.setPassive(1, "brass", 1);
    api.setPassive(2, "bellows", 1);
    api.setPassive(3, "lure", 2);
    const snap = api.snapshot();
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
  it("restores the title state, the switches, and the seed, keeping autoStep and muted", () => {
    const { api, game } = playing();
    api.setSpawning(false);
    api.setAutoStep(false);
    api.step(5);
    game.state.muted = true;
    api.reset({ seed: 7 });
    const snap = api.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.spawning).toBe(true);
    expect(snap.rngState).toBe(7);
    expect(snap.simTime).toBe(0);
    expect(snap.autoStep).toBe(false);
    expect(snap.run.tick).toBe(0);
    api.reset();
    expect(api.snapshot().rngState).toBe(1);
  });
});

describe("setScreen", () => {
  it("begins a fresh run from title, keeping rng and simTime and the switches", () => {
    const { api, game } = build();
    api.setWeaponFire(false);
    game.state.simTime = 3;
    game.rng.next();
    const rng = game.state.rngState;
    api.setScreen("playing");
    const snap = api.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.run.weapons).toEqual([{ id: "taper", level: 1, cooldown: 0 }]);
    expect(snap.simTime).toBe(3);
    expect(snap.rngState).toBe(rng);
    expect(snap.weaponFire).toBe(false);
  });

  it("resumes from paused, closes the chest, and is inert on levelup", () => {
    const { api } = playing();
    api.setTick(10);
    api.setScreen("paused");
    expect(api.snapshot().screen).toBe("paused");
    api.setScreen("playing");
    expect(api.snapshot().run.tick).toBe(10);
    api.spawnPickup("chest", 0, 0);
    api.step(1);
    expect(api.snapshot().screen).toBe("chest");
    expect(api.snapshot().run.chestResult).toEqual({
      kind: "level",
      item: "taper",
      level: 2,
    });
    api.setScreen("playing");
    expect(api.snapshot().screen).toBe("playing");
    expect(api.snapshot().run.chestResult).toBeNull();
    expect(api.snapshot().run.tick).toBe(11);
    api.setPendingLevelUps(1);
    api.setScreen("levelup");
    expect(api.snapshot().screen).toBe("levelup");
    api.setScreen("playing");
    expect(api.snapshot().screen).toBe("levelup");
    api.choose(0);
    expect(api.snapshot().screen).toBe("playing");
  });

  it("needs a pending level-up to open the overlay", () => {
    const { api } = playing();
    api.setScreen("levelup");
    expect(api.snapshot().screen).toBe("playing");
  });

  it("ends the run kept for the end screens, and leaves unlisted rows inert", () => {
    const { api } = playing();
    api.setKills(3);
    api.setScreen("fallen");
    expect(api.snapshot().screen).toBe("fallen");
    expect(api.snapshot().run.kills).toBe(3);
    api.setScreen("chest");
    expect(api.snapshot().screen).toBe("fallen");
    api.setScreen("levelup");
    expect(api.snapshot().screen).toBe("fallen");
    api.setScreen("paused");
    expect(api.snapshot().screen).toBe("fallen");
    api.setScreen("title");
    expect(api.snapshot().run.kills).toBe(0);
    api.setScreen("howto");
    expect(api.snapshot().screen).toBe("howto");
    api.setScreen("playing");
    api.setScreen("dawn");
    expect(api.snapshot().screen).toBe("dawn");
    expect(() => api.setScreen("nowhere" as never)).toThrow();
  });
});

describe("the clock", () => {
  it("step runs whole ticks on playing and frames elsewhere", () => {
    const { api } = build();
    api.step(3);
    expect(api.snapshot().run.tick).toBe(0);
    expect(api.snapshot().simTime).toBeCloseTo(3 * TICK_DT, 12);
    api.setScreen("playing");
    api.step(30);
    expect(api.snapshot().run.tick).toBe(30);
    api.step();
    expect(api.snapshot().run.tick).toBe(31);
    expect(() => api.step(0)).toThrow();
    expect(() => api.step(1.5)).toThrow();
  });

  it("advance feeds the accumulator and keeps the remainder", () => {
    const { api } = playing();
    api.advance(0.04);
    expect(api.snapshot().run.tick).toBe(2);
    expect(api.snapshot().accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 12);
    expect(() => api.advance(0)).toThrow();
    expect(() => api.advance(-1)).toThrow();
  });

  it("setTick and setSpawnTimer pose the clock alone", () => {
    const { api } = playing();
    api.spawnEnemy("moth", 100, 0);
    api.setTick(35999);
    api.setSpawnTimer(2);
    const snap = api.snapshot();
    expect(snap.run.tick).toBe(35999);
    expect(snap.run.spawnTimer).toBe(2);
    expect(snap.run.enemies).toHaveLength(1);
    expect(() => api.setTick(DAWN_TICK)).toThrow();
    expect(() => api.setTick(-1)).toThrow();
    expect(() => api.setSpawnTimer(-0.1)).toThrow();
    api.step(1);
    expect(api.snapshot().screen).toBe("dawn");
  });
});

describe("the lamplighter and progression poses", () => {
  it("set the fields and check their domains", () => {
    const { api } = playing();
    api.setPlayerPosition(10, -20);
    api.setFacing("left");
    api.setHp(12.5);
    api.setLevel(7);
    api.setXp(3.5);
    api.setKills(9);
    api.setPendingLevelUps(2);
    api.setNextOffers(["ember", "lure"]);
    const snap = api.snapshot();
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
    expect(() => api.setFacing("up" as never)).toThrow();
    expect(() => api.setHp(101)).toThrow();
    expect(() => api.setLevel(0)).toThrow();
    expect(() => api.setXp(-1)).toThrow();
    expect(() => api.setKills(1.5)).toThrow();
    expect(() => api.setPendingLevelUps(-1)).toThrow();
    expect(() => api.setNextOffers([])).toThrow();
    expect(() => api.setNextOffers(["ember", "ember"])).toThrow();
    expect(() => api.setNextOffers(["pyre"])).toThrow();
    expect(() => api.setNextOffers(["a", "b", "c", "d"] as never)).toThrow();
    api.setHp(-5);
    api.step(1);
    expect(api.snapshot().screen).toBe("fallen");
  });

  it("is inert off a run screen", () => {
    const { api } = build();
    api.setPlayerPosition(10, 10);
    api.setLevel(5);
    api.spawnEnemy("moth", 0, 0);
    api.spawnGem("small", 0, 0);
    expect(api.snapshot().run.player.x).toBe(0);
    expect(api.snapshot().run.level).toBe(1);
    expect(api.snapshot().run.enemies).toEqual([]);
    expect(api.snapshot().run.gems).toEqual([]);
  });

  it("accepts nextOffers on levelup for the queued overlay", () => {
    const { api } = playing();
    api.setPendingLevelUps(2);
    api.setScreen("levelup");
    api.setNextOffers(["lure"]);
    api.choose(0);
    expect(api.snapshot().screen).toBe("levelup");
    expect(api.snapshot().run.offers).toEqual(["lure"]);
    api.choose(5);
    expect(api.snapshot().screen).toBe("levelup");
    expect(() => api.choose(-1)).toThrow();
  });
});

describe("the loadout poses", () => {
  it("appends, replaces, and keeps or zeroes the timer", () => {
    const { api } = playing();
    api.setWeaponCooldown(0, 0.5);
    api.setWeapon(0, "taper", 4);
    expect(api.snapshot().run.weapons[0]).toEqual({
      id: "taper",
      level: 4,
      cooldown: 0.5,
    });
    api.setWeapon(0, "ember", 2);
    expect(api.snapshot().run.weapons[0]).toEqual({
      id: "ember",
      level: 2,
      cooldown: 0,
    });
    api.setWeapon(1, "pyre", 1);
    expect(api.snapshot().run.weapons).toHaveLength(2);
    expect(() => api.setWeapon(3, "pin", 1)).toThrow();
    expect(() => api.setWeapon(2, "ember", 1)).toThrow();
    expect(() => api.setWeapon(2, "beacon", 1)).toThrow();
    expect(() => api.setWeapon(2, "taper", 1)).toThrow();
    expect(() => api.setWeapon(2, "pin", 9)).toThrow();
    expect(() => api.setWeapon(2, "hail", 2)).toThrow();
    expect(() => api.setWeapon(2, "sword", 1)).toThrow();
    api.removeWeapon(0);
    expect(api.snapshot().run.weapons).toEqual([
      { id: "pyre", level: 1, cooldown: 0 },
    ]);
    expect(() => api.removeWeapon(1)).toThrow();
    expect(() => api.setWeaponCooldown(0, -1)).toThrow();
  });

  it("holds six weapons at most", () => {
    const { api } = playing();
    for (const [i, id] of [
      "ember",
      "pin",
      "lantern",
      "halo",
      "flare",
    ].entries()) {
      api.setWeapon(i + 1, id, 1);
    }
    expect(api.snapshot().run.weapons).toHaveLength(6);
    expect(() => api.setWeapon(6, "spark", 1)).toThrow();
  });

  it("places passives, leaving hp, and removes them", () => {
    const { api } = playing();
    api.setPassive(0, "tallow", 3);
    expect(api.snapshot().run.player.hp).toBe(100);
    expect(api.snapshot().run.maxHp).toBe(145);
    api.setPassive(0, "tallow", 5);
    api.setPassive(1, "brass", 3);
    expect(() => api.setPassive(2, "brass", 1)).toThrow();
    expect(() => api.setPassive(1, "brass", 4)).toThrow();
    expect(() => api.setPassive(1, "wick", 0)).toThrow();
    expect(() => api.setPassive(1, "lantern", 1)).toThrow();
    expect(() => api.setPassive(3, "wick", 1)).toThrow();
    api.setHp(160);
    api.removePassive(0);
    expect(api.snapshot().run.passives).toEqual([{ id: "brass", level: 3 }]);
    expect(api.snapshot().run.player.hp).toBe(160);
    api.step(1);
    expect(api.snapshot().run.player.hp).toBe(100);
  });
});

describe("the enemy poses", () => {
  it("spawns through the real path and poses each field", () => {
    const { api } = playing();
    api.setTick(3600);
    api.spawnEnemy("moth", 30, 40);
    api.spawnEnemy("owl", 0, 0);
    const [moth, owl] = api.snapshot().run.enemies;
    expect(moth).toMatchObject({ id: 0, type: "moth", x: 30, y: 40, age: 0 });
    expect(moth.maxHp).toBeCloseTo(5 * 1.15);
    expect(moth.hp).toBe(moth.maxHp);
    expect(moth.heading.x).toBeCloseTo(-0.6);
    expect(moth.heading.y).toBeCloseTo(-0.8);
    expect(owl.maxHp).toBe(2000);
    expect(owl.heading).toEqual({ x: 1, y: 0 });
    expect(api.snapshot().run.aliveCommons).toBe(1);
    api.setEnemyPosition(0, -5, 5);
    api.setEnemyHp(0, 2);
    api.setEnemyHeading(0, 0, 3);
    api.setEnemyAge(0, 1.5);
    api.setEnemyContactCooldown(0, 0.25);
    expect(api.snapshot().run.enemies[0]).toMatchObject({
      x: -5,
      y: 5,
      hp: 2,
      heading: { x: 0, y: 1 },
      age: 1.5,
      contactCooldown: 0.25,
    });
    expect(() => api.setEnemyHp(0, 0)).toThrow();
    expect(() => api.setEnemyHp(0, 100)).toThrow();
    expect(() => api.setEnemyHeading(0, 0, 0)).toThrow();
    expect(() => api.setEnemyAge(0, -1)).toThrow();
    expect(() => api.setEnemyPosition(7, 0, 0)).toThrow();
    expect(() => api.spawnEnemy("dragon", 0, 0)).toThrow();
    api.removeEnemy(0);
    expect(api.snapshot().run.enemies.map((enemy) => enemy.id)).toEqual([1]);
    expect(api.snapshot().run.kills).toBe(0);
    api.clearEnemies();
    expect(api.snapshot().run.enemies).toEqual([]);
    expect(api.snapshot().run.nextId).toBe(2);
  });

  it("spawns on paused as well", () => {
    const { api } = playing();
    api.setScreen("paused");
    api.spawnEnemy("bat", 10, 0);
    expect(api.snapshot().run.enemies).toHaveLength(1);
  });
});

describe("the effect, gem, and pickup poses", () => {
  it("makes projectiles and puddles from the table rows", () => {
    const { api } = playing();
    api.setPassive(0, "glass", 2);
    api.setPassive(1, "wick", 1);
    api.spawnProjectile("ember", 1, 2, 100, 0, 0);
    api.setWeapon(1, "pin", 8);
    api.spawnProjectile("pin", 0, 0, 0, 0, -1);
    api.spawnProjectile("sconce", 0, 0, 600, 0, -1);
    api.spawnPuddle("oil-splash", 5, 5);
    api.spawnPuddle("blaze", 5, 5);
    const { projectiles, zones } = api.snapshot().run;
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
    expect(() => api.spawnProjectile("sconce", 0, 0, 0, 0, 0)).toThrow();
    expect(() => api.spawnProjectile("taper", 0, 0, 1, 0, 0)).toThrow();
    expect(() => api.spawnProjectile("ember", 0, 0, 1, 0, -2)).toThrow();
    expect(() => api.spawnPuddle("halo", 0, 0)).toThrow();
    api.clearProjectiles();
    api.clearZones();
    expect(api.snapshot().run.projectiles).toEqual([]);
    expect(api.snapshot().run.zones).toEqual([]);
  });

  it("integrates a posed projectile from the next tick and expires it", () => {
    const { api } = playing();
    api.spawnProjectile("sconce", 0, 0, 600, 0, -1);
    api.step(1);
    let [sconce] = api.snapshot().run.projectiles;
    expect(sconce.x).toBeCloseTo(10);
    expect(sconce.vx).toBeCloseTo(590);
    expect(sconce.ttl).toBeCloseTo(2.5 - TICK_DT);
    api.setEffectMotion(false);
    api.step(1);
    [sconce] = api.snapshot().run.projectiles;
    expect(sconce.x).toBeCloseTo(10);
    expect(sconce.ttl).toBeCloseTo(2.5 - 2 * TICK_DT);
    api.step(148);
    expect(api.snapshot().run.projectiles).toEqual([]);
  });

  it("places gems and pickups and clears them without effect", () => {
    const { api } = playing();
    api.spawnGem("large", 200, 0);
    api.setGemAttracted(0, true);
    api.spawnPickup("bread", 300, 0);
    expect(api.snapshot().run.gems).toEqual([
      { id: 0, tier: "large", x: 200, y: 0, attracted: true },
    ]);
    expect(api.snapshot().run.pickups).toEqual([
      { id: 1, kind: "bread", x: 300, y: 0 },
    ]);
    expect(() => api.setGemAttracted(1, true)).toThrow();
    expect(() => api.spawnGem("huge", 0, 0)).toThrow();
    expect(() => api.spawnPickup("gold", 0, 0)).toThrow();
    api.clearGems();
    api.clearPickups();
    expect(api.snapshot().run.gems).toEqual([]);
    expect(api.snapshot().run.pickups).toEqual([]);
    expect(api.snapshot().run.xp).toBe(0);
    expect(api.snapshot().run.nextId).toBe(2);
  });
});

describe("the switches", () => {
  it("each set its own field on any screen and nothing else", () => {
    const { api } = build();
    api.setEnemyMotion(false);
    api.setEnemyContact(false);
    api.setEvents(false);
    api.setDespawning(false);
    api.setEffectMotion(false);
    const snap = api.snapshot();
    expect(snap.enemyMotion).toBe(false);
    expect(snap.enemyContact).toBe(false);
    expect(snap.events).toBe(false);
    expect(snap.despawning).toBe(false);
    expect(snap.effectMotion).toBe(false);
    expect(snap.spawning).toBe(true);
    expect(snap.weaponFire).toBe(true);
    expect(() => api.setSpawning("no" as never)).toThrow();
  });
});

describe("poses sound nothing", () => {
  it("raises no cue for a pose that a tick would sound", () => {
    const { api, game } = playing();
    api.setPendingLevelUps(1);
    api.setScreen("levelup");
    expect(game.drainCues()).toEqual([]);
    api.choose(0);
    expect(game.drainCues()).toEqual([]);
    api.setScreen("fallen");
    expect(game.drainCues()).toEqual([]);
  });
});
