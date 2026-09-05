// Meltdown — instrumentation/overlay: the debug overlay reports the game.
//
// Under this engine the overlay is ENGINE CHROME: the backtick key toggles it and
// the engine draws it. Meltdown's whole part is to REGISTER the values it wants on
// it, and `specs/instrumentation.md`, Diagnostics, lists them: "the current
// `screen` and `phase`; the mode and the difficulty; the money, the lives, the
// wave, and the score; the lengths of the two routes; for each tower, its id, its
// type, its level, its heat, its redline, whether it is tripped, and its kills;
// for each surge unit, its id, its type, the tile it stands on, its hp, and
// whether it is slowed."
//
// THE OVERLAY'S LINES ARE THE ONES THE TOGGLE ADDS. The engine draws through the
// same context this harness records, so the overlay's text arrives as ordinary
// text runs — beside the panel's and the floor's. What separates them is the
// toggle: a bare frame is read first, and every run the overlaid frame draws that
// the bare frame did not is the overlay's. That is what keeps a shop entry
// labelled LANCE from standing in for the overlay's own tower line.
//
// WHAT IS ASSERTED IS THE VALUE, NEVER THE WORDING. What words a build puts round
// a figure is the build's; the specification fixes only which figures are there.
// So every value posed below is one that could not be mistaken for another on the
// same panel — `4321` of money, `176` lives, wave `13`, a score of `987654`, a
// Lance pinned at heat `61` against its own redline of `92`, a Drift on tile
// `(40, 30)` at `55` hp — and each is looked for as a run of text carrying it.
// How a long figure is GROUPED is the build's too, so `987654` is found whether
// the line carries it plain or as `987,654`. A route's length is a fraction, so it
// is looked for under any of the roundings a build might print it at.
//
// THE TWO FLAGS ARE READ BY DIFFERENCE, because a flag has no figure to look for:
// a build may write `TRIPPED`, `T`, or a colour. So the tower's line is read, the
// flag is flipped with the pose that touches nothing else — `setTowerTripped`
// "sets that flag alone" — and the line must have changed. The unit's slow is read
// the same way, and so are the KILLS, which no pose can set: the gun is given a
// mark it can kill and its line must differ once it has taken it.
//
// A PURE READ IS NOT ASSERTED HERE. "keep every source a pure read, so watching
// the overlay leaves the game exactly as it is" is a requirement on the OVERLAY,
// and under this engine the overlay is the engine's: the backtick key, the panel,
// the hidden-at-start state and the read-only-ness all are. A check on any of
// them returns the same verdict for every build on this engine. It is
// `instrumentation.overlay-is-read-only`, which only `none` carries, where the
// build writes the overlay itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotEqual, fail } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  clearCalls,
  createHarness,
  drawnText,
  startRun,
  ticksFor,
  tileCenter,
  toggleOverlay,
  type Harness,
} from "../harness";
import { readTower } from "./ground";

/** The run figures posed, each one distinctive on a panel full of numbers. */
const MONEY = 4321;
const LIVES = 176;
const WAVE = 13;
const SCORE = 987_654;

/** The tower posed, where it stands, and the heat it is pinned at. */
const TOWER_TYPE = "lance";
const TOWER_AT = { col: 4, row: 4 };
const TOWER_LEVEL = 3;
const TOWER_HEAT = 61;
const TOWER_REDLINE =
  TOWER_DEFS[TOWER_TYPE].kind === "emitter"
    ? TOWER_DEFS[TOWER_TYPE].redline
    : 0;

/** The unit whose line the overlay must carry, and where it stands. */
const UNIT_TYPE = "drift";
const UNIT_AT = { col: 40, row: 30 };
const UNIT_HP = 55;
const UNIT_SLOW = 0.5;
const UNIT_SLOW_SECONDS = 1000;

