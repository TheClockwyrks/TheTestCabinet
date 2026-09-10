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
// THE READING. The names and the formatting are the build's, so a fact the
// specification names as a NUMBER is looked for as a figure some line of the
// panel carries, and a fact it names as a WORD as a whole token of the panel's
// text. A held item's level and cooldown are read on the lines that NAME the
// item, so two items at one level are still told apart.
//
// WHY THE POSE COLLIDES WITH NOTHING. A figure is looked for across the whole
// panel, so a run posed with one figure twice — an enemy count of four beside a
// passive at level 4 — lets one line answer for a fact the panel left out
// altogether. Every figure this point requires is therefore posed to a value no
// other number of the posed run carries, the clock's own spellings included:
// tick 19800 (a `5:30` clock, 330 seconds, window 11), level 7 with xp 12 over
// 65, hp 37 over 130, 253 kills, the lamplighter at (311, -127) facing left,
// six enemies, eight projectiles, nine zones, ten gems, and thirteen level-ups
// queued. The loadout takes the small levels those leave free, and is read on
// the lines that name each item rather than across the panel: Ember at 3 with a
// 0.7 s timer and Pin at 2, Bellows at 4 and Tallow at 2 — whose two levels of
// `+15` max health are what put `maxHp` at 130. Six switches are off beside
// three on. The overlay is shown for the still.
//
// THE CLOCK IS THE ONE FIGURE WITH A UNIT OF ITS OWN. `specs/state.md` fixes
// the run clock as `tick / TICK_HZ` seconds and nothing fixes how a panel
// writes it, so `5:30`, `330`, `330.00s` and the tick count `19800` are one
// clock written four ways; the `m:ss` of `specs/ui.md` is what the HUD draws,
// not what this panel must. It is therefore looked for as any of them, a
// written second within half of the clock's, which is what rounding to a whole
// second moves it by. Half a second is wide enough for an unrelated figure to
// fall inside, so the clock is read TWICE, at two posed ticks far apart —
// `setTick` "Sets `tick` to `tick`" and the clock follows it — and the SAME
// reading has to answer both. A reading is known across the two reads by its
// line with every figure struck out, so `clock: 5:30 (tick 19800)` and
// `clock: 3:45 (tick 13500)` are one reading of one source, while a figure
// that merely fell within half a second of the first clock — a max health, a
// kill count — is not asked for the second and could not give it.
//
// THE NINE SWITCHES ARE READ AS A DEPENDENCE. The specification names each
// switch as a fact "the snapshot reports" and fixes no spelling for a reading
// of one: a build may register the boolean itself, which the panel draws as
// `true`, or a word of its own — `on`, `enabled`, `yes`, a `1`, a tick — and no
// list of the words is complete, so a list would fail a build that spelled an
// honest reading some other way. Its LABEL is no more fixed than its value —
// `specs/instrumentation.md` asks only that each source be registered and
// "short enough to read on a line", so a line reading `spawn true events true`
// names the same two switches a line reading `spawning: true` does. What CAN
// be decided is that each switch reaches the panel: the readings are taken
// before and after the switch is flipped through its own operation, and one of
// them must change that did not
// change between two readings taken with nothing flipped, which is what a
// source that ticks on its own — a clock, a frame count, which "Register at
// least" permits — would otherwise answer with. A reading is known by the name
// it was registered under and its rank among readings of that name, and
// compared by the text the panel would draw for it. Each switch is put back as
// it was, so the nine readings are taken over the one posed run.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import { TICK_HZ, clockText, xpToNext } from "../constants";
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

const TICK = 19800;
const LEVEL = 7;
const XP = 12;
const HP = 37;
const KILLS = 253;
const PLAYER_X = 311;
const PLAYER_Y = -127;
const QUEUED = 13;
const EMBER_LEVEL = 3;
const EMBER_COOLDOWN = 0.7;
const PIN_LEVEL = 2;
const BELLOWS = 4;
const TALLOW = 2;

/**
 * The four counts, each posed to a figure no other number of the run carries,
 * so the line that answers for one of them is the line that reports it.
 */
const ENEMIES = 6;
const PROJECTILES = 8;
const ZONES = 9;
const GEMS = 10;

/**
 * The second tick the clock is read at, a minute and three quarters before the
 * first, and inside the `0 … 35999` `setTick` takes.
 */
const TICK_B = 13500;

/**
 * How far a second written on a line may sit from the clock's and still be it:
 * half a second, which is what rounding or truncating a figure to a whole
 * number of seconds moves it by, and what a figure drawn to one decimal or
 * more sits well inside.
 */
const CLOCK_TOLERANCE = 0.5;

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

