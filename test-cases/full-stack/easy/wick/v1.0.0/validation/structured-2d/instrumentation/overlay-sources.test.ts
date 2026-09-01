// Wick — instrumentation/overlay-sources: the debug overlay reports the
// registered diagnostics, each with the live value the snapshot reports.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Diagnostics": "Register at least the current `screen`, the run clock, the
// level with `xp` over `xpToNext`, `hp` over `maxHp`, the kill count, the
// lamplighter's position and facing, the enemy count with the spawn window
// index, the projectile and zone counts, the gem count, the held weapons with
// their levels and cooldowns, the held passives with their levels,
// `pendingLevelUps`, and the seven driver switches, the same facts the
// snapshot reports"; "through `world.diagnostics` in the game mode's
// `beginPlay`. Each source is a function of no arguments ... read the live
// state at the call". The engine's `engine.diagnostics()` evaluates every
// registered source, and the panel draws each as `name: value`
// (`engine/diagnostics.md`), which is what the reading is checked against.
//
// THE READING. The names and the formatting are the build's, so each fact is
// looked for as a whole token of the panel's text (`name: value` per source,
// numbers formatted as the panel formats them) after a run is posed with
// figures that a token search tells apart: tick 4500 (a `1:15` clock and
// window 2), level 7 with xp 12 over 65, hp 37 over 130 (Tallow 2), 253
// kills, the lamplighter at (311, -127) facing left, four enemies, three
// projectiles, two zones, five gems, Ember at 3 with a 0.7 s timer and Pin
// at 2, Bellows at 4 and Tallow at 2, six level-ups queued, and four
// switches off beside three on. The overlay is shown for the still.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import { clockText, xpToNext } from "../constants";
import {
  SWITCH_NAMES,
  captureStill,
  createHarness,
  disable,
  hasToken,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placeProjectile,
  placePuddle,
  toggleOverlay,
  type Harness,
} from "../harness";

const TICK = 4500;
const LEVEL = 7;
const XP = 12;
const HP = 37;
const KILLS = 253;
const PLAYER_X = 311;
const PLAYER_Y = -127;
const QUEUED = 6;
const EMBER_LEVEL = 3;
const EMBER_COOLDOWN = 0.7;
const PIN_LEVEL = 2;
const BELLOWS = 4;
const TALLOW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** How far a cooldown drawn to one decimal or more may sit from the timer. */
const COOLDOWN_TOL = 0.05;

/** The lines that name `id`, case-insensitively. */
function linesNaming(lines: readonly string[], id: string): string[] {
  const wanted = id.toLowerCase();
  return lines.filter((line) => line.toLowerCase().includes(wanted));
}

