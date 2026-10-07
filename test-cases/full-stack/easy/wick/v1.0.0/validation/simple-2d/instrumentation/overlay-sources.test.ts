// instrumentation/overlay-sources — the shown overlay reports every
// registered diagnostic with the live value the snapshot reports.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics):
// "Register at least the current `screen`, the run clock, the level with `xp`
// over `xpToNext`, `hp` over `maxHp`, the kill count, the lamplighter's
// position and facing, the enemy count with the spawn window index, the
// projectile and zone counts, the gem count, the held weapons with their
// levels and cooldowns, the held passives with their levels,
// `pendingLevelUps`, and the nine driver switches, the same facts the
// snapshot reports".
//
// HOW IT IS READ. The overlay is text the frame draws, so the panel's
// contribution is the multiset difference between a frame with it shown and a
// frame with it hidden; the HUD, drawn alike in both, cancels out, so a HUD
// that shows hp cannot answer for a panel that omits it. The scene is posed
// and then PAUSED, so a queued level-up and a posed tick sit still while
// frames are read. Neither wording nor layout is fixed, so a fact the spec
// names as a number is asked for as a FIGURE some line of the panel carries,
// and a fact it names as a word as a token of the panel's text.
//
// WHY THE POSE COLLIDES WITH NOTHING. A figure is looked for across the whole
// panel, so a run posed with one figure twice — a zone count of 1 beside a
// passive at level 1 — lets one line answer for a fact the panel left out
// altogether. Every figure this point requires is therefore posed to a value
// no other number of the posed run carries, the clock's own spellings and the
// levels of the loadout included: tick 19800 (a `5:30` clock, 330 seconds, and
// window 11 once the posing tick has run), level 7 with xp 12 over 65, hp 43
// over 100, 321 kills, the lamplighter at (300, -120), four enemies, six
// projectiles, thirteen zones, nine gems and three level-ups queued, with Halo
// at 1 and Ember at 8 holding the small levels that leaves.
//
// THE CLOCK is the one figure a panel is free to write in a unit of its own:
// `specs/state.md` fixes it as `tick / TICK_HZ` seconds and nothing fixes how
// it is drawn, so `5:30`, `330`, `330.0s` and the tick count are one clock
// written four ways, and it is looked for as ANY of them, a written second
// within half of the clock's. That half second is wide enough for an unrelated
// figure to fall inside, so the clock is read TWICE, at two posed ticks far
// apart, and the SAME line has to answer both — a line is known across the two
// reads by its shape with every figure struck out, so a figure that merely fell
// within half a second of the first clock, a max health or a kill count, is
// never asked for the second reading and could not give it.
//
// A value whose rendering is free (facing, a level a panel may write as "L8", a
// cooldown, a switch) is read instead as the panel's stable lines CHANGING when
// that one value is flipped through the surface, the panel re-read against a
// fresh hidden frame each time so the game's own text never stands in for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertTrue } from "../assert";
import { clockText, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  holdPassive,
  holdWeapon,
  isolate,
  minusLines,
  pressToggle,
  spawnEnemyAt,
  spawnGemAt,
  type Harness,
} from "../harness";
import { frameText, stableLines } from "./helpers";

/**
 * The posed figures. Every one the point asks the panel for is a figure no
 * other number of the posed run carries, so the line that answers for it is
 * the line that reports it.
 */
const TICK = 19800;
const LEVEL = 7;
const XP = 12;
const HP = 43;
const KILLS = 321;
const POSITION = { x: 300, y: -120 };
const ENEMIES_POSED = 4;
const PROJECTILES = 6;
const PUDDLES = 12;
const GEMS = 9;
const EMBER_LEVEL = 8;
const EMBER_LEVEL_B = 3;
const SOOT_LEVEL = 1;
const SOOT_LEVEL_B = 2;
const PENDING = 3;
const COOLDOWN_A = 0.75;
const COOLDOWN_B = 0.25;

/**
 * The second tick the clock is read at, a minute and three quarters before the
 * first, and inside the `0 … 35999` `setTick` takes.
 */
const TICK_B = 13500;

/**
 * How far a second written on the panel may sit from the clock's and still be
 * it: half a second, which is what rounding or truncating a figure to a whole
 * number of seconds moves it by, and what a figure drawn to one decimal or
 * more sits well inside.
 */
const CLOCK_TOLERANCE = 0.5;

