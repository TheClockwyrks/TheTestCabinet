// The debug surface of specs/instrumentation.md, driven exactly as a caller
// drives it: through `engine.debug` on a real engine, with `engine.advance`
// running the ticks between poses. Each pose is posed and read back, the
// domains throw, the no-op cases the specification fixes change nothing, and
// no pose sounds a cue.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  DAWN_TIME,
  END_ITEMS,
  PASSIVE_IDS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  TICK_DT,
  TICK_HZ,
  TITLE_ITEMS,
} from "./constants";
import { createHarness, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * A run on `playing`, composed the way `specs/instrumentation.md` says a fresh
 * run is: `setScreen("playing")` sets the screen alone, and `setWeapon` puts
 * Taper at level 1 in the first slot with its timer at 0.
 */
function playing(): Harness {
  h.debug.setScreen("playing");
  h.debug.setWeapon(0, "taper", 1);
  return h;
}

describe("the snapshot", () => {
  it("carries every field on every screen", () => {
    const snap = h.debug.snapshot();
    expect(snap.version).toBe(1);
    expect(snap.screen).toBe("title");
    expect(snap.menuIndex).toBe(0);
    expect(snap.almanacTab).toBe(0);
    expect(snap.almanacScroll).toBe(0);
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
      hurtFlash: 0,
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
      nextSpawnAngle: null,
      nextSwarmAngle: null,
      nextPuddleOffset: null,
      nextStrikeTarget: null,
      nextChestItem: null,
      nextDrop: null,
    });
    expect(snap.muted).toBe(false);
    expect(snap.accumulator).toBe(0);
    expect(snap.simTime).toBe(0);
    expect("autoStep" in snap).toBe(false);
  });

  it("is a copy, and reports the pool on levelup alone", async () => {
    const { debug } = playing();
    const snap = debug.snapshot();
    snap.run.player.x = 99;
    expect(h.state.run.player.x).toBe(0);
    debug.setPendingLevelUps(1);
    await h.step(1);
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
  it("restores the title state and the switches, keeping muted", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setNextDrop("bread");
    await h.step(5);
    h.engine.world.audio.setMuted(true);
    await h.step(1);
    debug.reset();
    const snap = debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.spawning).toBe(true);
    expect(snap.run.nextDrop).toBeNull();
    expect(snap.simTime).toBe(0);
    expect(snap.run.tick).toBe(0);
    expect(snap.muted).toBe(true);
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
  it("shows a screen and begins no run, keeping rng, simTime, and the switches", async () => {
    const { debug } = h;
    debug.setWeaponFire(false);
    await h.step(3);
    const before = debug.snapshot();
    expect(before.simTime).toBeCloseTo(3 * TICK_DT, 12);
    debug.setScreen("playing");
    const snap = debug.snapshot();
    expect(snap.screen).toBe("playing");
    // The pose installs nothing: a fresh run's Taper is `setWeapon`'s.
    expect(snap.run.weapons).toEqual([]);
    expect(snap.run).toEqual(before.run);
    expect(snap.simTime).toBe(before.simTime);
    expect(snap.weaponFire).toBe(false);
    expect(h.cues).toEqual([]);
  });

  it("leaves the run, the chest result, and the overlay's offers standing", async () => {
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
    const result = debug.snapshot().run.chestResult;
    expect(result).toEqual({ kind: "level", item: "taper", level: 2 });
    debug.setScreen("playing");
    expect(debug.snapshot().screen).toBe("playing");
    // Clearing it is `confirm`'s, not the pose's.
    expect(debug.snapshot().run.chestResult).toEqual(result);
    expect(debug.snapshot().run.tick).toBe(11);
    debug.setPendingLevelUps(1);
    await h.step(1);
    expect(debug.snapshot().screen).toBe("levelup");
    const offers = debug.snapshot().run.offers;
    debug.setScreen("playing");
    expect(debug.snapshot().screen).toBe("playing");
    expect(debug.snapshot().run.offers).toEqual(offers);
    expect(debug.snapshot().run.pendingLevelUps).toBe(1);
  });

  it("reaches levelup with nothing queued, and draws no offers there", () => {
    const { debug } = playing();
    const before = debug.snapshot();
    debug.setScreen("levelup");
    const snap = debug.snapshot();
    expect(snap.screen).toBe("levelup");
    expect(snap.run.pendingLevelUps).toBe(0);
    expect(snap.run.offers).toEqual([]);
    // The pool is derived on levelup; every stored field stands.
    expect({ ...snap.run, pool: [] }).toEqual({ ...before.run, pool: [] });
  });

  it("shows the end screens without ending the run, and reaches every screen", () => {
    const { debug } = playing();
    debug.setKills(3);
    debug.setHp(50);
    debug.setScreen("fallen");
    expect(debug.snapshot().screen).toBe("fallen");
    expect(debug.snapshot().run.kills).toBe(3);
    // The pose ended nothing: the run behind it stands as it did.
    expect(debug.snapshot().run.player.hp).toBe(50);
    debug.setScreen("chest");
    expect(debug.snapshot().screen).toBe("chest");
    debug.setScreen("levelup");
    expect(debug.snapshot().screen).toBe("levelup");
    debug.setScreen("paused");
    expect(debug.snapshot().screen).toBe("paused");
    debug.setScreen("title");
    expect(debug.snapshot().screen).toBe("title");
    expect(debug.snapshot().run.kills).toBe(3);
    debug.setScreen("howto");
    expect(debug.snapshot().screen).toBe("howto");
    debug.setScreen("almanac");
    expect(debug.snapshot().screen).toBe("almanac");
    debug.setScreen("playing");
    debug.setScreen("dawn");
    expect(debug.snapshot().screen).toBe("dawn");
    expect(() => debug.setScreen("nowhere" as never)).toThrow();
    expect(h.cues).toEqual([]);
  });
});

describe("the almanac readings", () => {
  it("shows the almanac with the three indices at zero and the run standing", () => {
    const { debug } = playing();
    debug.setKills(5);
    debug.setScreen("almanac");
    const snap = debug.snapshot();
    expect(snap.screen).toBe("almanac");
    expect(snap.menuIndex).toBe(0);
    expect(snap.almanacTab).toBe(0);
    expect(snap.almanacScroll).toBe(0);
    expect(snap.run.kills).toBe(5);
    expect(snap.run.weapons).toEqual([{ id: "taper", level: 1, cooldown: 0 }]);
    expect(h.cues).toEqual([]);
  });

  it("reports the tab and the scroll, and zero on every other screen", async () => {
    h.debug.setScreen("almanac");
    for (let i = 0; i < ALMANAC_ROWS; i += 1) {
      h.tap("ArrowDown");
      await h.step(1);
    }
    let snap = h.debug.snapshot();
    expect(snap.almanacTab).toBe(0);
    expect(snap.menuIndex).toBe(ALMANAC_ROWS);
    expect(snap.almanacScroll).toBe(1);
    h.tap("ArrowRight");
    await h.step(1);
    snap = h.debug.snapshot();
    // The trinkets tab holds exactly ALMANAC_ROWS entries, so its list never
    // scrolls, and the tab change put the highlight back at the top.
    expect(snap.almanacTab).toBe(1);
    expect(PASSIVE_IDS).toHaveLength(ALMANAC_ROWS);
    expect(snap.menuIndex).toBe(0);
    expect(snap.almanacScroll).toBe(0);
    h.debug.setScreen("title");
    snap = h.debug.snapshot();
    expect(snap.almanacTab).toBe(0);
    expect(snap.almanacScroll).toBe(0);
  });

  it("resets all three indices", async () => {
    h.debug.setScreen("almanac");
    h.tap("ArrowRight");
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.debug.reset();
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menuIndex).toBe(0);
    expect(snap.almanacTab).toBe(0);
    expect(snap.almanacScroll).toBe(0);
    expect(snap.run.hurtFlash).toBe(0);
  });
});

