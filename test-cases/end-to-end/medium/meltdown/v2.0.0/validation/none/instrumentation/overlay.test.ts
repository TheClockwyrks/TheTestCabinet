// Meltdown — instrumentation/overlay: the debug overlay reports the game, and
// reading it leaves the game exactly as it is.
//
// THE RULE. `specs/instrumentation.md`, under Diagnostics: the overlay "shows the
// values the game registers with it as diagnostic sources", and it names the
// minimum — the current `screen` and `phase`, the mode and the difficulty, the
// money, the lives, the wave and the score, the lengths of the two routes, and,
// per tower and per unit, the fields listed there. It is "read-only, never changes
// gameplay", and "every source a pure read, so watching the overlay leaves the
// game exactly as it is". `specs/controls.md` puts the toggle on the backtick key,
// `Backquote`, and has the overlay off when the game starts.
//
// EVERY SOURCE THE SPECIFICATION LISTS IS READ, and the toggle is what tells the
// overlay's own text from the panel's. A bare frame is read first, and every run
// the overlaid frame draws that the bare frame did not is the overlay's. That is
// what keeps a shop entry labelled LANCE, or the panel's own money readout, from
// standing in for a line the overlay never drew.
//
// THREE FIGURES THE PANEL ALSO DRAWS ARE READ BY COUNT INSTEAD. `specs/hud.md`
// puts the money, the lives and the wave on the panel as well, so a build whose
// overlay writes one of them exactly as its panel does draws a run the difference
// above cannot see. For those three the reading is that the frame carries MORE
// runs bearing the figure with the overlay open than with it shut, which is true
// of any build that drew the figure twice however it lettered either one.
//
// AND THE TWO STRONGEST ARE READ BEFORE THE TOGGLE TOO. The posed score and the
// posed hp are figures the panel is specified not to draw — `specs/hud.md` gives
// it no score at all and draws a unit's hp as a bar rather than a figure — so
// requiring them absent from the frame BEFORE the backtick and present after it is
// what tells "the overlay reported the game" from "the game happened to have those
// numbers on screen already".
//
// THE THREE FLAGS AND THE TALLY ARE READ BY DIFFERENCE, because a flag has no
// figure to look for: a build may write `TRIPPED`, `T`, or a colour. So the
// tower's line is read, the flag is flipped with the pose that touches nothing
// else — `setTowerTripped` "sets that flag alone" — and the line must have
// changed. The unit's slow is read the same way, and so are the KILLS, which no
// pose can set: the gun is given a mark it can kill and its line must differ once
// it has taken it.
//
// HOW EACH FACT IS MATCHED. A word for a name, a substring for a figure. The
// overlay's LAYOUT is entirely the build's — the specification asks only that each
// source be "short enough to read on a line" — so requiring an exact run of text
// would fail a conformant build over its own formatting. A posed heat of `63`
// reads as `63`, `63.0` or `63.00` and all three carry the substring. A route's
// length is a sum of `1`s and `sqrt(2)`s (`specs/mazing.md`) and so a fraction, so
// it is looked for under any of the roundings a build might print it at.
//
// THE SECOND HALF IS THAT NOTHING MOVED. The whole snapshot is read either side of
// the toggle over a floor posed to be motionless — an untimed opening phase, a
// tower with both faculties held, a unit with its locomotion held, the world gate
// shut — so the only field a conformant build may differ in is `simTime`, which
// gains the one frame the press ran on. `muted` is in that comparison on purpose:
// a build that bound the backtick to something of its own is caught by it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotEqual,
  fail,
} from "../assert";
import {
  TOWER_DEFS,
  isEmitter,
  tileCX,
  tileCY,
  type TowerType,
} from "../constants";
import { freeSite, laneTile } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnText,
  drewWord,
  poseTarget,
  poseTower,
  poseWalker,
  requireTower,
  seconds,
  startRun,
  toggleOverlay,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/** The floor the overlay is read over, posed to distinguishing figures. */
const TOWER: TowerType = "lance";
const POSED_HEAT = 63;
const POSED_LEVEL = 3;
const UNIT = "hulk";
const POSED_HP = 137;
const POSED_MAX_HP = 300;
const POSED_SCORE = 6821;

/** The run's own figures, each one distinctive on a panel full of numbers. */
const POSED_MONEY = 4321;
const POSED_LIVES = 176;
const POSED_WAVE = 13;

/** Where the mark the gun is given to kill stands, and the hp it carries. */
const MARK = "mote";
const MARK_SITE = freeSite(1);
const MARK_HP = 1;

/** How long the gun is given to take that mark, in frames. */
const KILL_FRAMES = 600;

/** Where the posed unit is parked for the kill leg: far outside the gun's range. */
const FAR_TILE = { col: 40, row: 30 } as const;

/** The tower's figures at level I (`specs/towers.md`); its redline is `92`. */
const TOWER_DEF = TOWER_DEFS[TOWER];
if (!isEmitter(TOWER_DEF)) throw new TypeError(`${TOWER} is not an emitter`);

