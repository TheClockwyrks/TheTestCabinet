import { describe, expect, it } from "vitest";
import { type Cue, type WeaponId } from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type WickState } from "../state";
import { NOTHING_HELD } from "./context";
import { tick } from "./tick";

interface World {
  state: WickState;
  rng: Rng;
  cues: Set<Cue>;
}

/** A `playing` run holding `weapons`, every autonomous faculty held. */
function playing(...weapons: [WeaponId, number][]): World {
  const state = initialState();
  state.run = freshRun();
  state.run.weapons = weapons.map(([id, level]) => ({
    id,
    level,
    cooldown: 0,
    cooldownSet: 0,
  }));
  state.screen = "playing";
  state.switches.spawning = false;
  state.switches.events = false;
  state.switches.despawning = false;
  state.switches.enemyMotion = false;
  state.switches.enemyContact = false;
  state.switches.weaponFire = false;
  return { state, rng: new Rng(), cues: new Set() };
}

function step(world: World, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, NOTHING_HELD, world.cues);
  }
}

describe("the aura", () => {
  it("appears on the first playing tick Halo is held, whatever the switches", () => {
    const world = playing(["taper", 1], ["halo", 2]);
    world.state.switches.effectMotion = false;
    world.state.run.player.x = 30;
    step(world);
    expect(world.state.run.zones).toEqual([
      {
        id: 0,
        weapon: "halo",
        kind: "aura",
        x: 30,
        y: 0,
        radius: 90,
        damage: 3,
        ttl: null,
        hits: [],
        bornTick: 1,
      },
    ]);
    expect(world.state.run.nextId).toBe(1);
    step(world, 5);
    expect(world.state.run.zones).toHaveLength(1);
  });

  it("follows the player and is recomputed every tick from the stats in force", () => {
    const world = playing(["halo", 1]);
    step(world);
    const [aura] = world.state.run.zones;
    world.state.run.player.x = -200;
    world.state.run.player.y = 45;
    world.state.run.passives.push(
      { id: "glass", level: 3 },
      { id: "wick", level: 2 },
    );
    world.state.run.weapons[0].level = 8;
    step(world);
    expect(aura).toMatchObject({ x: -200, y: 45, radius: 156, damage: 9.6 });
    expect(world.state.run.zones).toEqual([aura]);
  });

  it("is removed on the next playing tick Halo is gone, and Corona takes a fresh id", () => {
    const world = playing(["halo", 1]);
    step(world);
    expect(world.state.run.zones[0]).toMatchObject({ id: 0, weapon: "halo" });
    world.state.run.weapons[0].id = "corona";
    step(world);
    expect(world.state.run.zones).toEqual([
      expect.objectContaining({
        id: 1,
        weapon: "corona",
        radius: 150,
        damage: 12,
      }),
    ]);
    world.state.run.weapons = [];
    step(world);
    expect(world.state.run.zones).toEqual([]);
  });

  it("is created again on the tick after the zones are cleared", () => {
    const world = playing(["halo", 1]);
    step(world, 3);
    world.state.run.zones = [];
    step(world);
    expect(world.state.run.zones).toEqual([
      expect.objectContaining({ id: 1, kind: "aura", bornTick: 4 }),
    ]);
  });
});

describe("the Chandelier set", () => {
  it("replaces Lantern's lanterns with four permanent ones on the first tick held", () => {
    const world = playing(["lantern", 8]);
    world.state.switches.weaponFire = true;
    step(world);
    expect(world.state.run.zones.map((zone) => zone.weapon)).toEqual([
      "lantern",
      "lantern",
      "lantern",
      "lantern",
    ]);
    world.state.run.weapons[0] = {
      id: "chandelier",
      level: 1,
      cooldown: 0,
      cooldownSet: 0,
    };
    step(world);
    const set = world.state.run.zones;
    expect(set.map((zone) => zone.weapon)).toEqual([
      "chandelier",
      "chandelier",
      "chandelier",
      "chandelier",
    ]);
    expect(set.map((zone) => zone.id)).toEqual([4, 5, 6, 7]);
    expect(set.map((zone) => zone.angle)).toEqual([0, 90, 180, 270]);
    expect(set[0]).toMatchObject({
      kind: "lantern",
      x: 120,
      y: 0,
      radius: 20,
      damage: 25,
      ttl: null,
      hits: [],
      orbit: 120,
    });
    step(world, 600);
    expect(world.state.run.zones).toHaveLength(4);
    expect(world.state.run.zones[0].angle).toBeCloseTo(1800, 6);
  });

  it("recomputes orbit, radius, and damage every tick and rides the player", () => {
    const world = playing(["chandelier", 1]);
    step(world);
    world.state.run.passives.push(
      { id: "glass", level: 5 },
      { id: "wick", level: 5 },
    );
    world.state.run.player.y = 100;
    step(world);
    const [first] = world.state.run.zones;
    expect(first).toMatchObject({ orbit: 180, radius: 30, damage: 37.5 });
    expect(first.angle).toBeCloseTo(3, 9);
    expect(first.x).toBeCloseTo(180 * Math.cos(Math.PI / 60), 9);
    expect(first.y).toBeCloseTo(100 + 180 * Math.sin(Math.PI / 60), 9);
  });

  it("respaces from the lowest id's angle when Mirror changes the amount", () => {
    const world = playing(["chandelier", 1]);
    step(world, 11);
    const before = world.state.run.zones;
    expect(before[0].angle).toBeCloseTo(30, 9);
    world.state.run.passives.push({ id: "mirror", level: 1 });
    step(world);
    const set = world.state.run.zones;
    expect(set).toHaveLength(5);
    expect(set.map((zone) => zone.id)).toEqual([4, 5, 6, 7, 8]);
    expect(set.every((zone) => zone.hits.length === 0)).toBe(true);
    expect(set.map((zone) => zone.angle)).toEqual(
      [0, 72, 144, 216, 288].map((offset) => expect.closeTo(30 + offset, 9)),
    );
  });

  it("is removed on the next playing tick Chandelier is gone, and returns after a clear", () => {
    const world = playing(["chandelier", 1]);
    step(world);
    world.state.run.zones = [];
    step(world);
    expect(world.state.run.zones.map((zone) => zone.id)).toEqual([4, 5, 6, 7]);
    world.state.run.weapons = [];
    step(world);
    expect(world.state.run.zones).toEqual([]);
  });
});

describe("Lantern's set", () => {
  it("is re-centered about the player each tick with the orbit it was created with", () => {
    const world = playing(["lantern", 1]);
    world.state.switches.weaponFire = true;
    step(world);
    world.state.switches.weaponFire = false;
    world.state.run.passives.push({ id: "glass", level: 5 });
    world.state.run.player.x = 1000;
    world.state.switches.effectMotion = false;
    step(world);
    expect(world.state.run.zones[0]).toMatchObject({
      x: 1090,
      y: 0,
      orbit: 90,
      radius: 14,
      angle: 0,
    });
  });
});