/** The mark the gun is given to kill, and how long it is given. */
const MARK_AT = { col: 9, row: 4 };
const MARK_HP = 1;
const KILL_FRAMES = ticksFor(6);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The text runs one frame drew, with the overlay in whatever state it is in. */
async function textOfOneFrame(): Promise<string[]> {
  clearCalls(h);
  await h.advance(1);
  return drawnText(h.calls);
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
 * The first of `lines` containing `needle`, ignoring case, or a failure.
 *
 * A FIGURE is handed over as a number rather than as a string, and is then found
 * under every grouping a build may letter it with: a score of `987654` is carried
 * by a line reading `987654` and by one reading `987,654` alike.
 */
function lineContaining(
  lines: readonly string[],
  needle: string | number,
  requirement: string,
): string {
  const wanted = (
    typeof needle === "number" ? figureRenderings(needle) : [needle]
  ).map((form) => form.toLowerCase());
  const found = lines.find((line) => {
    const seen = line.toLowerCase();
    return wanted.some((form) => seen.includes(form));
  });
  if (found === undefined) {
    fail(
      `an overlay line containing ${JSON.stringify(needle)} (${requirement})`,
      lines,
    );
  }
  return found;
}

/**
 * A line carrying `value` under any rounding a build might print it at.
 *
 * A route length is a sum of `1`s and `sqrt(2)`s (`specs/mazing.md`), so it is a
 * fraction and how many places a build shows is the build's. What the
 * specification fixes is that the length is there.
 */
function lineWithNumber(
  lines: readonly string[],
  value: number,
  requirement: string,
): string {
  const roundings = [
    ...figureRenderings(value),
    ...figureRenderings(Math.round(value)),
    ...figureRenderings(Math.trunc(value)),
    value.toFixed(0),
    value.toFixed(1),
    value.toFixed(2),
  ];
  const found = lines.find((line) =>
    roundings.some((rendering) => line.includes(rendering)),
  );
  if (found === undefined) {
    fail(`an overlay line carrying ${value} (${requirement})`, lines);
  }
  return found;
}

it("draws every registered fact the specification lists", async () => {
  startRun(h, "bottleneck");
  h.debug.setDifficulty("hard");
  // `building` while the facts are read, because it is a word that appears
  // nowhere else on this panel — where `wave` is also the label the run's own
  // line carries — and then `wave` for the pure-read leg, where a phase whose
  // build timer counts down would move a field for a reason of its own.
  h.debug.setPhase("building");
  h.debug.setWavePending(0);
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);
  h.debug.setScore(SCORE);

  h.debug.addTower(TOWER_TYPE, TOWER_AT.col, TOWER_AT.row, 0);
  const tower = h.snapshot().towers[0].id;
  h.debug.setTowerThermal(tower, false);
  h.debug.setTowerHeat(tower, TOWER_HEAT);
  h.debug.setTowerLevel(tower, TOWER_LEVEL);

  h.debug.addUnit(UNIT_TYPE, "left");
  const unit = h.snapshot().surge[0].id;
  const where = tileCenter(UNIT_AT.col, UNIT_AT.row);
  h.debug.setUnitPosition(unit, where.x, where.y);
  h.debug.setUnitMotion(unit, false);
  h.debug.setUnitMaxHp(unit, UNIT_HP);
  h.debug.setUnitHp(unit, UNIT_HP);
  h.debug.setUnitSlow(unit, UNIT_SLOW);
  h.debug.setUnitSlowTimer(unit, UNIT_SLOW_SECONDS);

  // A bare frame first: everything the game draws with the overlay down.
  const bare = new Set(await textOfOneFrame());

  // Then the toggle, and the runs it added are the overlay's.
  clearCalls(h);
  await toggleOverlay(h);
  captureStill(h, "overlay");
  const overlaid = drawnText(h.calls);
  const added = overlaid.filter((line) => !bare.has(line));
  assertGreaterThan(added.length, 0, "the text runs the toggle added");

  const posed = h.snapshot();

  // The run.
  lineContaining(added, posed.screen, "the current screen");
  lineContaining(added, posed.phase, "the current phase");
  lineContaining(added, posed.mode, "the mode");
  lineContaining(added, posed.difficulty, "the difficulty");
  lineContaining(added, MONEY, "the money");
  lineContaining(added, LIVES, "the lives");
  lineContaining(added, WAVE, "the wave");
  lineContaining(added, SCORE, "the score");

  // The two routes.
  lineWithNumber(added, posed.paths.left.length, "the left route's length");
  lineWithNumber(added, posed.paths.top.length, "the top route's length");

  // The tower: its id, its type, its level, its heat and its redline, all on the
  // line the overlay gave it.
  const towerLine = lineContaining(added, TOWER_TYPE, "the tower's type");
  lineContaining([towerLine], tower, "the tower's id");
  const level = towerLine.toLowerCase();
  if (!level.includes(String(TOWER_LEVEL)) && !level.includes("iii")) {
    fail(
      `the tower's level on its overlay line, as ${TOWER_LEVEL} or III`,
      towerLine,
    );
  }
  lineContaining([towerLine], TOWER_HEAT, "the tower's heat");
  lineContaining([towerLine], TOWER_REDLINE, "the tower's redline");

  // The unit: its id, its type, its tile and its hp.
  const unitLine = lineContaining(added, UNIT_TYPE, "the unit's type");
  lineContaining([unitLine], unit, "the unit's id");
  lineContaining([unitLine], UNIT_AT.col, "the unit's column");
  lineContaining([unitLine], UNIT_AT.row, "the unit's row");
  lineContaining([unitLine], UNIT_HP, "the unit's hp");

  // The two flags, by difference: the pose touches that flag alone, so a line
  // that did not change is a line that never carried it.
  h.debug.setTowerTripped(tower, true);
  const tripped = (await textOfOneFrame()).filter((line) => !bare.has(line));
  assertNotEqual(
    lineContaining(tripped, TOWER_TYPE, "the tower's line, once tripped"),
    towerLine,
    "the tower's overlay line, against the same line before it was tripped",
  );
  h.debug.setTowerTripped(tower, false);

  h.debug.setUnitSlow(unit, 0);
  h.debug.setUnitSlowTimer(unit, 0);
  const unslowed = (await textOfOneFrame()).filter((line) => !bare.has(line));
  assertNotEqual(
    lineContaining(unslowed, UNIT_TYPE, "the unit's line, once unslowed"),
    unitLine,
    "the unit's overlay line, against the same line while it was slowed",
  );

  // And the kills, which no pose can set: the gun is given a mark it can kill.
  const before = (await textOfOneFrame()).filter((line) => !bare.has(line));
  const beforeTower = lineContaining(
    before,
    TOWER_TYPE,
    "the tower's line before it had a kill",
  );
  h.debug.addUnit("mote", "left");
  const mark = h.snapshot().surge[h.snapshot().surge.length - 1].id;
  const markAt = tileCenter(MARK_AT.col, MARK_AT.row);
  h.debug.setUnitPosition(mark, markAt.x, markAt.y);
  h.debug.setUnitMotion(mark, false);
  h.debug.setUnitMaxHp(mark, MARK_HP);
  h.debug.setUnitHp(mark, MARK_HP);
  await h.until(
    (snapshot) => snapshot.surge.every((entry) => entry.id !== mark),
    { maxFrames: KILL_FRAMES, poll: 4 },
  );
  assertGreaterThan(
    readTower(h.snapshot(), tower, "the gun after its shot").kills,
    0,
    "precondition: the gun took the kill its overlay line must report",
  );
  const scored = (await textOfOneFrame()).filter((line) => !bare.has(line));
  assertNotEqual(
    lineContaining(scored, TOWER_TYPE, "the tower's line, once it has a kill"),
    beforeTower,
    "the tower's overlay line, against the same line before the kill",
  );
});
