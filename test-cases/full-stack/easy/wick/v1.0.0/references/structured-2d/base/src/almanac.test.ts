// What the almanac holds: the four tabs' entries in the order specs/ui.md
// lists them, and the name, the figures, and the one line of copy each entry
// shows. Read straight off `src/constants.ts`, with no engine behind them.

import { describe, expect, it } from "vitest";
import {
  ALMANAC_TABS,
  BASE_WEAPON_IDS,
  BREAD_HEAL,
  ENEMY_IDS,
  EVOLUTION_IDS,
  GEM_TIERS,
  PASSIVE_IDS,
  PICKUP_KINDS,
} from "./constants";
import {
  ALMANAC_ENTRIES,
  descriptionOf,
  entriesOf,
  entryAt,
  nameOf,
  statsOf,
} from "./almanac";

describe("the tabs", () => {
  it("lists every tool, trinket, enemy, and pickup in order", () => {
    expect(ALMANAC_ENTRIES).toHaveLength(ALMANAC_TABS.length);
    expect(entriesOf(0).map((entry) => entry.id)).toEqual([
      ...BASE_WEAPON_IDS,
      ...EVOLUTION_IDS,
    ]);
    expect(entriesOf(1).map((entry) => entry.id)).toEqual([...PASSIVE_IDS]);
    expect(entriesOf(2).map((entry) => entry.id)).toEqual([...ENEMY_IDS]);
    expect(entriesOf(3).map((entry) => entry.id)).toEqual([
      ...GEM_TIERS,
      ...PICKUP_KINDS,
    ]);
  });

  it("holds a tab index within the bar and reports past the end", () => {
    expect(entriesOf(-1)).toBe(entriesOf(0));
    expect(entriesOf(99)).toBe(entriesOf(ALMANAC_TABS.length - 1));
    expect(entryAt(0, 0)).toEqual({ kind: "weapon", id: "taper" });
    expect(entryAt(3, 99)).toBeNull();
  });

  it("names every entry and gives every one a line of its own", () => {
    const lines = new Set<string>();
    for (const tab of ALMANAC_TABS.keys()) {
      for (const entry of entriesOf(tab)) {
        expect(nameOf(entry).length).toBeGreaterThan(0);
        const line = descriptionOf(entry);
        expect(line.length).toBeGreaterThan(0);
        expect(line.length).toBeLessThanOrEqual(72);
        lines.add(line);
      }
    }
    expect(lines.size).toBe(
      BASE_WEAPON_IDS.length +
        EVOLUTION_IDS.length +
        PASSIVE_IDS.length +
        ENEMY_IDS.length +
        GEM_TIERS.length +
        PICKUP_KINDS.length,
    );
  });
});

describe("the figures", () => {
  it("reads a weapon's level 1 row, and Chandelier's damage alone", () => {
    expect(statsOf({ kind: "weapon", id: "taper" })).toEqual([
      { label: "DAMAGE", figure: "10" },
      { label: "COOLDOWN", figure: "1.35s" },
    ]);
    expect(statsOf({ kind: "weapon", id: "pyre" })).toEqual([
      { label: "DAMAGE", figure: "60" },
      { label: "COOLDOWN", figure: "1.2s" },
    ]);
    expect(statsOf({ kind: "weapon", id: "chandelier" })).toEqual([
      { label: "DAMAGE", figure: "25" },
    ]);
  });

  it("reads a trinket's max level and an enemy's three figures", () => {
    expect(statsOf({ kind: "passive", id: "wick" })).toEqual([
      { label: "MAX LEVEL", figure: "5" },
    ]);
    expect(statsOf({ kind: "enemy", id: "moth" })).toEqual([
      { label: "HEALTH", figure: "5" },
      { label: "SPEED", figure: "100" },
      { label: "DAMAGE", figure: "5" },
    ]);
  });

  it("reads a gem's experience and bread's healing, and nothing else", () => {
    expect(statsOf({ kind: "gem", id: "large" })).toEqual([
      { label: "EXPERIENCE", figure: "10" },
    ]);
    expect(statsOf({ kind: "pickup", id: "bread" })).toEqual([
      { label: "HEALS", figure: `${BREAD_HEAL}` },
    ]);
    expect(statsOf({ kind: "pickup", id: "chest" })).toEqual([]);
    expect(statsOf({ kind: "pickup", id: "draft" })).toEqual([]);
  });
});
