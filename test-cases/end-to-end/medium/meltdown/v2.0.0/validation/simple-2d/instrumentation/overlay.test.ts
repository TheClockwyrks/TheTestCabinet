// Meltdown — instrumentation/overlay: the debug overlay reports the game.
//
// specs/instrumentation.md, Diagnostics: "The debug overlay is read-only, never
// changes gameplay, and shows the values the game registers with it as diagnostic
// sources. Register at least: the current `screen` and `phase`; the mode and the
// difficulty; the money, the lives, the wave, and the score; the lengths of the two
// routes; for each tower, its id, its type, its level, its heat, its redline, whether
// it is tripped, and its kills; for each surge unit, its id, its type, the tile it
// stands on, its hp, and whether it is slowed." Registering them is the whole of
// Meltdown's part, through `InitApi.diagnostics`; drawing the panel, toggling it and
// keeping it read-only are the engine's.
//
// HOW THE LINES ARE READ. The engine draws the overlay after the game's `render`,
// through the same recorded context as everything else, so what a frame with the
// overlay drew MINUS what a frame without it drew is the overlay's own text. The
// engine's frame-time line is dropped from that difference: it is the engine's, it
// is different on every frame, and it is the one line no build is responsible for.
//
// TWO KINDS OF READING, BECAUSE THE SPECIFICATION FIXES NO FORMATTING. How a build
// spells a source is the build's: `heat 63.0/92` and `h63 r92` are the same
// diagnostic. So each fact is read the only way a free format allows:
//
//   - A VALUE THAT IS ITS OWN NAME is read as a token: the screen, the phase, the
//     mode, the difficulty and the two entity types are spec-fixed words, and the
//     numeric figures are posed at values nothing else in the reading carries —
//     `4321` money, `46` lives, Wave `13`, `90210` score, `92` redline, `63` heat,
//     `777` hp, tile `(34, 25)`, and the two route lengths, which on this floor are
//     exactly `49` and `35` tiles because neither corridor is built on
//     (specs/floor.md, specs/mazing.md).
//   - A VALUE WITH NO SPELLING OF ITS OWN is read by CHANGING IT: the tripped flag
//     and the slow are booleans a build may draw as `TRIPPED`, `yes`, `true` or a
//     mark of its own, so what is asserted is that the overlay's lines are not the
//     same lines once the tower is tripped, and not the same again once the unit is
//     slowed. That reading needs no agreement about spelling at all.
//
// THE WEAK READS ARE MARKED AS SUCH. A tower's id, its level and its kills are small
// integers a build is free to print bare, and a digit that small cannot be told from
// a digit inside another figure on the same line. They are asserted because their
// absence is still a failure, but the honest reading is that they catch an overlay
// missing them entirely rather than one that reports the wrong one.
//
// PURITY IS READ ON A FLOOR THAT CANNOT MOVE. "keep every source a pure read, so
// watching the overlay leaves the game exactly as it is" — so the snapshot must be
// identical across the toggle. That is only decidable where the game itself would
// otherwise have changed nothing, so the second check poses a floor with the build
// timer at `0` behind the shut world gate, one tower with both faculties held, and
// one unit with its motion held: over the toggle's one frame nothing in the game has
// anything to do, and the only field that may move is `simTime`, which must gain
// exactly that one frame — time passing is what every update owes, overlay or not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertGreaterThan,
  assertNotEqual,
  assertTrue,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseTarget,
  posePinnedTower,
  poseTower,
  seconds,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { GUN, poseWalkerOn } from "./scenes";

/**
 * The key the ENGINE toggles its overlay with.
 *
 * The overlay belongs to the runtime, not to Meltdown: specs/instrumentation.md
 * gives the clock, the keyboard, the audio bus and the overlay to the engine, and
 * the engine's own `diagnostics` documentation fixes the backtick key. It drives no
 * registered action, so the game never sees it.
 */
const TOGGLE = "Backquote";

/** The run figures posed, each unmistakable for any other in the reading. */
const RUN = { money: 4321, lives: 46, wave: 13, score: 90210 } as const;

/** The emitter read: a Lance, whose `92` redline is a figure nothing else carries. */
const TOWER_TYPE = "lance";
const TOWER_LEVEL = 3;
const TOWER_HEAT = 63;

/** The unit read, its hp, and the tile it stands on. */
const UNIT_TYPE = "hulk";
const UNIT_HP = 777;
const UNIT_TILE = { col: 34, row: 25 } as const;

/** The two vent-to-exhaust routes on a floor with neither corridor built on. */
const LEFT_ROUTE = 49;
const TOP_ROUTE = 35;

