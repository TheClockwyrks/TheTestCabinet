// Wick — instrumentation/overlay-sources: the debug overlay reports the
// registered diagnostics, each with the live value the snapshot reports.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Diagnostics": "Register at least the current `screen`, the run clock, the
// level with `xp` over `xpToNext`, `hp` over `maxHp`, the kill count, the
// lamplighter's position and facing, the enemy count with the spawn window
// index, the projectile and zone counts, the gem count, the held weapons with
// their levels and cooldowns, the held passives with their levels,
// `pendingLevelUps`, and the nine driver switches, the same facts the
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
// at 2, Bellows at 4 and Tallow at 2, six level-ups queued, and six
// switches off beside three on. The overlay is shown for the still.
//
// THE NINE SWITCHES ARE READ AS A DEPENDENCE. The specification names each
// switch as a fact "the snapshot reports" and fixes no spelling for a reading
// of one: a build may register the boolean itself, which the panel draws as
// `true`, or a word of its own — `on`, `enabled`, `yes`, a `1`, a tick — and no
// list of the words is complete, so a list would fail a build that spelled an
// honest reading some other way. What CAN be decided is that each switch
// reaches the panel: the readings are taken before and after the switch is
// flipped through its own operation, and one of them must change that did not
// change between two readings taken with nothing flipped, which is what a
// source that ticks on its own — a clock, a frame count, which "Register at
// least" permits — would otherwise answer with. A reading is known by the name
// it was registered under and its rank among readings of that name, and
// compared by the text the panel would draw for it. Each switch is put back as
// it was, so the nine readings are taken over the one posed run.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import { clockText, xpToNext } from "../constants";
import {
  SWITCH_NAMES,
  captureStill,
  createHarness,
  hasToken,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placeProjectile,
  placePuddle,
  setSwitch,
  switchesOf,
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

/**
 * The separators a build may set between the digit triples of a figure.
 *
 * `Number.prototype.toLocaleString` groups by default and the panel's wording is
 * the build's, so `1,234` and `1234` are one figure written two ways. ASCII
 * space is deliberately absent: a panel's readings are read as separate lines
 * and a build sets its own spacing within one, so accepting it would read the
 * two figures of `40 130` as the single figure `40130`. `.` is absent because it
 * is the decimal point, and a build writing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One number a line carries: a grouped figure, or a plain one. */
const NUMBER = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every separator in a written figure, for reading it back as its digits. */
const GROUPS = new RegExp(GROUP, "g");

/** Every number a line carries, a grouped figure read as the one figure it is. */
function numbersIn(line: string): number[] {
  return (line.match(NUMBER) ?? []).map((written) =>
    Number(written.replace(GROUPS, "")),
  );
}

/** A reading's value as the panel draws it (`engine/diagnostics.md`). */
function valueText(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  return String(value);
}

/** What the engine hands back for one read of every registered source. */
type Readings = ReturnType<Harness["diagnostics"]>;

/**
 * Every reading of one read, under a name that outlives its value: the name it
 * was registered under and its rank among readings of that name, so two
 * sources a build registered under one name are still told apart.
 */
function readingsByName(readings: Readings): Map<string, string> {
  const ranks = new Map<string, number>();
  const named = new Map<string, string>();
  for (const reading of readings) {
    const rank = ranks.get(reading.name) ?? 0;
    ranks.set(reading.name, rank + 1);
    named.set(
      `${reading.name}\u0000${String(rank)}`,
      reading.error ?? valueText(reading.value),
    );
  }
  return named;
}

/** The names of every reading the two reads disagree on, either way round. */
function changedReadings(a: Readings, b: Readings): Set<string> {
  const namedA = readingsByName(a);
  const namedB = readingsByName(b);
  const changed = new Set<string>();
  for (const [name, text] of namedA) {
    if (namedB.get(name) !== text) changed.add(name);
  }
  for (const [name, text] of namedB) {
    if (namedA.get(name) !== text) changed.add(name);
  }
  return changed;
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
  // `isolate` turned all nine switches off; the three on are turned on by
  // name, which leaves six off and three on for the panel to report.
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

  // The nine switches, each as a dependence. The control pair first: two reads
  // with nothing flipped, and whatever differs between them is what the panel
  // moves on its own, which no switch's reading may rest on.
  const restless = changedReadings(readings, h.diagnostics());
  const posed = switchesOf(s);
  for (const name of SWITCH_NAMES) {
    const before = h.diagnostics();
    setSwitch(h, name, !posed[name]);
    const after = h.diagnostics();
    setSwitch(h, name, posed[name]);
    const answers = [...changedReadings(before, after)].some(
      (reading) => !restless.has(reading),
    );
    assertTrue(
      answers,
      `a reading that changes when the ${name} switch is flipped from ` +
        `${String(posed[name])} through its own operation and holds still ` +
        `with nothing flipped (${String(restless.size)} reading(s) moved on ` +
        `their own), so a source reports it (specs/instrumentation.md, ` +
        `Diagnostics: the nine driver switches)`,
    );
  }
});