/** Where the tower stands and where the unit is held. Geometry, not a threshold. */
const TOWER_SITE = freeSite(0);
const UNIT_TILE = laneTile("left", 6);

/**
 * How close `simTime` must come to the one frame the toggle ran, in decimal
 * places: within `5e-7`.
 *
 * Not a behavioural tolerance. The press runs exactly one frame of the harness's
 * clock and `simTime` accumulates the game time it was handed
 * (`specs/instrumentation.md`), so the only difference a conformant build can
 * introduce is the float's own representation.
 */
const TIME_DIGITS = 6;

let h: Harness;

/**
 * Pose a floor that cannot change on its own, carrying the values the overlay must
 * report.
 *
 * Every faculty that could move a number is held, and each is held for a reason
 * this point can state: the phase is the untimed `opening` one, which "carries no
 * countdown, reports a `buildTimer` of `0`, and never starts a wave on its own"
 * (`specs/waves.md`); the tower's guns and thermal model are both off, so its heat
 * is the one posed here; the unit's locomotion is off, so its tile and its hp are
 * the ones posed here; and `startRun` has already shut the world gate.
 */
async function poseAStillFloor(): Promise<{ tower: number; unit: number }> {
  await startRun(h);
  await h.debug.setPhase("opening");
  await h.debug.setBuildTimer(0);
  await h.debug.setMoney(POSED_MONEY);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setWave(POSED_WAVE);
  await h.debug.setScore(POSED_SCORE);

  const tower = await poseTower(h, TOWER, TOWER_SITE.col, TOWER_SITE.row);
  await h.debug.setTowerFiring(tower, false);
  await h.debug.setTowerThermal(tower, false);
  await h.debug.setTowerHeat(tower, POSED_HEAT);
  await h.debug.setTowerLevel(tower, POSED_LEVEL);

  const unit = await poseWalker(h, UNIT, "left");
  await h.debug.setUnitMotion(unit, false);
  await h.debug.setUnitPosition(
    unit,
    tileCX(UNIT_TILE.col),
    tileCY(UNIT_TILE.row),
  );
  await h.debug.setUnitMaxHp(unit, POSED_MAX_HP);
  await h.debug.setUnitHp(unit, POSED_HP);
  return { tower, unit };
}

/** The runs of text one fresh frame drew, with the overlay in whatever state it is in. */
async function runsOfOneFrame(): Promise<string[]> {
  return drawnText(await h.frameCalls());
}

/** How many of `runs` carry `needle`, ignoring case. */
function carrying(runs: readonly string[], needle: string): number {
  const wanted = needle.toLowerCase();
  return runs.filter((run) => run.toLowerCase().includes(wanted)).length;
}

/** The first of `runs` containing `needle`, ignoring case, or a failure. */
function lineContaining(
  runs: readonly string[],
  needle: string,
  requirement: string,
): string {
  const wanted = needle.toLowerCase();
  const found = runs.find((run) => run.toLowerCase().includes(wanted));
  if (found === undefined) {
    fail(
      `an overlay line containing ${JSON.stringify(needle)} (${requirement})`,
      runs.join(" | "),
    );
  }
  return found;
}