describe("menuRects and tabRects", () => {
  /** Whether the two rectangles share any of the stage. */
  function meet(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean {
    return (
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height
    );
  }

  /** Every rectangle sits on the stage, and no two of them meet. */
  function disjointOnStage(
    rects: readonly { x: number; y: number; width: number; height: number }[],
  ): void {
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(STAGE_W);
      expect(rect.y + rect.height).toBeLessThanOrEqual(STAGE_H);
    }
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(meet(rects[i], rects[j])).toBe(false);
      }
    }
  }

  it("reports one rectangle per item of the menu each screen shows", async () => {
    const { debug } = h;
    expect(debug.menuRects()).toHaveLength(TITLE_ITEMS.length);
    disjointOnStage(debug.menuRects());
    debug.setScreen("playing");
    debug.setPendingLevelUps(1);
    await h.step(1);
    expect(debug.menuRects()).toHaveLength(debug.snapshot().run.offers.length);
    disjointOnStage(debug.menuRects());
    debug.choose(0);
    debug.setScreen("paused");
    expect(debug.menuRects()).toHaveLength(PAUSE_ITEMS.length);
    debug.setScreen("fallen");
    expect(debug.menuRects()).toHaveLength(END_ITEMS.length);
    disjointOnStage(debug.menuRects());
  });

  it("reports one box on howto and chest, and none on playing", () => {
    const { debug } = playing();
    expect(debug.menuRects()).toEqual([]);
    debug.setScreen("title");
    debug.setScreen("howto");
    expect(debug.menuRects()).toHaveLength(1);
    debug.setScreen("chest");
    expect(debug.menuRects()).toHaveLength(1);
  });

  it("windows the almanac's rows and lists its tabs beside them", async () => {
    const { debug } = h;
    debug.setScreen("almanac");
    expect(debug.menuRects()).toHaveLength(ALMANAC_ROWS);
    expect(debug.tabRects()).toHaveLength(ALMANAC_TABS.length);
    disjointOnStage([...debug.menuRects(), ...debug.tabRects()]);
    h.tap("ArrowRight");
    await h.step(1);
    h.tap("ArrowRight");
    await h.step(1);
    h.tap("ArrowRight");
    await h.step(1);
    expect(ALMANAC_TABS[debug.snapshot().almanacTab]).toBe("PICKUPS");
    expect(debug.menuRects()).toHaveLength(6);
    debug.setScreen("title");
    expect(debug.tabRects()).toEqual([]);
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

  it("accepts nextOffers on levelup for the queued overlay", async () => {
    const { debug } = playing();
    debug.setPendingLevelUps(2);
    await h.step(1);
    // The tick that opened the overlay sounds `level-up`; the poses after it
    // sound nothing, so the bus must not grow past what it holds here.
    const sounded = [...h.cues];
    debug.setNextOffers(["lure"]);
    debug.choose(0);
    expect(debug.snapshot().screen).toBe("levelup");
    expect(debug.snapshot().run.offers).toEqual(["lure"]);
    debug.choose(5);
    expect(debug.snapshot().screen).toBe("levelup");
    debug.choose(-1);
    expect(debug.snapshot().screen).toBe("levelup");
    expect(debug.snapshot().run.offers).toEqual(["lure"]);
    expect(h.cues).toEqual(sounded);
  });

  it("takes an evolved id in nextOffers and discards the list at the open", async () => {
    const { debug } = playing();
    debug.setNextOffers(["pyre"]);
    expect(debug.snapshot().run.nextOffers).toEqual(["pyre"]);
    debug.setPendingLevelUps(1);
    await h.step(1);
    expect(debug.snapshot().run.offers).not.toContain("pyre");
    expect(debug.snapshot().run.offers).toHaveLength(3);
    expect(debug.snapshot().run.nextOffers).toBeNull();
  });

  it("discards a queued list that is no longer in the pool", async () => {
    const { debug } = playing();
    debug.setWeapon(0, "taper", 8);
    debug.setNextOffers(["taper"]);
    debug.setPendingLevelUps(1);
    await h.step(1);
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

  it("holds a death's drop while drops is off and drops it when on", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setEnemyMotion(false);
    debug.setWeaponFire(false);
    debug.setDrops(false);
    debug.spawnEnemy("moth", 1000, 0);
    const [moth] = debug.snapshot().run.enemies;
    debug.setEnemyHp(moth.id, 1);
    debug.spawnPuddle("oil-splash", 1000, 0);
    debug.setNextDrop("bread");
    await h.step(1);
    let snap = debug.snapshot();
    expect(snap.run.kills).toBe(1);
    expect(snap.run.gems).toEqual([]);
    expect(snap.run.pickups).toEqual([]);
    // A held death makes no roll, so the posed drop stands.
    expect(snap.run.nextDrop).toBe("bread");

    debug.setDrops(true);
    debug.spawnEnemy("moth", -1000, 0);
    const [second] = debug.snapshot().run.enemies;
    debug.setEnemyHp(second.id, 1);
    debug.spawnPuddle("oil-splash", -1000, 0);
    await h.step(1);
    snap = debug.snapshot();
    expect(snap.run.kills).toBe(2);
    expect(snap.run.gems).toHaveLength(1);
    expect(snap.run.gems[0].tier).toBe("small");
    expect(snap.run.pickups.map((pickup) => pickup.kind)).toEqual(["bread"]);
    expect(snap.run.nextDrop).toBeNull();
  });

  it("banks a gain unspent while progression is off and spends it when on", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setWeaponFire(false);
    debug.setProgression(false);
    debug.spawnGem("large", 0, 0);
    await h.step(1);
    let snap = debug.snapshot();
    expect(snap.run.gems).toEqual([]);
    expect(snap.run.xp).toBe(10);
    expect(snap.run.level).toBe(1);
    expect(snap.run.pendingLevelUps).toBe(0);
    expect(snap.screen).toBe("playing");

    debug.setProgression(true);
    debug.setXp(0);
    debug.spawnGem("large", 0, 0);
    await h.step(1);
    snap = debug.snapshot();
    expect(snap.run.level).toBe(2);
    expect(snap.run.xp).toBe(5);
    expect(snap.run.pendingLevelUps).toBe(1);
  });
});

