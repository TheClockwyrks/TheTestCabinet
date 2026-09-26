import { describe, expect, it } from "vitest";
import {
  CHEST_HEAL,
  EVOLUTIONS,
  EVOLUTION_IDS,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  type CueName,
  type PassiveId,
  type WeaponId,
} from "../constants";
import { Rng } from "../rng";
import { NOTHING_HELD, freshRun, initialState, type WickState } from "../state";
import { spawnEnemy } from "./enemies";
import { tick } from "./tick";
import { baseOf, evolutionOf, pairedIds } from "./weapons";

interface World {
  state: WickState;
  rng: Rng;
  cues: Set<CueName>;
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
  state.spawning = false;
  state.events = false;
  state.despawning = false;
  state.enemyMotion = false;
  state.enemyContact = false;
  return { state, rng: new Rng(), cues: new Set() };
}

function hold(world: World, id: PassiveId, level: number): void {
  world.state.run.passives.push({ id, level });
}

function step(world: World, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, NOTHING_HELD, world.cues);
  }
}

/** Drop a chest at the lamplighter's center, to be collected by the tick. */
function chest(world: World): void {
  const { run } = world.state;
  run.pickups.push({
    id: run.nextId,
    kind: "chest",
    x: run.player.x,
    y: run.player.y,
  });
  run.nextId += 1;
}

describe("the recipes", () => {
  it("pair each evolution with its base and its passive", () => {
    expect([...EVOLUTION_IDS]).toEqual([
      "pyre",
      "beacon",
      "hail",
      "chandelier",
      "corona",
      "blaze",
    ]);
    expect(EVOLUTIONS).toEqual({
      pyre: { from: "taper", passive: "wick" },
      beacon: { from: "ember", passive: "oil" },
      hail: { from: "pin", passive: "mirror" },
      chandelier: { from: "lantern", passive: "glass" },
      corona: { from: "halo", passive: "tinder" },
      blaze: { from: "oil-splash", passive: "soot" },
    });
    for (const id of EVOLUTION_IDS) {
      expect(evolutionOf(baseOf(id))).toBe(id);
      expect(pairedIds(id)).toEqual([id, baseOf(id)]);
      expect(pairedIds(baseOf(id))).toEqual([baseOf(id), id]);
    }
  });

  it("each evolve through a collected chest, in the same slot, ready to fire", () => {
    for (const id of EVOLUTION_IDS) {
      const { from, passive } = EVOLUTIONS[id];
      const world = playing(["spark", 3], [from, MAX_WEAPON_LEVEL]);
      world.state.run.weapons[1].cooldown = 1.5;
      hold(world, passive, 1);
      // A target for the weapons that need one, far from dying.
      spawnEnemy(world.state.run, "owl", 400, 0);
      chest(world);
      step(world);
      expect(world.state.screen, id).toBe("chest");
      expect(world.state.run.chestResult, id).toEqual({
        kind: "evolve",
        weapon: id,
      });
      expect(world.state.run.weapons, id).toEqual([
        expect.objectContaining({ id: "spark", level: 3 }),
        expect.objectContaining({ id, level: 1, cooldown: 0 }),
      ]);
      expect(world.state.run.passives, id).toEqual([{ id: passive, level: 1 }]);
      expect(world.cues.has("evolve"), id).toBe(true);
      expect(world.cues.has("chest"), id).toBe(true);
      // Closing the overlay, the evolved weapon fires on the first tick.
      world.state.screen = "playing";
      world.state.run.chestResult = null;
      const before = world.state.run.nextId;
      step(world);
      if (id === "corona") {
        const auras = world.state.run.zones.filter(
          (zone) => zone.kind === "aura",
        );
        expect(
          auras.map((zone) => zone.weapon),
          id,
        ).toEqual(["corona"]);
      } else {
        expect(world.state.run.nextId, id).toBeGreaterThan(before);
      }
    }
  });

  it("need the base at MAX_WEAPON_LEVEL and the recipe's own passive", () => {
    const world = playing(["taper", MAX_WEAPON_LEVEL - 1]);
    hold(world, "wick", 5);
    chest(world);
    step(world);
    expect(world.state.run.chestResult).toEqual({
      kind: "level",
      item: "taper",
      level: MAX_WEAPON_LEVEL,
    });
    const other = playing(["taper", MAX_WEAPON_LEVEL]);
    hold(other, "oil", 1);
    chest(other);
    step(other);
    expect(other.state.run.chestResult?.kind).toBe("level");
    expect(other.state.run.weapons[0].id).toBe("taper");
  });

  it("evolve the first eligible slot alone, leaving the next for another chest", () => {
    const world = playing(
      ["ember", MAX_WEAPON_LEVEL],
      ["pin", MAX_WEAPON_LEVEL],
    );
    hold(world, "oil", 2);
    hold(world, "mirror", 1);
    chest(world);
    step(world);
    expect(world.state.run.weapons.map((weapon) => weapon.id)).toEqual([
      "beacon",
      "pin",
    ]);
    world.state.screen = "playing";
    chest(world);
    step(world);
    expect(world.state.run.weapons.map((weapon) => weapon.id)).toEqual([
      "beacon",
      "hail",
    ]);
  });
});