/**
 * Whether some line carries `figure` as a figure of its own.
 *
 * The specification fixes the FACTS and not their wording, so a panel writing
 * a level as `L7`, `lv 7` or `7` reports the same seven; what it may not do is
 * leave it out, and `17` or `0.7` is not a seven. A line is therefore read as
 * the figures it carries — {@link numbersIn} reads a grouped figure as the one
 * figure it is — rather than as text a token search walks, which would take a
 * letter written against the digits for part of them.
 */
function showsFigure(lines: readonly string[], figure: number): boolean {
  return lines.some((line) =>
    numbersIn(line).some((written) => written === figure),
  );
}

/**
 * One line with every figure it carries struck out: what a reading is known by
 * across two reads at two clocks, so `clock: 5:30 (tick 19800)` and
 * `clock: 3:45 (tick 13500)` are one reading and `hp: 37.0 / 130` is another.
 */
function shapeOf(line: string): string {
  return line.replace(NUMBER, "#");
}

/**
 * The shapes of the lines that show the run clock at `tick`: as `m:ss`, as the
 * seconds `tick / TICK_HZ` however they are written, or as the tick count.
 */
function clockShapes(lines: readonly string[], tick: number): Set<string> {
  const seconds = tick / TICK_HZ;
  const shapes = new Set<string>();
  for (const line of lines) {
    const shows =
      hasToken([line], clockText(tick)) ||
      hasToken([line], String(tick)) ||
      numbersIn(line).some(
        (written) => Math.abs(written - seconds) <= CLOCK_TOLERANCE,
      );
    if (shows) shapes.add(shapeOf(line));
  }
  return shapes;
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
  for (let i = 0; i < ENEMIES; i += 1)
    placeEnemy(h, "moth", PLAYER_X + 600, PLAYER_Y - 250 + i * 100);
  for (let i = 0; i < PROJECTILES; i += 1)
    placeProjectile(h, "ember", PLAYER_X + 100, PLAYER_Y + 60 * i, 0, 0, 0);
  for (let i = 0; i < ZONES; i += 1)
    placePuddle(h, "oil-splash", PLAYER_X - 700 + i * 140, PLAYER_Y + 500);
  for (let i = 0; i < GEMS; i += 1)
    placeGem(h, "small", PLAYER_X + 200 + i * 50, PLAYER_Y - 200);
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

  // The panel drawn over the posed run, for the still.
  await toggleOverlay(h);
  captureStill(h, "sources");

  assertGreaterThanOrEqual(readings.length, 1, "diagnostic sources registered");
  const clockAt = clockShapes(lines, TICK);
  assertTrue(
    clockAt.size > 0,
    `the run clock (${clockText(TICK)}, ${String(TICK / TICK_HZ)}s, or tick ` +
      `${String(TICK)}) among the overlay's lines`,
  );
  // The clock again, at a tick far from the first, and on the SAME reading: a
  // figure that merely sat within half a second of the first clock is not the
  // clock, and its line does not follow the clock to the second tick.
  h.debug.setTick(TICK_B);
  const later = h
    .diagnostics()
    .map(
      (reading) =>
        `${reading.name}: ${reading.error ?? valueText(reading.value)}`,
    );
  h.debug.setTick(TICK);
  assertTrue(
    [...clockShapes(later, TICK_B)].some((shape) => clockAt.has(shape)),
    `the reading that showed the run clock at ${clockText(TICK)} showing it ` +
      `at ${clockText(TICK_B)} (${String(TICK_B / TICK_HZ)}s, or tick ` +
      `${String(TICK_B)}) too, with the clock posed there`,
  );
  const words: Array<[string, string]> = [
    ["the screen", s.screen],
    ["facing", "left"],
  ];
  for (const [what, token] of words) {
    assertTrue(
      hasToken(lines, token),
      `${what} (${token}) among the overlay's lines`,
    );
  }
  const figures: Array<[string, number]> = [
    ["the level", LEVEL],
    ["xp", XP],
    ["xpToNext", xpToNext(LEVEL)],
    ["hp", HP],
    ["maxHp", s.run.maxHp],
    ["the kill count", KILLS],
    ["the lamplighter's x", PLAYER_X],
    ["the lamplighter's y", PLAYER_Y],
    ["the enemy count", s.run.enemies.length],
    ["the spawn window", s.run.spawnWindow],
    ["the projectile count", s.run.projectiles.length],
    ["the zone count", s.run.zones.length],
    ["the gem count", s.run.gems.length],
    ["pendingLevelUps", QUEUED],
  ];
  for (const [what, figure] of figures) {
    assertTrue(
      showsFigure(lines, figure),
      `${what} (${String(figure)}) among the overlay's lines`,
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