describe("the drawn outcome poses", () => {
  it("set each field, read back by the snapshot, on a run screen alone", () => {
    const { debug } = playing();
    debug.spawnEnemy("moth", 100, 0);
    const [moth] = debug.snapshot().run.enemies;
    debug.setNextSpawnAngle(0);
    debug.setNextSwarmAngle(359.5);
    debug.setNextPuddleOffset(-240, 320);
    debug.setNextStrikeTarget(moth.id);
    debug.setNextChestItem("brass");
    debug.setNextDrop("draft");
    expect(debug.snapshot().run).toMatchObject({
      nextSpawnAngle: 0,
      nextSwarmAngle: 359.5,
      nextPuddleOffset: { x: -240, y: 320 },
      nextStrikeTarget: moth.id,
      nextChestItem: "brass",
      nextDrop: "draft",
    });
    debug.setScreen("paused");
    debug.setNextDrop("bread");
    expect(debug.snapshot().run.nextDrop).toBe("bread");
    debug.setScreen("title");
    debug.setNextDrop("none");
    expect(debug.snapshot().run.nextDrop).toBe("bread");
    expect(h.cues).toEqual([]);
  });

  it("refuse an argument outside its domain", () => {
    const { debug } = playing();
    debug.spawnEnemy("moth", 100, 0);
    for (const bad of [-1, 360, 400, Number.NaN]) {
      expect(() => debug.setNextSpawnAngle(bad)).toThrow();
      expect(() => debug.setNextSwarmAngle(bad)).toThrow();
    }
    expect(() => debug.setNextPuddleOffset(400, 1)).toThrow();
    expect(() => debug.setNextPuddleOffset(Number.NaN, 0)).toThrow();
    debug.setNextPuddleOffset(400, 0);
    expect(() => debug.setNextStrikeTarget(7)).toThrow();
    expect(() => debug.setNextStrikeTarget(-1)).toThrow();
    expect(() => debug.setNextChestItem("pyre" as never)).toThrow();
    expect(() => debug.setNextChestItem("lamp-oil" as never)).toThrow();
    expect(() => debug.setNextDrop("chest" as never)).toThrow();
    expect(debug.snapshot().run).toMatchObject({
      nextSpawnAngle: null,
      nextSwarmAngle: null,
      nextPuddleOffset: { x: 400, y: 0 },
      nextStrikeTarget: null,
      nextChestItem: null,
      nextDrop: null,
    });
  });

  it("decide the next draw through the real systems", async () => {
    const { debug } = playing();
    debug.setSpawning(false);
    debug.setEvents(false);
    debug.setWeaponFire(false);
    debug.spawnEnemy("moth", 500, 0);
    const [moth] = debug.snapshot().run.enemies;
    debug.setEnemyHp(moth.id, 1);
    debug.spawnProjectile("ember", 500, 0, 0, 0, 0);
    debug.setNextDrop("draft");
    await h.step(1);
    const after = debug.snapshot().run;
    expect(after.pickups.map((pickup) => pickup.kind)).toEqual(["draft"]);
    expect(after.nextDrop).toBeNull();
  });
});
