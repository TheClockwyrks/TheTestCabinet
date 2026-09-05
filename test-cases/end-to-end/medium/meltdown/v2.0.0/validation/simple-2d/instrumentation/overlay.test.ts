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
//     `777` hp, tile `(34, 25)`, and the two route lengths, which are read off the
//     snapshot rather than named here — what they come to on this floor is the
//     `mazing` group's reading.
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
// PURITY IS NOT READ HERE. "keep every source a pure read, so watching the overlay
// leaves the game exactly as it is" is a requirement on the OVERLAY, and under an
// engine the overlay is the engine's: it owns the backtick key, the panel, the
// hidden-at-start state and the read-only-ness. A check on any of those returns
// the same verdict for every build on this engine. It is
// `instrumentation.overlay-is-read-only`, which only `none` carries, where the
// build writes the overlay itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotEqual, assertTrue, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseTarget,
  posePinnedTower,
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

/**
 * The separators a build may group a figure's digit triples with.
 *
 * `1,250`, `1'250`, and `1 250` written with a non-breaking, a narrow or a thin
 * space are all the one figure `1250` — the grouping
 * `Number.prototype.toLocaleString` writes by default. The ASCII space is
 * deliberately not one of them: a line is read as a whole run of text and a run
 * may carry two figures with an ordinary space between them, so accepting it
 * would read `40 130` as `40130`. Nor is the full stop, which is the decimal
 * point.
 */
const GROUP_SEPARATORS = [",", "'", "\u00A0", "\u202F", "\u2009"] as const;

/**
 * Every way a build may letter the figure `value`: plain, and grouped into digit
 * triples by each separator above.
 *
 * A figure of three digits or fewer has exactly one rendering, so a life count, a
 * tile column or an entity id is looked for exactly as it is.
 */
function figureRenderings(value: number): string[] {
  const plain = String(value);
  const dot = plain.indexOf(".");
  const whole = dot === -1 ? plain : plain.slice(0, dot);
  const tail = dot === -1 ? "" : plain.slice(dot);
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign === "" ? whole : whole.slice(1);
  if (digits.length <= 3) return [plain];
  const triples: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    triples.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return [
    plain,
    ...GROUP_SEPARATORS.map(
      (separator) => `${sign}${triples.join(separator)}${tail}`,
    ),
  ];
}

/**
 * Some overlay line carries `token`, ignoring case; fails naming `what`.
 *
 * A FIGURE is handed over as a number rather than as a string, because how a
 * build letters a long one is the build's: every grouping it may reach for
 * answers, so a score of `12345` is found whether the line carries `12345` or
 * `12,345`.
 */
function assertSomeLine(
  lines: readonly string[],
  token: string | number,
  what: string,
): void {
  const wanted = (
    typeof token === "number" ? figureRenderings(token) : [token]
  ).map((form) => form.toLowerCase());
  const carried = lines.some((line) => {
    const seen = line.toLowerCase();
    return wanted.some((form) => seen.includes(form));
  });
  if (!carried) {
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
  assertSomeLine(lines, RUN.money, `the money, ${RUN.money}`);
  assertSomeLine(lines, RUN.lives, `the lives, ${RUN.lives}`);
  assertSomeLine(lines, RUN.wave, `the wave, ${RUN.wave}`);
  assertSomeLine(lines, RUN.score, `the score, ${RUN.score}`);

  // The two route lengths, read off the snapshot rather than named here: what
  // they come to on this floor is `mazing`'s reading, not this one's.
  assertSomeLine(
    lines,
    posed.paths.left.length,
    `the left route's length, ${String(posed.paths.left.length)}`,
  );
  assertSomeLine(
    lines,
    posed.paths.top.length,
    `the top route's length, ${String(posed.paths.top.length)}`,
  );

  // The tower: its type and its redline are its own figures; its id, its level and
  // its kills are the weak reads named in the head.
  assertSomeLine(lines, TOWER_TYPE, `the tower's type, '${TOWER_TYPE}'`);
  assertSomeLine(
    lines,
    towerOf(posed, gun).redline,
    `the tower's redline, ${towerOf(posed, gun).redline}`,
  );
  assertSomeLine(lines, TOWER_HEAT, `the tower's heat, ${TOWER_HEAT}`);
  assertSomeLine(lines, gun, `the tower's id, ${gun}`);
  assertSomeLine(lines, TOWER_LEVEL, `the tower's level, ${TOWER_LEVEL}`);
  assertSomeLine(lines, kills, `the tower's kills, ${kills}`);

  // The unit: its type, its hp, the tile it stands on, and its id.
  assertSomeLine(lines, UNIT_TYPE, `the unit's type, '${UNIT_TYPE}'`);
  assertSomeLine(lines, UNIT_HP, `the unit's hp, ${UNIT_HP}`);
  assertSomeLine(
    lines,
    UNIT_TILE.col,
    `the unit's tile column, ${UNIT_TILE.col}`,
  );
  assertSomeLine(lines, UNIT_TILE.row, `the unit's tile row, ${UNIT_TILE.row}`);
  assertSomeLine(lines, unit, `the unit's id, ${unit}`);

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
