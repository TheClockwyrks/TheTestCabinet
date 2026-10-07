import { describe, expect, it } from "vitest";
import {
  ALMANAC_ROWS,
  BASE_WEAPON_IDS,
  BREAD_HEAL,
  ENEMIES,
  ENEMY_DESCRIPTIONS,
  ENEMY_IDS,
  EVOLUTION_IDS,
  GEM_VALUES,
  PASSIVES,
  PASSIVE_IDS,
  WEAPON_DESCRIPTIONS,
  WEAPON_NAMES,
} from "./constants";
import { entriesOf, maxScroll, scrollToShow, visibleRows } from "./almanac";

describe("the tabs", () => {
  it("lists the tools, base then evolved, in the tables' order", () => {
    expect(entriesOf(0).map((entry) => entry.name)).toEqual(
      [...BASE_WEAPON_IDS, ...EVOLUTION_IDS].map((id) => WEAPON_NAMES[id]),
    );
  });

  it("lists the trinkets, the enemies, and the pickups in order", () => {
    expect(entriesOf(1).map((entry) => entry.name)).toEqual(
      PASSIVE_IDS.map((id) => PASSIVES[id].name),
    );
    expect(entriesOf(2).map((entry) => entry.name)).toEqual(
      ENEMY_IDS.map((id) => ENEMIES[id].name),
    );
    expect(entriesOf(3)).toHaveLength(6);
  });
});

describe("an entry", () => {
  it("gives a tool the damage and cooldown of its level 1 row", () => {
    const taper = entriesOf(0)[0];
    expect(taper.name).toBe("Taper");
    expect(taper.stats).toEqual([
      { label: "DAMAGE", value: "10" },
      { label: "COOLDOWN", value: "1.35" },
    ]);
    expect(taper.description).toBe(WEAPON_DESCRIPTIONS.taper);
    expect(taper.picture).toEqual({ kind: "weapon", id: "taper" });
  });

  it("gives an evolved tool its fixed row, and Chandelier damage alone", () => {
    const byName = new Map(entriesOf(0).map((entry) => [entry.name, entry]));
    expect(byName.get("Pyre")!.stats).toEqual([
      { label: "DAMAGE", value: "60" },
      { label: "COOLDOWN", value: "1.2" },
    ]);
    expect(byName.get("Chandelier")!.stats).toEqual([
      { label: "DAMAGE", value: "25" },
    ]);
  });

  it("gives a trinket its max level", () => {
    const wick = entriesOf(1)[0];
    expect(wick.stats).toEqual([
      { label: "MAX LEVEL", value: String(PASSIVES.wick.maxLevel) },
    ]);
    expect(wick.picture).toEqual({ kind: "passive", id: "wick" });
  });

  it("gives an enemy its health, speed, and damage", () => {
    const moth = entriesOf(2)[0];
    expect(moth.stats).toEqual([
      { label: "HEALTH", value: String(ENEMIES.moth.hp) },
      { label: "SPEED", value: String(ENEMIES.moth.speed) },
      { label: "DAMAGE", value: String(ENEMIES.moth.damage) },
    ]);
    expect(moth.description).toBe(ENEMY_DESCRIPTIONS.moth);
    expect(moth.picture).toEqual({ kind: "enemy", id: "moth" });
  });

  it("gives a gem its experience, bread its heal, and the rest none", () => {
    const pickups = entriesOf(3);
    expect(pickups[0].stats).toEqual([
      { label: "EXPERIENCE", value: String(GEM_VALUES.small) },
    ]);
    expect(pickups[3]).toMatchObject({ name: "Chest", stats: [] });
    expect(pickups[4].stats).toEqual([
      { label: "HEALS", value: String(BREAD_HEAL) },
    ]);
    expect(pickups[5]).toMatchObject({ name: "Draft", stats: [] });
  });

  it("carries a line for every entry of every tab", () => {
    for (const tab of [0, 1, 2, 3]) {
      for (const entry of entriesOf(tab)) {
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeLessThanOrEqual(72);
      }
    }
  });
});

describe("the window", () => {
  it("shows every entry of a short tab and ALMANAC_ROWS of a long one", () => {
    expect(visibleRows(6, 0)).toBe(6);
    expect(visibleRows(16, 0)).toBe(ALMANAC_ROWS);
    expect(visibleRows(16, 6)).toBe(ALMANAC_ROWS);
    expect(maxScroll(6)).toBe(0);
    expect(maxScroll(16)).toBe(16 - ALMANAC_ROWS);
  });

  it("follows the highlight out of the window and holds while it is inside", () => {
    expect(scrollToShow(0, ALMANAC_ROWS - 1, 16)).toBe(0);
    expect(scrollToShow(0, ALMANAC_ROWS, 16)).toBe(1);
    expect(scrollToShow(3, 3, 16)).toBe(3);
    expect(scrollToShow(3, 2, 16)).toBe(2);
    expect(scrollToShow(0, 15, 16)).toBe(16 - ALMANAC_ROWS);
  });

  it("is held between zero and the end of the list", () => {
    expect(scrollToShow(9, 0, 6)).toBe(0);
    expect(scrollToShow(0, 5, 6)).toBe(0);
  });
});