/**
 * The separators a build may set between the digit triples of a figure, so
 * `1,234` and `1234` are read as one figure. ASCII space is deliberately
 * absent: a build sets its own spacing within a line, and accepting it would
 * read the two figures of `40 130` as the single figure `40130`.
 */
const GROUP = "[,'\u00A0\u202F\u2009]";

/** One number a line carries: a grouped figure, or a plain one. */
const NUMBER = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every number one line carries, a grouped figure read as the one figure it is. */
function numbersIn(line: string): number[] {
  return (line.match(NUMBER) ?? []).map((written) =>
    Number(written.replace(new RegExp(GROUP, "g"), "")),
  );
}

/**
 * Whether some line of the panel carries `figure` as a figure of its own.
 *
 * The specification fixes the FACTS and not their wording, so a panel writing
 * a level as `L7`, `lv 7` or `7` reports the same seven; what it may not do is
 * leave it out, and `17` or `0.7` is not a seven. A line is therefore read as
 * the figures it carries rather than as text a token search walks, which would
 * take a letter written against the digits for part of them.
 */
function showsFigure(panel: readonly string[], figure: number): boolean {
  return panel.some((line) =>
    numbersIn(line).some((written) => written === figure),
  );
}

/**
 * One line with every figure it carries struck out: what a line is known by
 * across two reads at two clocks, so `Clock: 5:30 / 10:00` and
 * `Clock: 3:45 / 10:00` are one line and `Health: 43.0 / 100` is another.
 */
function shapeOf(line: string): string {
  return line.replace(NUMBER, "#");
}

/**
 * The shapes of the panel's lines that show the run clock at `tick`: as
 * `m:ss`, as the seconds `tick / TICK_HZ` however they are written, or as the
 * tick count itself.
 */