/** The marks the Lance is driven through, so its kill tally is not zero. */
const MARKS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 12, row: 12 },
  { col: 13, row: 13 },
  { col: 14, row: 14 },
];

/**
 * How long the kills are waited for: eight seconds of game time.
 *
 * Geometry rather than a tolerance. A level-III Lance fires at just over one shot a
 * second (specs/towers.md) and one of its shots removes far more than the one hp
 * each mark carries, so eight seconds is more than twice what three kills need.
 */
const KILL_TICKS = ticksFor(8);

/** The `simTime` gain a single frame owes, as decimal places. */
const CLOCK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/** The engine's own frame-time line, which no build is responsible for. */
function isMetrics(line: string): boolean {
  return /\bms\b/i.test(line);
}

/**
 * Toggle the overlay on, read the lines it added over a steady frame, and toggle it
 * back off. The overlay is off when this is called and off when it returns.
 */
async function overlayLines(): Promise<string[]> {
  h.calls.length = 0;
  await h.advance(1);
  const baseline = drawnText(h.calls);

  h.calls.length = 0;
  await h.tap(TOGGLE);
  const shown = drawnText(h.calls);

  h.calls.length = 0;
  await h.tap(TOGGLE);

  return newLines(baseline, shown).filter((line) => !isMetrics(line));
}

/** Some overlay line carries `token`, ignoring case; fails naming `what`. */
function assertSomeLine(
  lines: readonly string[],
  token: string,
  what: string,
): void {
  const wanted = token.toLowerCase();
  if (!lines.some((line) => line.toLowerCase().includes(wanted))) {
    fail(`an overlay line carrying ${what}`, lines);
  }
}

it("draws the facts the specification lists", async () => {
  // A Lance in the quiet corner, driven through three real kills so its tally is
  // not the zero a build that reports nothing would agree with.
  startRun(h, "bottleneck", "hard");
  const gun = posePinnedTower(h, TOWER_TYPE, GUN.col, GUN.row, TOWER_HEAT);
  h.debug.setTowerLevel(gun, TOWER_LEVEL);
  for (const mark of MARKS) poseTarget(h, "mote", mark.col, mark.row, 1);
  const swept = await h.until((s) => s.surge.length === 0, {
    maxFrames: KILL_TICKS,
    poll: 2,
  });
  assertTrue(
    swept.hit,
    `precondition: the Lance killed all ${MARKS.length} of its marks`,
  );
  assertGreaterThan(
    towerOf(h.snapshot(), gun).kills,
    0,
    "precondition: the Lance has kills tallied",
  );
  const kills = towerOf(h.snapshot(), gun).kills;

  // The guns are held now the tally is made, so nothing fires under the reading.
  h.debug.setTowerFiring(gun, false);

  // One unit to report, and the run figures.
  const unit = poseWalkerOn(h, UNIT_TYPE, UNIT_TILE.col, UNIT_TILE.row);
  h.debug.setUnitMotion(unit, false);
  h.debug.setUnitMaxHp(unit, UNIT_HP);
  h.debug.setUnitHp(unit, UNIT_HP);
  h.debug.setBuildTimer(0);
  h.debug.setScore(RUN.score);
  h.debug.setMoney(RUN.money);
  h.debug.setLives(RUN.lives);
  h.debug.setWave(RUN.wave);

  const posed = h.snapshot();
  assertCloseTo(
    posed.paths.left.length,
    LEFT_ROUTE,
    3,
    "precondition: the left corridor is unbuilt, so its route is straight",
  );
  assertCloseTo(
    posed.paths.top.length,
    TOP_ROUTE,
    3,
    "precondition: the top corridor is unbuilt, so its route is straight",
  );

  const lines = await overlayLines();
  h.calls.length = 0;
  await h.tap(TOGGLE);
  captureStill(h, "overlay");
  await h.tap(TOGGLE);

  assertGreaterThan(lines.length, 0, "the overlay draws lines of its own");

  // The run: the screen and the phase, the mode and the difficulty, and the four
  // figures, each posed at a value nothing else in the reading carries.
  assertSomeLine(lines, "playing", "the current screen, 'playing'");
  assertSomeLine(lines, "building", "the current phase, 'building'");
  assertSomeLine(lines, "bottleneck", "the mode, 'bottleneck'");
  assertSomeLine(lines, "hard", "the difficulty, 'hard'");
  assertSomeLine(lines, String(RUN.money), `the money, ${RUN.money}`);
  assertSomeLine(lines, String(RUN.lives), `the lives, ${RUN.lives}`);
  assertSomeLine(lines, String(RUN.wave), `the wave, ${RUN.wave}`);
  assertSomeLine(lines, String(RUN.score), `the score, ${RUN.score}`);

  // The two route lengths, which are whole numbers on this floor.
  assertSomeLine(
    lines,
    String(LEFT_ROUTE),
    `the left route's length, ${LEFT_ROUTE}`,
  );
  assertSomeLine(
    lines,
    String(TOP_ROUTE),
    `the top route's length, ${TOP_ROUTE}`,
  );

  // The tower: its type and its redline are its own figures; its id, its level and
  // its kills are the weak reads named in the head.
  assertSomeLine(lines, TOWER_TYPE, `the tower's type, '${TOWER_TYPE}'`);
  assertSomeLine(
    lines,
    String(towerOf(posed, gun).redline),
    `the tower's redline, ${towerOf(posed, gun).redline}`,
  );
  assertSomeLine(lines, String(TOWER_HEAT), `the tower's heat, ${TOWER_HEAT}`);
  assertSomeLine(lines, String(gun), `the tower's id, ${gun}`);
  assertSomeLine(
    lines,
    String(TOWER_LEVEL),
    `the tower's level, ${TOWER_LEVEL}`,
  );
  assertSomeLine(lines, String(kills), `the tower's kills, ${kills}`);

  // The unit: its type, its hp, the tile it stands on, and its id.
  assertSomeLine(lines, UNIT_TYPE, `the unit's type, '${UNIT_TYPE}'`);
  assertSomeLine(lines, String(UNIT_HP), `the unit's hp, ${UNIT_HP}`);
  assertSomeLine(
    lines,
    String(UNIT_TILE.col),
    `the unit's tile column, ${UNIT_TILE.col}`,
  );
  assertSomeLine(
    lines,
    String(UNIT_TILE.row),
    `the unit's tile row, ${UNIT_TILE.row}`,
  );
  assertSomeLine(lines, String(unit), `the unit's id, ${unit}`);

  // The two facts a free format leaves no token for, read by changing them: the
  // overlay's lines are different once the tower is tripped, and different again
  // once the unit is slowed.
  h.debug.setTowerTripped(gun, true);
  h.debug.setTowerTripTimer(gun, 3);
  const tripped = await overlayLines();
  assertNotEqual(
    tripped.join("\n"),
    lines.join("\n"),
    "the overlay reports whether a tower is tripped",
  );

  h.debug.setUnitSlow(unit, 0.5);
  h.debug.setUnitSlowTimer(unit, 5);
  const slowed = await overlayLines();
  assertNotEqual(
    slowed.join("\n"),
    tripped.join("\n"),
    "the overlay reports whether a unit is slowed",
  );
});