describe("a chest's other results", () => {
  it("levels one held item below its max, drawn at random", () => {
    const world = playing(["taper", 4], ["pin", MAX_WEAPON_LEVEL]);
    hold(world, "brass", 3);
    hold(world, "tallow", 1);
    world.state.run.player.hp = 50;
    const seen = new Set<string>();
    for (let opened = 1; opened <= 40; opened += 1) {
      world.state.screen = "playing";
      world.state.run.weapons[0].level = 4;
      world.state.run.passives[1].level = 1;
      world.state.run.player.hp = 50;
      chest(world);
      step(world);
      const result = world.state.run.chestResult;
      expect(result?.kind).toBe("level");
      if (result?.kind !== "level") continue;
      seen.add(result.item);
      if (result.item === "taper") {
        expect(result.level).toBe(5);
        expect(world.state.run.weapons[0].level).toBe(5);
        expect(world.state.run.player.hp).toBe(50);
      } else {
        expect(result).toEqual({ kind: "level", item: "tallow", level: 2 });
        expect(world.state.run.passives[1].level).toBe(2);
        expect(world.state.run.player.hp).toBe(65);
      }
    }
    expect([...seen].sort()).toEqual(["tallow", "taper"]);
  });

  it("levels the posed nextChestItem when it is held below its max", () => {
    const world = playing(["taper", 4], ["pin", MAX_WEAPON_LEVEL]);
    hold(world, "brass", 3);
    hold(world, "tallow", 1);
    for (let opened = 0; opened < 10; opened += 1) {
      world.state.screen = "playing";
      world.state.run.weapons[0].level = 4;
      world.state.run.nextChestItem = "taper";
      chest(world);
      step(world);
      expect(world.state.run.chestResult).toEqual({
        kind: "level",
        item: "taper",
        level: 5,
      });
      expect(world.state.run.nextChestItem).toBeNull();
    }
  });

  it("discards a posed item that is maxed or not held, and draws instead", () => {
    const world = playing(["pin", MAX_WEAPON_LEVEL]);
    hold(world, "brass", 1);
    for (const posed of ["pin", "brass", "ember", "wick"] as const) {
      world.state.screen = "playing";
      world.state.run.passives[0].level = 1;
      world.state.run.nextChestItem = posed;
      chest(world);
      step(world);
      expect(world.state.run.chestResult).toEqual({
        kind: "level",
        item: "brass",
        level: 2,
      });
      expect(world.state.run.nextChestItem).toBeNull();
    }
  });

  it("consumes a posed item on a chest that evolves or heals", () => {
    const evolving = playing(["taper", MAX_WEAPON_LEVEL]);
    hold(evolving, "wick", 1);
    evolving.state.run.nextChestItem = "wick";
    chest(evolving);
    step(evolving);
    expect(evolving.state.run.chestResult?.kind).toBe("evolve");
    expect(evolving.state.run.nextChestItem).toBeNull();

    const healing = playing(["spark", MAX_WEAPON_LEVEL]);
    healing.state.run.player.hp = 10;
    healing.state.run.nextChestItem = "spark";
    chest(healing);
    step(healing);
    expect(healing.state.run.chestResult).toEqual({ kind: "heal" });
    expect(healing.state.run.nextChestItem).toBeNull();
  });

  it("passes over a max-level weapon that has no recipe", () => {
    for (const id of ["spark", "shard", "sconce", "flare"] as const) {
      expect(evolutionOf(id)).toBeNull();
      expect(pairedIds(id)).toEqual([id]);
    }
    const world = playing(["spark", MAX_WEAPON_LEVEL], ["taper", 2]);
    hold(world, "wick", PASSIVES.wick.maxLevel);
    chest(world);
    step(world);
    expect(world.state.run.chestResult).toEqual({
      kind: "level",
      item: "taper",
      level: 3,
    });
    expect(world.state.run.weapons.map((weapon) => weapon.id)).toEqual([
      "spark",
      "taper",
    ]);
    expect(world.cues.has("evolve")).toBe(false);
  });

  it("heals CHEST_HEAL, capped at maxHp, when nothing can level", () => {
    const world = playing(["taper", MAX_WEAPON_LEVEL], ["corona", 1]);
    for (const id of ["brass", "mirror"] as const) {
      hold(world, id, PASSIVES[id].maxLevel);
    }
    world.state.run.player.hp = 60;
    chest(world);
    step(world);
    expect(world.state.run.chestResult).toEqual({ kind: "heal" });
    expect(world.state.run.player.hp).toBe(60 + CHEST_HEAL);
    world.state.screen = "playing";
    world.state.run.player.hp = 90;
    chest(world);
    step(world);
    expect(world.state.run.player.hp).toBe(100);
  });
});

describe("what an evolution is", () => {
  it("passes its fixed row through the derived stats when it fires", () => {
    const world = playing(["beacon", 1]);
    hold(world, "wick", 3);
    hold(world, "glass", 2);
    hold(world, "mirror", 2);
    hold(world, "oil", 1);
    world.state.run.enemies.push(
      ...[100, 200, 300].map((x, i) => ({
        id: 100 + i,
        type: "owl" as const,
        x,
        y: 0,
        hp: 2000,
        maxHp: 2000,
        heading: { x: -1, y: 0 },
        age: 0,
        contactCooldown: 0,
      })),
    );
    step(world);
    const bolts = world.state.run.projectiles;
    expect(bolts).toHaveLength(3);
    expect(bolts[0]).toMatchObject({
      damage: 26,
      radius: 12,
      pierce: 2,
      ttl: 2,
      vx: 500,
    });
    expect(world.state.run.weapons[0].cooldown).toBeCloseTo(0.23, 9);
  });
});