/** Every number a line carries. */
function numbersIn(line: string): number[] {
  return (line.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** A reading's value as the panel draws it (`engine/diagnostics.md`). */
function valueText(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  return String(value);
}

it("reports every listed fact with the snapshot's live value", async () => {
  isolate(h, { level: LEVEL });
  h.debug.setTick(TICK);
  h.debug.setXp(XP);
  holdPassive(h, "bellows", BELLOWS);
  holdPassive(h, "tallow", TALLOW);
  h.debug.setHp(HP);
  h.debug.setKills(KILLS);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  h.debug.setFacing("left");
  h.debug.setPendingLevelUps(QUEUED);
  const ember = holdWeapon(h, "ember", EMBER_LEVEL);
  h.debug.setWeaponCooldown(ember, EMBER_COOLDOWN);
  holdWeapon(h, "pin", PIN_LEVEL);
  for (const [x, y] of [
    [600, 0],
    [-600, 0],
    [0, 600],
    [0, -600],
  ]) {
    placeEnemy(h, "moth", PLAYER_X + x, PLAYER_Y + y);
  }
  for (const y of [100, 200, 300])
    placeProjectile(h, "ember", PLAYER_X + 100, PLAYER_Y + y, 0, 0, 0);
  placePuddle(h, "oil-splash", PLAYER_X + 400, PLAYER_Y);
  placePuddle(h, "oil-splash", PLAYER_X - 400, PLAYER_Y);
  for (const x of [200, 250, 300, 350, 400])
    placeGem(h, "small", PLAYER_X + x, PLAYER_Y - 200);
  disable(h, "spawning", "despawning", "enemyContact", "effectMotion");
  // `isolate` turned every switch off; the three on are turned on by name.
  h.debug.setEvents(true);
  h.debug.setEnemyMotion(true);
  h.debug.setWeaponFire(true);

  const s = h.snapshot();
  const readings = h.diagnostics();
  const lines = readings.map(
    (reading) =>
      `${reading.name}: ${reading.error ?? valueText(reading.value)}`,
  );
  const text = lines.join("\n");

  // The panel drawn over the posed run, for the still.
  await toggleOverlay(h);
  captureStill(h, "sources");

  assertGreaterThanOrEqual(readings.length, 1, "diagnostic sources registered");
  const facts: Array<[string, string]> = [
    ["the screen", s.screen],
    ["the run clock", clockText(TICK)],
    ["the level", String(LEVEL)],
    ["xp", String(XP)],
    ["xpToNext", String(xpToNext(LEVEL))],
    ["hp", String(HP)],
    ["maxHp", String(s.run.maxHp)],
    ["the kill count", String(KILLS)],
    ["the lamplighter's x", String(PLAYER_X)],
    ["the lamplighter's y", String(PLAYER_Y)],
    ["facing", "left"],
    ["the enemy count", String(s.run.enemies.length)],
    ["the spawn window", String(s.run.spawnWindow)],
    ["the projectile count", String(s.run.projectiles.length)],
    ["the zone count", String(s.run.zones.length)],
    ["the gem count", String(s.run.gems.length)],
    ["pendingLevelUps", String(QUEUED)],
  ];
  for (const [what, token] of facts) {
    assertTrue(
      hasToken(lines, token),
      `${what} (${token}) among the overlay's lines`,
    );
  }
  // A held item's line is the build's to format ("ember L3 0.70s" and
  // "ember, level 3, 0.7 s" are both a line), so its level and its cooldown
  // are looked for on the lines that name the item: the level as a digit run
  // and the cooldown as a number the line carries within 0.05 of the timer,
  // which a reading to one decimal or more satisfies.
  for (const weapon of s.run.weapons) {
    const naming = linesNaming(lines, weapon.id);
    assertGreaterThanOrEqual(
      naming.length,
      1,
      `lines naming held weapon ${weapon.id}`,
    );
    assertTrue(
      naming.some((line) => line.includes(String(weapon.level))),
      `${weapon.id}'s level (${weapon.level}) on a line naming it`,
    );
    assertTrue(
      naming.some((line) =>
        numbersIn(line).some(
          (n) => Math.abs(n - weapon.cooldown) <= COOLDOWN_TOL,
        ),
      ),
      `${weapon.id}'s cooldown (${weapon.cooldown}) on a line naming it`,
    );
  }
  for (const passive of s.run.passives) {
    const naming = linesNaming(lines, passive.id);
    assertGreaterThanOrEqual(
      naming.length,
      1,
      `lines naming held passive ${passive.id}`,
    );
    assertTrue(
      naming.some((line) => line.includes(String(passive.level))),
      `${passive.id}'s level (${passive.level}) on a line naming it`,
    );
  }
  for (const name of SWITCH_NAMES) {
    assertTrue(
      text.toLowerCase().includes(name.toLowerCase()),
      `switch ${name} named among the overlay's lines`,
    );
  }
  const offs = text.match(/\b(false|off)\b/gi)?.length ?? 0;
  const ons = text.match(/\b(true|on)\b/gi)?.length ?? 0;
  assertGreaterThanOrEqual(offs, 4, "off readings for the four switches off");
  assertGreaterThanOrEqual(ons, 3, "on readings for the three switches on");
});
