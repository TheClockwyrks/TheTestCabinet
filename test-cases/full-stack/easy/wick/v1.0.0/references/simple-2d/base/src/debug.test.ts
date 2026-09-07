import type { DeepReadonly } from "ts-essentials";
import { describe, expect, it } from "vitest";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  END_ITEMS,
  HURT_FLASH,
  OFFER_COUNT,
  PAUSE_ITEMS,
  TICK_DT,
  TITLE_ITEMS,
} from "./constants";
import { entriesOf } from "./almanac";
import { createDebugApi } from "./debug";
import { NO_POINTER, runFrame } from "./flow";
import type { WickDebugApi, WickState } from "./game";
import { DAWN_TICK } from "./sim/lamplighter";
import { NOTHING_HELD } from "./sim/context";
import { initialState } from "./state";

type View = DeepReadonly<WickState>;

/** The engine's part, without the engine: a state, poses over it, frames. */
class Drive {
  readonly api: WickDebugApi = createDebugApi();
  state: WickState = initialState();

  pose(transition: (state: View) => WickState): void {
    const before = JSON.stringify(this.state);
    const next = transition(this.state);
    // A pose leaves the state it was handed exactly as it was.
    expect(JSON.stringify(this.state)).toBe(before);
    this.state = next;
  }

  snap(): ReturnType<WickDebugApi["snapshot"]> {
    return this.api.snapshot(this.state);
  }

  /** `frames` frames of one tick each, as a `ConstantClock` of 1000 / 60. */
  step(frames = 1): void {
    for (let i = 0; i < frames; i += 1) this.advance(TICK_DT);
  }

  /** One frame worth `seconds`. */
  advance(seconds: number): void {
    this.state = runFrame(this.state, {
      dt: seconds,
      pressed: [],
      held: NOTHING_HELD,
      pointer: NO_POINTER,
      toggleMute: () => {},
    }).draft;
  }
}

function build(): Drive {
  return new Drive();
}

/**
 * A fresh run, the sequence `specs/instrumentation.md` names: this pose to
 * `playing`, then Taper in the first slot. `setScreen` sets the screen alone.
 */
function playing(): Drive {
  const d = build();
  d.pose((s) => d.api.setScreen(s, "playing"));
  d.pose((s) => d.api.setWeapon(s, 0, "taper", 1));
  return d;
}

describe("reconcile", () => {
  it("re-derives a stored reading from a posed run", () => {
    const d = playing();
    d.pose((s) => d.api.setTick(s, 600));
    d.pose((s) => d.api.setPassive(s, 0, "tallow", 2));
    d.pose((s) => d.api.spawnEnemy(s, "moth", 100, 100));
    d.pose((s) => d.api.spawnEnemy(s, "gnat", 120, 100));
    d.pose((s) => d.api.reconcile(s));
    const snap = d.snap();
    // Every derived reading answers for the run AS POSED, not as it was.
    expect(snap.run.time).toBe(10);
    expect(snap.run.spawnWindow).toBe(0);
    expect(snap.run.maxHp).toBe(130);
    expect(snap.run.aliveCommons).toBe(1);
  });

  it("advances nothing, and twice matches once", () => {
    const d = playing();
    d.pose((s) => d.api.setTick(s, 300));
    d.pose((s) => d.api.setPlayerPosition(s, 40, 60));
    d.pose((s) => d.api.setSpawnTimer(s, 1.25));
    d.pose((s) => d.api.setWeaponCooldown(s, 0, 0.75));
    d.pose((s) => d.api.spawnEnemy(s, "moth", 100, 100));
    d.pose((s) => d.api.setEnemyAge(s, d.snap().run.enemies[0].id, 2));
    const before = d.snap();
    d.pose((s) => d.api.reconcile(s));
    const once = d.snap();
    d.pose((s) => d.api.reconcile(s));
    const twice = d.snap();
    expect(once).toEqual(before);
    expect(twice).toEqual(once);
  });
});