function clockShapes(panel: readonly string[], tick: number): Set<string> {
  const seconds = tick / TICK_HZ;
  const shapes = new Set<string>();
  for (const line of panel) {
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

/**
 * The panel alone, read now: hide it for a baseline frame and show it again,
 * and keep what the shown frame drew beyond that baseline, so the game's own
 * text — its HUD clock included — cancels out.
 */
async function panelNow(h: Harness): Promise<string[]> {
  await pressToggle(h);
  const hidden = await frameText(h);
  await pressToggle(h);
  return minusLines(await frameText(h), hidden);
}

/**
 * The panel's stable lines, read with the overlay currently shown: hide it
 * for a baseline frame, show it again, and keep what two shown frames agree
 * on beyond that baseline. Sorted and joined, so two readings compare as one
 * string.
 */
async function panelStable(h: Harness): Promise<string> {
  await pressToggle(h);
  const hidden = await frameText(h);
  await pressToggle(h);
  const first = minusLines(await frameText(h), hidden);
  const second = minusLines(await frameText(h), hidden);
  return [...stableLines(first, second)].sort().join("\n");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows each registered source with its live value", async () => {
  isolate(h, { level: LEVEL });
  h.debug.setTick(TICK);
  h.debug.setXp(XP);
  h.debug.setKills(KILLS);
  h.debug.setPlayerPosition(POSITION.x, POSITION.y);
  h.debug.setFacing("left");
  holdWeapon(h, "halo", 1);
  const ember = holdWeapon(h, "ember", EMBER_LEVEL);
  h.debug.setWeaponCooldown(ember, COOLDOWN_A);
  const soot = holdPassive(h, "soot", SOOT_LEVEL);
  h.debug.setHp(HP);
  const types = ["moth", "bat", "rat", "beetle"] as const;
  for (let i = 0; i < ENEMIES_POSED; i += 1) {
    spawnEnemyAt(h, types[i], POSITION.x + 400 + i * 50, POSITION.y + 300);
  }
  for (let i = 0; i < PROJECTILES; i += 1) {
    h.debug.spawnProjectile(
      "ember",
      POSITION.x - 400,
      POSITION.y + i * 30,
      0,
      0,
      0,
    );
  }
  for (let i = 0; i < GEMS; i += 1) {
    spawnGemAt(h, "small", POSITION.x, POSITION.y - 400 - i * 20);
  }
  for (let i = 0; i < PUDDLES; i += 1) {
    h.debug.spawnPuddle(
      "oil-splash",
      POSITION.x + 500 + i * 60,
      POSITION.y - 500,
    );
  }
  await h.tick(1);
  h.debug.setScreen("paused");
  h.debug.setPendingLevelUps(PENDING);
  const live = h.snapshot();

  const before = await frameText(h);
  await pressToggle(h);
  const shown = await frameText(h);
  captureStill(h, "sources");
  const panel = minusLines(shown, before);

  assertTrue(hasToken(panel, live.screen), "the screen on the panel");
  const clockAt = clockShapes(panel, live.run.tick);
  assertTrue(
    clockAt.size > 0,
    `the run clock (${clockText(live.run.tick)}, ${String(live.run.time)}s, or tick ${String(live.run.tick)}) on the panel`,
  );
  // The clock again, at a tick far from the first, and on the SAME line:
  // `setTick` "Sets `tick` to `tick`" and "The run clock is `tick / TICK_HZ`
  // seconds" (specs/instrumentation.md, specs/state.md), so a source that
  // reads the live state shows the posed clock, while a figure that merely sat
  // within half a second of the first clock does not follow it to the second.
  h.debug.setTick(TICK_B);
  const later = await panelNow(h);
  assertTrue(
    [...clockShapes(later, TICK_B)].some((shape) => clockAt.has(shape)),
    `the line that showed the run clock at ${clockText(live.run.tick)} showing it at ${clockText(TICK_B)} (${String(TICK_B / TICK_HZ)}s, or tick ${String(TICK_B)}) too, with the clock posed there`,
  );
  h.debug.setTick(live.run.tick);
  assertTrue(showsFigure(panel, live.run.level), "the level on the panel");
  assertTrue(showsFigure(panel, live.run.xp), "xp on the panel");
  assertTrue(showsFigure(panel, live.run.xpToNext), "xpToNext on the panel");
  assertTrue(showsFigure(panel, live.run.player.hp), "hp on the panel");
  assertTrue(showsFigure(panel, live.run.maxHp), "maxHp on the panel");
  assertTrue(showsFigure(panel, live.run.kills), "the kill count on the panel");
  assertTrue(
    showsFigure(panel, live.run.player.x),
    "the lamplighter's x on the panel",
  );
  assertTrue(
    showsFigure(panel, live.run.player.y),
    "the lamplighter's y on the panel",
  );
  assertTrue(
    showsFigure(panel, live.run.enemies.length),
    "the enemy count on the panel",
  );
  assertTrue(
    showsFigure(panel, live.run.spawnWindow),
    "the spawn window on the panel",
  );
  assertTrue(
    showsFigure(panel, live.run.projectiles.length),
    "the projectile count on the panel",
  );
  assertTrue(
    showsFigure(panel, live.run.zones.length),
    "the zone count on the panel",
  );
  assertTrue(
    showsFigure(panel, live.run.gems.length),
    "the gem count on the panel",
  );
  for (const held of live.run.weapons) {
    assertTrue(
      hasToken(panel, held.id),
      `the held weapon ${held.id} on the panel`,
    );
  }
  for (const held of live.run.passives) {
    assertTrue(
      hasToken(panel, held.id),
      `the held passive ${held.id} on the panel`,
    );
  }
  assertTrue(
    showsFigure(panel, live.run.pendingLevelUps),
    "pendingLevelUps on the panel",
  );

  // The values whose rendering is free: the panel's stable lines change when
  // the one value is flipped through the surface, on the paused scene.
  const facingLeft = await panelStable(h);
  h.debug.setFacing("right");
  assertNotEqual(
    await panelStable(h),
    facingLeft,
    "the panel across the facing flip",
  );

  const emberAtEight = await panelStable(h);
  h.debug.setWeapon(ember, "ember", EMBER_LEVEL_B);
  assertNotEqual(
    await panelStable(h),
    emberAtEight,
    "the panel across Ember's level change",
  );

  const cooldownA = await panelStable(h);
  h.debug.setWeaponCooldown(ember, COOLDOWN_B);
  assertNotEqual(
    await panelStable(h),
    cooldownA,
    "the panel across Ember's cooldown change",
  );

  const sootAtOne = await panelStable(h);
  h.debug.setPassive(soot, "soot", SOOT_LEVEL_B);
  assertNotEqual(
    await panelStable(h),
    sootAtOne,
    "the panel across Soot's level change",
  );

  const switchesOff = await panelStable(h);
  h.debug.setSpawning(true);
  assertNotEqual(
    await panelStable(h),
    switchesOff,
    "the panel across a switch flip",
  );
});
