import { describe, expect, it } from "vitest";
import {
  almanacEntries,
  clampScroll,
  followHighlight,
  visibleRows,
  wrapTab,
  STAT_LABELS,
} from "./almanac";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  BASE_WEAPON_IDS,
  BREAD_HEAL,
  ENEMIES,
  ENEMY_IDS,
  EVOLUTION_IDS,
  GEM_TIERS,
  PASSIVES,
  PASSIVE_IDS,
  PICKUP_KINDS,
  WEAPON_DESCRIPTIONS,
  WEAPON_NAMES,
} from "./constants";

describe("the almanac's entries", () => {
  it("lists every tab in the order the specification fixes", () => {
    expect(almanacEntries(0).map((entry) => entry.name)).toEqual(
      [...BASE_WEAPON_IDS, ...EVOLUTION_IDS].map((id) => WEAPON_NAMES[id]),
    );
    expect(almanacEntries(1).map((entry) => entry.name)).toEqual(
      PASSIVE_IDS.map((id) => PASSIVES[id].name),
    );
    expect(almanacEntries(2).map((entry) => entry.name)).toEqual(
      ENEMY_IDS.map((id) => ENEMIES[id].name),
    );
    expect(almanacEntries(3).map((entry) => entry.name)).toEqual([
      "Small Gem",
      "Medium Gem",
      "Large Gem",
      "Chest",
      "Bread",
      "Draft",
    ]);
    expect(almanacEntries(ALMANAC_TABS.length)).toEqual([]);
  });

  it("reads a tool's figures off its level one row", () => {
    const taper = almanacEntries(0)[0];
    expect(taper.stats).toEqual([
      { label: STAT_LABELS.damage, value: "10" },
      { label: STAT_LABELS.cooldown, value: "1.35s" },
    ]);
    expect(taper.description).toBe(WEAPON_DESCRIPTIONS.taper);
    expect(taper.picture).toEqual({ of: "tool", weapon: "taper" });
  });

  it("shows damage alone for Chandelier, whose fixed row carries no cooldown", () => {
    const entries = almanacEntries(0);
    const chandelier = entries[BASE_WEAPON_IDS.length + 3];
    expect(chandelier.name).toBe(WEAPON_NAMES.chandelier);
    expect(chandelier.stats).toEqual([
      { label: STAT_LABELS.damage, value: "25" },
    ]);
  });

  it("carries the figures each other tab names", () => {
    expect(almanacEntries(1)[0].stats).toEqual([
      { label: STAT_LABELS.maxLevel, value: String(PASSIVES.wick.maxLevel) },
    ]);
    expect(almanacEntries(2)[0].stats).toEqual([
      { label: STAT_LABELS.health, value: String(ENEMIES.moth.hp) },
      { label: STAT_LABELS.speed, value: String(ENEMIES.moth.speed) },
      { label: STAT_LABELS.damage, value: String(ENEMIES.moth.damage) },
    ]);
    const pickups = almanacEntries(3);
    expect(pickups[0].stats).toEqual([
      { label: STAT_LABELS.experience, value: "1" },
    ]);
    expect(pickups[GEM_TIERS.length].stats).toEqual([]);
    expect(pickups[GEM_TIERS.length + 1].stats).toEqual([
      { label: STAT_LABELS.heals, value: String(BREAD_HEAL) },
    ]);
  });

  it("gives every entry a line of its own", () => {
    for (let tab = 0; tab < ALMANAC_TABS.length; tab += 1) {
      for (const entry of almanacEntries(tab)) {
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeLessThanOrEqual(72);
      }
    }
    expect(almanacEntries(3)).toHaveLength(
      GEM_TIERS.length + PICKUP_KINDS.length,
    );
  });
});

describe("the almanac's window", () => {
  it("wraps the tab at both ends", () => {
    expect(wrapTab(0, 1)).toBe(1);
    expect(wrapTab(0, -1)).toBe(ALMANAC_TABS.length - 1);
    expect(wrapTab(ALMANAC_TABS.length - 1, 1)).toBe(0);
  });

  it("shows every entry of a short tab and a window of a long one", () => {
    expect(visibleRows(6)).toBe(6);
    expect(visibleRows(16)).toBe(ALMANAC_ROWS);
    expect(visibleRows(0)).toBe(0);
  });

  it("holds a scroll between zero and the last row a list can start on", () => {
    expect(clampScroll(-3, 16)).toBe(0);
    expect(clampScroll(4, 16)).toBe(4);
    expect(clampScroll(40, 16)).toBe(16 - ALMANAC_ROWS);
    expect(clampScroll(2, 6)).toBe(0);
  });

  it("follows the highlight from either end", () => {
    expect(followHighlight(0, ALMANAC_ROWS - 1, 16)).toBe(0);
    expect(followHighlight(0, ALMANAC_ROWS, 16)).toBe(1);
    expect(followHighlight(4, 2, 16)).toBe(2);
    expect(followHighlight(0, 15, 16)).toBe(16 - ALMANAC_ROWS);
    expect(followHighlight(3, 0, 6)).toBe(0);
  });
});
