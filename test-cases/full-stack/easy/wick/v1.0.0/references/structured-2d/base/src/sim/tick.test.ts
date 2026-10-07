import { describe, expect, it } from "vitest";
import {
  BASE_WEAPON_IDS,
  ENEMY_IDS,
  EVOLUTION_IDS,
  PASSIVES,
  PASSIVE_IDS,
  type CueName,
} from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type WickState } from "../state";
import { spawnEnemy } from "./enemies";
import { tick } from "./tick";

describe("a long night", () => {
  it("runs a full loadout over a crowd without a figure going astray", () => {
    const state: WickState = initialState();
    state.run = freshRun();
    state.screen = "playing";
    // The crowd closes in and the director adds to it; what the night tests
    // is the shapes, so the lamplighter is spared the contact.
    state.enemyContact = false;
    state.run.weapons = (
      ["pyre", "beacon", "hail", "chandelier", "corona", "blaze"] as const
    ).map((id) => ({ id, level: 1, cooldown: 0, cooldownSet: 0 }));
    state.run.passives = PASSIVE_IDS.slice(0, 6).map((id) => ({
      id,
      level: PASSIVES[id].maxLevel,
    }));
    const rng = new Rng();
    const cues = new Set<CueName>();
    for (let i = 0; i < 120; i += 1) {
      const type = ENEMY_IDS[i % ENEMY_IDS.length];
      spawnEnemy(state.run, type, 500 * Math.cos(i), 500 * Math.sin(i));
    }
    const held = { up: 0, down: 0, left: 0, right: 1 };
    for (let i = 0; i < 1800 && state.screen === "playing"; i += 1) {
      tick(state, rng, held, cues);
      const screen: string = state.screen;
      if (screen === "levelup") {
        state.run.pendingLevelUps = 0;
        state.run.offers = [];
        state.screen = "playing";
      } else if (screen === "chest") {
        state.run.chestResult = null;
        state.screen = "playing";
      }
    }
    expect(state.screen).toBe("playing");
    expect(state.run.kills).toBeGreaterThan(10);
    const live = new Set(state.run.enemies.map((enemy) => enemy.id));
    for (const shape of [...state.run.projectiles, ...state.run.zones]) {
      expect(Number.isFinite(shape.x) && Number.isFinite(shape.y)).toBe(true);
      for (const hit of shape.hits) expect(live.has(hit.enemy)).toBe(true);
    }
    expect(state.run.zones.filter((zone) => zone.kind === "aura")).toHaveLength(
      1,
    );
    expect(
      state.run.zones.filter((zone) => zone.weapon === "chandelier"),
    ).toHaveLength(6);
    const base = state.run.weapons.map((weapon) => weapon.id);
    for (const id of BASE_WEAPON_IDS) expect(base).not.toContain(id);
    for (const id of EVOLUTION_IDS) expect(base).toContain(id);
  });
});