describe("the snapshot", () => {
  it("carries every field on every screen", () => {
    const d = build();
    const snap = d.snap();
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
    expect(snap.run).toEqual({
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
    });
    expect(snap.muted).toBe(false);
    expect(snap.accumulator).toBe(0);
    expect(snap.simTime).toBe(0);
    expect(snap.rngState).toBe(1);
  });

  it("is a copy of the declared fields alone, with the pool on levelup", () => {
    const d = playing();
    const snap = d.snap();
    snap.run.player.x = 99;
    expect(d.state.run.player.x).toBe(0);
    expect("cooldownSet" in snap.run.weapons[0]).toBe(false);
    expect("movedTicks" in snap.run).toBe(false);
    d.pose((s) => d.api.setPendingLevelUps(s, 1));
    d.step();
    const onOverlay = d.snap();
    expect(onOverlay.run.pool.length).toBeGreaterThan(3);
    for (const id of onOverlay.run.offers) {
      expect(onOverlay.run.pool).toContain(id);
    }
    d.pose((s) => d.api.choose(s, 0));
    expect(d.snap().run.pool).toEqual([]);
  });

  it("derives time, xpToNext, and the stats from the passives", () => {
    const d = playing();
    d.pose((s) => d.api.setTick(s, 1800));
    d.pose((s) => d.api.setLevel(s, 4));
    d.pose((s) => d.api.setPassive(s, 0, "tallow", 2));
    d.pose((s) => d.api.setPassive(s, 1, "brass", 1));
    d.pose((s) => d.api.setPassive(s, 2, "bellows", 1));
    d.pose((s) => d.api.setPassive(s, 3, "lure", 2));
    const snap = d.snap();
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
  it("restores the title state, the switches, and the seed, keeping muted", () => {
    const d = playing();
    d.pose((s) => d.api.setSpawning(s, false));
    d.step(5);
    d.state = { ...d.state, muted: true };
    d.pose((s) => d.api.reset(s, { seed: 7 }));
    const snap = d.snap();
    expect(snap.screen).toBe("title");
    expect(snap.spawning).toBe(true);
    expect(snap.rngState).toBe(7);
    expect(snap.simTime).toBe(0);
    expect(snap.run.tick).toBe(0);
    expect(snap.muted).toBe(true);
    expect(d.state).toEqual({ ...initialState(7), muted: true });
    d.pose((s) => d.api.reset(s));
    expect(d.snap().rngState).toBe(1);
  });

  it("restores the highlight, the tab, and the window to zero", () => {
    const d = build();
    d.pose((s) => d.api.setScreen(s, "almanac"));
    d.state = { ...d.state, menuIndex: 12, almanacTab: 2, almanacScroll: 3 };
    d.pose((s) => d.api.reset(s));
    const snap = d.snap();
    expect(snap.menuIndex).toBe(0);
    expect(snap.almanacTab).toBe(0);
    expect(snap.almanacScroll).toBe(0);
    expect(snap.run.hurtFlash).toBe(0);
  });
});

describe("the almanac readings", () => {
  it("enters the almanac with every index at zero, the run left alone", () => {
    const d = playing();
    d.pose((s) => d.api.setKills(s, 4));
    d.state = { ...d.state, almanacTab: 2, almanacScroll: 1 };
    d.pose((s) => d.api.setScreen(s, "almanac"));
    const snap = d.snap();
    expect(snap.screen).toBe("almanac");
    expect(snap.menuIndex).toBe(0);
    expect(snap.almanacTab).toBe(0);
    expect(snap.almanacScroll).toBe(0);
    // The pose sets the screen and the cursors; the run stands as it was.
    expect(snap.run.kills).toBe(4);
  });

  it("reports the tab and the window it holds, and zero off the screen", () => {
    const d = build();
    d.pose((s) => d.api.setScreen(s, "almanac"));
    d.state = { ...d.state, almanacTab: 2, almanacScroll: 3 };
    expect(d.snap().almanacTab).toBe(2);
    expect(d.snap().almanacScroll).toBe(3);
    d.pose((s) => d.api.setScreen(s, "title"));
    expect(d.snap().almanacTab).toBe(0);
    expect(d.snap().almanacScroll).toBe(0);
  });

  it("reports the seconds left of the hurt flash", () => {
    const d = playing();
    d.pose((s) => d.api.setSpawning(s, false));
    d.pose((s) => d.api.setWeaponFire(s, false));
    d.pose((s) => d.api.setEnemyMotion(s, false));
    expect(d.snap().run.hurtFlash).toBe(0);
    d.pose((s) => d.api.spawnEnemy(s, "moth", 0, 0));
    d.step();
    expect(d.snap().run.hurtFlash).toBe(HURT_FLASH);
    d.step();
    expect(d.snap().run.hurtFlash).toBeCloseTo(HURT_FLASH - TICK_DT, 9);
  });
});

describe("the rectangle readings", () => {
  it("report one rectangle per item of the menu each screen shows", () => {
    const d = playing();
    expect(d.api.menuRects(d.state)).toEqual([]);
    d.pose((s) => d.api.setScreen(s, "paused"));
    expect(d.api.menuRects(d.state)).toHaveLength(PAUSE_ITEMS.length);
    d.pose((s) => d.api.setScreen(s, "fallen"));
    expect(d.api.menuRects(d.state)).toHaveLength(END_ITEMS.length);
    d.pose((s) => d.api.setScreen(s, "title"));
    const title = d.api.menuRects(d.state);
    expect(title).toHaveLength(TITLE_ITEMS.length);
    for (const rect of title) {
      expect(Object.keys(rect).sort()).toEqual(["height", "width", "x", "y"]);
    }
  });

  it("report the almanac's rows and its tabs, and no tab elsewhere", () => {
    const d = build();
    d.pose((s) => d.api.setScreen(s, "almanac"));
    expect(d.api.menuRects(d.state)).toHaveLength(ALMANAC_ROWS);
    expect(d.api.tabRects(d.state)).toHaveLength(ALMANAC_TABS.length);
    d.state = { ...d.state, almanacTab: 3 };
    expect(d.api.menuRects(d.state)).toHaveLength(entriesOf(3).length);
    d.pose((s) => d.api.setScreen(s, "title"));
    expect(d.api.tabRects(d.state)).toEqual([]);
  });
});

describe("setScreen", () => {
  it("sets the screen and the cursors alone, leaving the run as it stands", () => {
    const d = build();
    d.pose((s) => d.api.setWeaponFire(s, false));
    d.state = { ...d.state, simTime: 3, rngState: 12345 };
    d.pose((s) => d.api.setScreen(s, "playing"));
    const snap = d.snap();
    expect(snap.screen).toBe("playing");
    expect(snap.menuIndex).toBe(0);
    // No run is begun: the idle run's empty loadout stands.
    expect(snap.run.weapons).toEqual([]);
    expect(snap.simTime).toBe(3);
    expect(snap.rngState).toBe(12345);
    expect(snap.weaponFire).toBe(false);
  });

  it("is the pose a fresh run is composed from", () => {
    const d = build();
    d.pose((s) => d.api.reset(s));
    d.pose((s) => d.api.setScreen(s, "playing"));
    d.pose((s) => d.api.setWeapon(s, 0, "taper", 1));
    const snap = d.snap();
    expect(snap.screen).toBe("playing");
    expect(snap.run.weapons).toEqual([{ id: "taper", level: 1, cooldown: 0 }]);
    expect(snap.run.tick).toBe(0);
  });

  it("leaves the run, the overlay, and the chest result where they stand", () => {
    const d = playing();
    d.pose((s) => d.api.setTick(s, 10));
    d.pose((s) => d.api.setScreen(s, "paused"));
    expect(d.snap().screen).toBe("paused");
    d.pose((s) => d.api.setScreen(s, "playing"));
    expect(d.snap().run.tick).toBe(10);
    d.pose((s) => d.api.spawnPickup(s, "chest", 0, 0));
    d.step();
    expect(d.snap().screen).toBe("chest");
    expect(d.snap().run.chestResult).toEqual({
      kind: "level",
      item: "taper",
      level: 2,
    });
    // The pose moves the screen; `confirm` is what closes the overlay.
    d.pose((s) => d.api.setScreen(s, "playing"));
    expect(d.snap().screen).toBe("playing");
    expect(d.snap().run.chestResult).toEqual({
      kind: "level",
      item: "taper",
      level: 2,
    });
    d.pose((s) => d.api.setPendingLevelUps(s, 1));
    d.step();
    expect(d.snap().screen).toBe("levelup");
    expect(d.snap().run.offers.length).toBe(OFFER_COUNT);
    d.pose((s) => d.api.choose(s, 0));
    expect(d.snap().screen).toBe("playing");
  });

  it("opens no overlay of its own: the pose draws nothing", () => {
    const d = playing();
    const before = d.snap().rngState;
    d.pose((s) => d.api.setScreen(s, "levelup"));
    const snap = d.snap();
    expect(snap.screen).toBe("levelup");
    expect(snap.run.offers).toEqual([]);
    expect(snap.rngState).toBe(before);
  });

  it("discards the accumulator on the way to paused", () => {
    const d = playing();
    d.advance(0.025);
    expect(d.snap().accumulator).toBeCloseTo(0.025 - TICK_DT, 12);
    d.pose((s) => d.api.setScreen(s, "paused"));
    expect(d.snap().accumulator).toBe(0);
  });

  it("reaches every screen from every screen, and refuses a name it has not", () => {
    const d = playing();
    d.pose((s) => d.api.setKills(s, 3));
    d.pose((s) => d.api.setScreen(s, "fallen"));
    expect(d.snap().screen).toBe("fallen");
    // The run the end screen reports is the run that was: the pose ends nothing.
    expect(d.snap().run.kills).toBe(3);
    d.pose((s) => d.api.setScreen(s, "chest"));
    expect(d.snap().screen).toBe("chest");
    d.pose((s) => d.api.setScreen(s, "title"));
    expect(d.snap().screen).toBe("title");
    expect(d.snap().run.kills).toBe(3);
    d.pose((s) => d.api.setScreen(s, "howto"));
    expect(d.snap().screen).toBe("howto");
    d.pose((s) => d.api.setScreen(s, "dawn"));
    expect(d.snap().screen).toBe("dawn");
    expect(() => d.api.setScreen(d.state, "nowhere" as never)).toThrow();
  });

  it("is not how a run ends: the endings come from the ticks after the pose", () => {
    const fallen = playing();
    fallen.pose((s) => fallen.api.setHp(s, 0));
    fallen.step();
    expect(fallen.snap().screen).toBe("fallen");

    const dawn = playing();
    dawn.pose((s) => dawn.api.setTick(s, DAWN_TICK - 1));
    dawn.step();
    expect(dawn.snap().screen).toBe("dawn");
  });
});

describe("the clock", () => {
  it("a frame worth a tick ticks on playing and counts simTime elsewhere", () => {
    const d = build();
    d.step(3);
    expect(d.snap().run.tick).toBe(0);
    expect(d.snap().simTime).toBeCloseTo(3 * TICK_DT, 12);
    d.pose((s) => d.api.setScreen(s, "playing"));
    d.step(30);
    expect(d.snap().run.tick).toBe(30);
  });

  it("a longer frame feeds the accumulator and keeps the remainder", () => {
    const d = playing();
    d.advance(0.04);
    expect(d.snap().run.tick).toBe(2);
    expect(d.snap().accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 12);
  });

  it("setTick and setSpawnTimer pose the clock alone", () => {
    const d = playing();
    d.pose((s) => d.api.spawnEnemy(s, "moth", 100, 0));
    d.pose((s) => d.api.setTick(s, 35999));
    d.pose((s) => d.api.setSpawnTimer(s, 2));
    const snap = d.snap();
    expect(snap.run.tick).toBe(35999);
    expect(snap.run.spawnTimer).toBe(2);
    expect(snap.run.enemies).toHaveLength(1);
    expect(() => d.api.setTick(d.state, DAWN_TICK)).toThrow();
    expect(() => d.api.setTick(d.state, -1)).toThrow();
    expect(() => d.api.setSpawnTimer(d.state, -0.1)).toThrow();
    d.step();
    expect(d.snap().screen).toBe("dawn");
  });
});

describe("the lamplighter and progression poses", () => {
  it("set the fields and check their domains", () => {
    const d = playing();
    d.pose((s) => d.api.setPlayerPosition(s, 10, -20));
    d.pose((s) => d.api.setFacing(s, "left"));
    d.pose((s) => d.api.setHp(s, 12.5));
    d.pose((s) => d.api.setLevel(s, 7));
    d.pose((s) => d.api.setXp(s, 3.5));
    d.pose((s) => d.api.setKills(s, 9));
    d.pose((s) => d.api.setPendingLevelUps(s, 2));
    d.pose((s) => d.api.setNextOffers(s, ["ember", "lure"]));
    const snap = d.snap();
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
    const { api, state } = d;
    expect(() => api.setFacing(state, "up" as never)).toThrow();
    expect(() => api.setLevel(state, 0)).toThrow();
    expect(() => api.setXp(state, -1)).toThrow();
    expect(() => api.setKills(state, 1.5)).toThrow();
    expect(() => api.setPendingLevelUps(state, -1)).toThrow();
    expect(() => api.setNextOffers(state, [])).toThrow();
    expect(() => api.setNextOffers(state, ["ember", "ember"])).toThrow();
    expect(() => api.setNextOffers(state, ["sword"] as never)).toThrow();
    expect(() =>
      api.setNextOffers(state, ["a", "b", "c", "d"] as never),
    ).toThrow();
    d.pose((s) => d.api.setHp(s, -5));
    d.step();
    expect(d.snap().screen).toBe("fallen");
  });

  it("poses from whatever screen is showing", () => {
    const d = build();
    expect(d.snap().screen).toBe("title");
    d.pose((s) => d.api.setPlayerPosition(s, 10, 10));
    d.pose((s) => d.api.setLevel(s, 5));
    d.pose((s) => d.api.spawnEnemy(s, "moth", 0, 0));
    d.pose((s) => d.api.spawnGem(s, "small", 0, 0));
    expect(d.snap().run.player.x).toBe(10);
    expect(d.snap().run.level).toBe(5);
    expect(d.snap().run.enemies).toHaveLength(1);
    expect(d.snap().run.gems).toHaveLength(1);
    expect(d.snap().screen).toBe("title");
  });

  it("applies a health and an enemy health past the live maximum", () => {
    const d = playing();
    d.pose((s) => d.api.setHp(s, 1e4));
    expect(d.snap().run.player.hp).toBe(1e4);
    d.pose((s) => d.api.spawnEnemy(s, "moth", 0, 0));
    const id = d.snap().run.enemies[0].id;
    d.pose((s) => d.api.setEnemyHp(s, id, 1e4));
    expect(d.snap().run.enemies[0].hp).toBe(1e4);
    expect(() => d.api.setEnemyHp(d.state, id, 0)).toThrow();
  });

  it("takes a whole seed from 0 to 2^32 - 1 and nothing else", () => {
    const d = build();
    d.pose((s) => d.api.reset(s, { seed: 0 }));
    expect(d.snap().rngState).toBe(0);
    d.pose((s) => d.api.reset(s, { seed: 2 ** 32 - 1 }));
    expect(d.snap().rngState).toBe(2 ** 32 - 1);
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) {
      expect(() => d.api.reset(d.state, { seed })).toThrow();
    }
  });

  it("takes an evolved id in nextOffers and discards the list at the open", () => {
    const d = playing();
    d.pose((s) => d.api.setNextOffers(s, ["pyre"]));
    expect(d.snap().run.nextOffers).toEqual(["pyre"]);
    d.pose((s) => d.api.setPendingLevelUps(s, 1));
    d.step();
    expect(d.snap().run.offers).not.toContain("pyre");
    expect(d.snap().run.offers).toHaveLength(3);
    expect(d.snap().run.nextOffers).toBeNull();
  });

  it("accepts nextOffers on levelup for the queued overlay", () => {
    const d = playing();
    d.pose((s) => d.api.setPendingLevelUps(s, 2));
    d.step();
    d.pose((s) => d.api.setNextOffers(s, ["lure"]));
    d.pose((s) => d.api.choose(s, 0));
    expect(d.snap().screen).toBe("levelup");
    expect(d.snap().run.offers).toEqual(["lure"]);
    expect(() => d.api.choose(d.state, 5)).toThrow();
    expect(() => d.api.choose(d.state, -1)).toThrow();
    expect(d.snap().screen).toBe("levelup");
    expect(d.snap().run.offers).toEqual(["lure"]);
  });
});

describe("the loadout poses", () => {
  it("appends, replaces, and keeps or zeroes the timer", () => {
    const d = playing();
    d.pose((s) => d.api.setWeaponCooldown(s, 0, 0.5));
    d.pose((s) => d.api.setWeapon(s, 0, "taper", 4));
    expect(d.snap().run.weapons[0]).toEqual({
      id: "taper",
      level: 4,
      cooldown: 0.5,
    });
    d.pose((s) => d.api.setWeapon(s, 0, "ember", 2));
    expect(d.snap().run.weapons[0]).toEqual({
      id: "ember",
      level: 2,
      cooldown: 0,
    });
    d.pose((s) => d.api.setWeapon(s, 1, "pyre", 1));
    expect(d.snap().run.weapons).toHaveLength(2);
    const { api, state } = d;
    expect(() => api.setWeapon(state, 3, "pin", 1)).toThrow();
    expect(() => api.setWeapon(state, 2, "ember", 1)).toThrow();
    expect(() => api.setWeapon(state, 2, "beacon", 1)).toThrow();
    expect(() => api.setWeapon(state, 2, "taper", 1)).toThrow();
    expect(() => api.setWeapon(state, 2, "pin", 9)).toThrow();
    expect(() => api.setWeapon(state, 2, "hail", 2)).toThrow();
    expect(() => api.setWeapon(state, 2, "sword" as never, 1)).toThrow();
    d.pose((s) => d.api.removeWeapon(s, 0));
    expect(d.snap().run.weapons).toEqual([
      { id: "pyre", level: 1, cooldown: 0 },
    ]);
    expect(() => d.api.removeWeapon(d.state, 1)).toThrow();
    expect(() => d.api.setWeaponCooldown(d.state, 0, -1)).toThrow();
  });

  it("holds six weapons at most", () => {
    const d = playing();
    for (const [i, id] of (
      ["ember", "pin", "lantern", "halo", "flare"] as const
    ).entries()) {
      d.pose((s) => d.api.setWeapon(s, i + 1, id, 1));
    }
    expect(d.snap().run.weapons).toHaveLength(6);
    expect(() => d.api.setWeapon(d.state, 6, "spark", 1)).toThrow();
  });

  it("places passives, leaving hp, and removes them", () => {
    const d = playing();
    d.pose((s) => d.api.setPassive(s, 0, "tallow", 3));
    expect(d.snap().run.player.hp).toBe(100);
    expect(d.snap().run.maxHp).toBe(145);
    d.pose((s) => d.api.setPassive(s, 0, "tallow", 5));
    d.pose((s) => d.api.setPassive(s, 1, "brass", 3));
    const { api, state } = d;
    expect(() => api.setPassive(state, 2, "brass", 1)).toThrow();
    expect(() => api.setPassive(state, 1, "brass", 4)).toThrow();
    expect(() => api.setPassive(state, 1, "wick", 0)).toThrow();
    expect(() => api.setPassive(state, 1, "lantern" as never, 1)).toThrow();
    expect(() => api.setPassive(state, 3, "wick", 1)).toThrow();
    d.pose((s) => d.api.setHp(s, 160));
    d.pose((s) => d.api.removePassive(s, 0));
    expect(d.snap().run.passives).toEqual([{ id: "brass", level: 3 }]);
    expect(d.snap().run.player.hp).toBe(160);
    d.step();
    expect(d.snap().run.player.hp).toBe(100);
  });
});

describe("the enemy poses", () => {
  it("spawns through the real path and poses each field", () => {
    const d = playing();
    d.pose((s) => d.api.setTick(s, 3600));
    d.pose((s) => d.api.spawnEnemy(s, "moth", 30, 40));
    d.pose((s) => d.api.spawnEnemy(s, "owl", 0, 0));
    const [moth, owl] = d.snap().run.enemies;
    expect(moth).toMatchObject({ id: 0, type: "moth", x: 30, y: 40, age: 0 });
    expect(moth.maxHp).toBeCloseTo(5 * 1.15);
    expect(moth.hp).toBe(moth.maxHp);
    expect(moth.heading.x).toBeCloseTo(-0.6);
    expect(moth.heading.y).toBeCloseTo(-0.8);
    expect(owl.maxHp).toBe(2000);
    expect(owl.heading).toEqual({ x: 1, y: 0 });
    expect(d.snap().run.aliveCommons).toBe(1);
    d.pose((s) => d.api.setEnemyPosition(s, 0, -5, 5));
    d.pose((s) => d.api.setEnemyHp(s, 0, 2));
    d.pose((s) => d.api.setEnemyHeading(s, 0, 0, 3));
    d.pose((s) => d.api.setEnemyAge(s, 0, 1.5));
    d.pose((s) => d.api.setEnemyContactCooldown(s, 0, 0.25));
    expect(d.snap().run.enemies[0]).toMatchObject({
      x: -5,
      y: 5,
      hp: 2,
      heading: { x: 0, y: 1 },
      age: 1.5,
      contactCooldown: 0.25,
    });
    const { api, state } = d;
    expect(() => api.setEnemyHp(state, 0, 0)).toThrow();
    expect(() => api.setEnemyHeading(state, 0, 0, 0)).toThrow();
    expect(() => api.setEnemyAge(state, 0, -1)).toThrow();
    expect(() => api.setEnemyPosition(state, 7, 0, 0)).toThrow();
    expect(() => api.spawnEnemy(state, "dragon" as never, 0, 0)).toThrow();
    d.pose((s) => d.api.removeEnemy(s, 0));
    expect(d.snap().run.enemies.map((enemy) => enemy.id)).toEqual([1]);
    expect(d.snap().run.kills).toBe(0);
    d.pose((s) => d.api.clearEnemies(s));
    expect(d.snap().run.enemies).toEqual([]);
    expect(d.snap().run.nextId).toBe(2);
  });

  it("spawns on paused as well", () => {
    const d = playing();
    d.pose((s) => d.api.setScreen(s, "paused"));
    d.pose((s) => d.api.spawnEnemy(s, "bat", 10, 0));
    expect(d.snap().run.enemies).toHaveLength(1);
  });
});

describe("the effect, gem, and pickup poses", () => {
  it("makes projectiles and puddles from the table rows", () => {
    const d = playing();
    d.pose((s) => d.api.setPassive(s, 0, "glass", 2));
    d.pose((s) => d.api.setPassive(s, 1, "wick", 1));
    d.pose((s) => d.api.spawnProjectile(s, "ember", 1, 2, 100, 0, 0));
    d.pose((s) => d.api.setWeapon(s, 1, "pin", 8));
    d.pose((s) => d.api.spawnProjectile(s, "pin", 0, 0, 0, 0, -1));
    d.pose((s) => d.api.spawnProjectile(s, "sconce", 0, 0, 600, 0, -1));
    d.pose((s) => d.api.spawnPuddle(s, "oil-splash", 5, 5));
    d.pose((s) => d.api.spawnPuddle(s, "blaze", 5, 5));
    const { projectiles, zones } = d.snap().run;
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
    const { api, state } = d;
    expect(() => api.spawnProjectile(state, "sconce", 0, 0, 0, 0, 0)).toThrow();
    expect(() =>
      api.spawnProjectile(state, "taper" as never, 0, 0, 1, 0, 0),
    ).toThrow();
    expect(() => api.spawnProjectile(state, "ember", 0, 0, 1, 0, -2)).toThrow();
    expect(() => api.spawnPuddle(state, "halo" as never, 0, 0)).toThrow();
    d.pose((s) => d.api.clearProjectiles(s));
    d.pose((s) => d.api.clearZones(s));
    expect(d.snap().run.projectiles).toEqual([]);
    expect(d.snap().run.zones).toEqual([]);
  });

  it("integrates a posed projectile from the next tick and expires it", () => {
    const d = playing();
    d.pose((s) => d.api.spawnProjectile(s, "sconce", 0, 0, 600, 0, -1));
    d.step();
    let [sconce] = d.snap().run.projectiles;
    expect(sconce.x).toBeCloseTo(10);
    expect(sconce.vx).toBeCloseTo(590);
    expect(sconce.ttl).toBeCloseTo(2.5 - TICK_DT);
    d.pose((s) => d.api.setEffectMotion(s, false));
    d.step();
    [sconce] = d.snap().run.projectiles;
    expect(sconce.x).toBeCloseTo(10);
    expect(sconce.ttl).toBeCloseTo(2.5 - 2 * TICK_DT);
    d.step(148);
    expect(d.snap().run.projectiles).toEqual([]);
  });

  it("places gems and pickups and clears them without effect", () => {
    const d = playing();
    d.pose((s) => d.api.spawnGem(s, "large", 200, 0));
    d.pose((s) => d.api.setGemAttracted(s, 0, true));
    d.pose((s) => d.api.spawnPickup(s, "bread", 300, 0));
    expect(d.snap().run.gems).toEqual([
      { id: 0, tier: "large", x: 200, y: 0, attracted: true },
    ]);
    expect(d.snap().run.pickups).toEqual([
      { id: 1, kind: "bread", x: 300, y: 0 },
    ]);
    const { api, state } = d;
    expect(() => api.setGemAttracted(state, 1, true)).toThrow();
    expect(() => api.spawnGem(state, "huge" as never, 0, 0)).toThrow();
    expect(() => api.spawnPickup(state, "gold" as never, 0, 0)).toThrow();
    d.pose((s) => d.api.clearGems(s));
    d.pose((s) => d.api.clearPickups(s));
    expect(d.snap().run.gems).toEqual([]);
    expect(d.snap().run.pickups).toEqual([]);
    expect(d.snap().run.xp).toBe(0);
    expect(d.snap().run.nextId).toBe(2);
  });
});

describe("the switches", () => {
  it("each set its own field on any screen and nothing else", () => {
    const d = build();
    d.pose((s) => d.api.setEnemyMotion(s, false));
    d.pose((s) => d.api.setEnemyContact(s, false));
    d.pose((s) => d.api.setEvents(s, false));
    d.pose((s) => d.api.setDespawning(s, false));
    d.pose((s) => d.api.setEffectMotion(s, false));
    const snap = d.snap();
    expect(snap.enemyMotion).toBe(false);
    expect(snap.enemyContact).toBe(false);
    expect(snap.events).toBe(false);
    expect(snap.despawning).toBe(false);
    expect(snap.effectMotion).toBe(false);
    expect(snap.spawning).toBe(true);
    expect(snap.weaponFire).toBe(true);
    expect(() => d.api.setSpawning(d.state, "no" as never)).toThrow();
  });
});