/** A line carrying `value` under any rounding a build might print it at. */
function lineWithNumber(
  runs: readonly string[],
  value: number,
  requirement: string,
): string {
  const renderings = [
    String(value),
    String(Math.round(value)),
    String(Math.trunc(value)),
    value.toFixed(1),
    value.toFixed(2),
  ];
  const found = runs.find((run) =>
    renderings.some((rendering) => run.includes(rendering)),
  );
  if (found === undefined) {
    fail(
      `an overlay line carrying ${String(value)} (${requirement})`,
      runs.join(" | "),
    );
  }
  return found;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the game's own facts once the backtick opens it", async () => {
  const { tower, unit } = await poseAStillFloor();

  // The frame before the toggle: the panel alone.
  const closedRuns = await runsOfOneFrame();
  const closed = closedRuns.join(" | ");
  for (const figure of [String(POSED_SCORE), String(POSED_HP)]) {
    if (closed.includes(figure)) {
      fail(
        `${figure} absent from the frame before the overlay was opened ` +
          "(specs/hud.md draws neither the score nor a unit's hp as a figure)",
        closed,
      );
    }
  }

  await toggleOverlay(h);
  const opened = await h.frameCalls();
  await captureStill(h, "overlay");
  const openedRuns = drawnText(opened);
  const bare = new Set(closedRuns);
  const added = openedRuns.filter((run) => !bare.has(run));
  assertGreaterThan(added.length, 0, "the text runs the backtick added");

  const posed = await h.snapshot();

  // The screen, the phase, the mode and the difficulty, as words.
  for (const word of ["playing", "opening", "containment", "medium"]) {
    assertEqual(drewWord(opened, word), true, `the overlay drew "${word}"`);
  }

  // The three figures the panel draws too, by count rather than by difference.
  for (const [name, figure] of [
    ["the money", POSED_MONEY],
    ["the lives", POSED_LIVES],
    ["the wave", POSED_WAVE],
  ] as const) {
    assertGreaterThan(
      carrying(openedRuns, String(figure)),
      carrying(closedRuns, String(figure)),
      `${name}, ${String(figure)}: runs carrying it with the overlay open, ` +
        "against the runs carrying it with the overlay shut",
    );
  }

  // The score, which the panel draws nowhere.
  lineContaining(added, String(POSED_SCORE), "the score");

  // The two routes.
  lineWithNumber(added, posed.paths.left.length, "the left route's length");
  lineWithNumber(added, posed.paths.top.length, "the top route's length");

  // The tower's line: its type, its id, its level, its heat and its redline.
  const towerLine = lineContaining(added, TOWER, "the tower's type");
  lineContaining([towerLine], String(tower), "the tower's id");
  const level = towerLine.toLowerCase();
  if (!level.includes(String(POSED_LEVEL)) && !level.includes("iii")) {
    fail(
      `the tower's level on its overlay line, as ${String(POSED_LEVEL)} or III`,
      towerLine,
    );
  }
  lineContaining([towerLine], String(POSED_HEAT), "the tower's heat");
  lineContaining([towerLine], String(TOWER_DEF.redline), "the tower's redline");

  // The unit's line: its type, its id, the tile it stands on and its hp.
  const unitLine = lineContaining(added, UNIT, "the unit's type");
  lineContaining([unitLine], String(unit), "the unit's id");
  lineContaining([unitLine], String(UNIT_TILE.col), "the unit's column");
  lineContaining([unitLine], String(UNIT_TILE.row), "the unit's row");
  lineContaining([unitLine], String(POSED_HP), "the unit's hp");

  // The trip flag, by difference: the pose touches that flag alone.
  await h.debug.setTowerTripped(tower, true);
  const trippedRuns = (await runsOfOneFrame()).filter((run) => !bare.has(run));
  assertNotEqual(
    lineContaining(trippedRuns, TOWER, "the tower's line, once tripped"),
    towerLine,
    "the tower's overlay line, against the same line before it was tripped",
  );
  await h.debug.setTowerTripped(tower, false);
  await h.debug.setTowerTripTimer(tower, 0);

  // The unit's slow, the same way.
  await h.debug.setUnitSlow(unit, 0.5);
  await h.debug.setUnitSlowTimer(unit, 1000);
  const slowedRuns = (await runsOfOneFrame()).filter((run) => !bare.has(run));
  assertNotEqual(
    lineContaining(slowedRuns, UNIT, "the unit's line, once slowed"),
    unitLine,
    "the unit's overlay line, against the same line while it carried no slow",
  );

  // And the kills, which no pose can set: the gun is given a mark it can kill,
  // with the unit it reports parked far outside its range.
  await h.debug.setUnitPosition(
    unit,
    tileCX(FAR_TILE.col),
    tileCY(FAR_TILE.row),
  );
  const beforeRuns = (await runsOfOneFrame()).filter((run) => !bare.has(run));
  const beforeTower = lineContaining(
    beforeRuns,
    TOWER,
    "the tower's line before it had a kill",
  );
  const mark = await poseTarget(h, MARK, MARK_SITE.col, MARK_SITE.row, MARK_HP);
  await h.debug.setTowerFiring(tower, true);
  await h.until((snapshot) => snapshot.surge.every((e) => e.id !== mark), {
    maxFrames: KILL_FRAMES,
  });
  assertGreaterThan(
    requireTower(await h.snapshot(), tower, "the gun after its shot").kills,
    0,
    "precondition: the gun took the kill its overlay line must report",
  );
  const scoredRuns = (await runsOfOneFrame()).filter((run) => !bare.has(run));
  assertNotEqual(
    lineContaining(scoredRuns, TOWER, "the tower's line, once it has a kill"),
    beforeTower,
    "the tower's overlay line, against the same line before the kill",
  );
});

it("changes nothing about the game", async () => {
  await poseAStillFloor();

  await h.advance(1);
  const before: MeltdownSnapshot = await h.snapshot();

  await toggleOverlay(h);
  const after: MeltdownSnapshot = await h.snapshot();

  // The one field a frame is allowed to move, and by exactly one frame's worth.
  assertCloseTo(
    after.simTime - before.simTime,
    seconds(1),
    TIME_DIGITS,
    "the game time the toggle's own frame added",
  );

  for (const field of [
    "version",
    "screen",
    "phase",
    "menuIndex",
    "mode",
    "difficulty",
    "money",
    "lives",
    "score",
    "wave",
    "waveCount",
    "startMoney",
    "startLives",
    "interest",
    "buildTimer",
    "wavePending",
    "waveRemaining",
    "speed",
    "muted",
    "waveSpawning",
    "autoStep",
    "selected",
    "hoverShop",
  ] as const) {
    assertEqual(
      after[field],
      before[field],
      `${field} across the overlay toggle`,
    );
  }
  for (const field of [
    "nextWave",
    "build",
    "buildZone",
    "pointer",
    "paths",
    "controls",
    "towers",
    "surge",
  ] as const) {
    assertDeepEqual(
      after[field],
      before[field],
      `${field} across the overlay toggle`,
    );
  }
});