it("leaves the game exactly as it is", async () => {
  // A floor with nothing of its own to do, AND NOT ONE FACULTY GATE HOLDING IT
  // THERE — a gate this point leant on would make it fail for a fault another item
  // already names. The build timer is at `0` behind the world gate `startRun`
  // shuts, so the countdown has nowhere to go; the tower is left at the heat
  // `addTower` starts it at, `0`, where specs/heat.md's air term — proportional to
  // `H / 100` — is exactly nothing; and it stands thirty tiles from the one unit on
  // the floor, far outside any emitter's range, so it acquires nothing and fires
  // nothing. Only the unit's motion is held, and that is a pose rather than a
  // faculty the tower is being read for.
  startRun(h);
  poseTower(h, "arc", GUN.col, GUN.row);
  poseTarget(h, "mote", UNIT_TILE.col, UNIT_TILE.row);
  h.debug.setBuildTimer(0);
  await h.advance(1);

  const before = h.snapshot();
  await h.tap(TOGGLE);
  const after = h.snapshot();

  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "watching the overlay leaves the game exactly as it is",
  );
  assertCloseTo(
    after.simTime - before.simTime,
    seconds(1),
    CLOCK_DIGITS,
    "simTime advances by exactly the toggle's one frame, and nothing more",
  );

  // And the frame the toggle drew really did draw something the steady frame did
  // not, so the reading above is of a frame that had the overlay on it.
  h.calls.length = 0;
  await h.advance(1);
  const withOverlay = drawnText(h.calls).filter((line) => !isMetrics(line));
  h.calls.length = 0;
  await h.tap(TOGGLE);
  const withoutOverlay = drawnText(h.calls).filter((line) => !isMetrics(line));
  assertGreaterThan(
    newLines(withoutOverlay, withOverlay).length,
    0,
    "the overlay was on for the frame the purity reading was taken across",
  );
});
