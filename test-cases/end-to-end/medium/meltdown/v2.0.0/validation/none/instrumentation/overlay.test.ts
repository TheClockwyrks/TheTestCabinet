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
// WHAT IS ASSERTED, AND WHY IT IS THIS SUBSET. Every fact below is one the build
// panel is specified NOT to draw in the pose this check uses, so finding it in the
// frame is evidence the OVERLAY drew it: `specs/hud.md` gives the panel three
// readouts (money, lives, wave), the shop, the build timer, and an information
// area that with nothing hovered and nothing selected draws only the coming wave.
// It draws no screen or phase name, no mode or difficulty, no score, no heat or
// redline as text — a tower's heat read on the floor is an extent, not a number —
// and a unit's hp as a bar rather than a figure.
//
// AND THE TWO STRONGEST ARE READ BEFORE THE TOGGLE TOO. The posed score and the
// posed hp are four- and three-digit figures nothing else on the panel carries, so
// requiring them absent from the frame BEFORE the backtick and present after it is
// what tells "the overlay reported the game" from "the game happened to have those
// numbers on screen already".
//
// HOW EACH FACT IS MATCHED. A word for a name, a substring for a figure. The
// overlay's LAYOUT is entirely the build's — the specification asks only that each
// source be "short enough to read on a line" — so requiring an exact run of text
// would fail a conformant build over its own formatting. A posed heat of `63`
// reads as `63`, `63.0` or `63.00` and all three carry the substring.
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
  assertMatches,
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
  poseTower,
  poseWalker,
  seconds,
  startRun,
  toggleOverlay,
  type DrawCall,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/** The floor the overlay is read over, posed to distinguishing figures. */
const TOWER: TowerType = "lance";
const POSED_HEAT = 63;
const UNIT = "hulk";
const POSED_HP = 137;
const POSED_MAX_HP = 300;
const POSED_SCORE = 6821;

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

/** Everything the frame drew, as one string a figure can be looked for in. */
function textOf(calls: readonly DrawCall[]): string {
  return drawnText(calls).join(" | ");
}

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
async function poseAStillFloor(): Promise<void> {
  await startRun(h);
  await h.debug.setPhase("opening");
  await h.debug.setBuildTimer(0);
  await h.debug.setScore(POSED_SCORE);

  const tower = await poseTower(h, TOWER, TOWER_SITE.col, TOWER_SITE.row);
  await h.debug.setTowerFiring(tower, false);
  await h.debug.setTowerThermal(tower, false);
  await h.debug.setTowerHeat(tower, POSED_HEAT);

  const unit = await poseWalker(h, UNIT, "left");
  await h.debug.setUnitMotion(unit, false);
  await h.debug.setUnitPosition(
    unit,
    tileCX(UNIT_TILE.col),
    tileCY(UNIT_TILE.row),
  );
  await h.debug.setUnitMaxHp(unit, POSED_MAX_HP);
  await h.debug.setUnitHp(unit, POSED_HP);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the game's own facts once the backtick opens it", async () => {
  await poseAStillFloor();

  // The frame before the toggle: the panel alone.
  const closed = textOf(await h.frameCalls());
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
  const drawn = textOf(opened);

  // The screen, the phase, the mode and the difficulty, as words.
  for (const word of ["playing", "opening", "containment", "medium"]) {
    assertEqual(drewWord(opened, word), true, `the overlay drew "${word}"`);
  }
  // The tower and the unit, named.
  for (const word of [TOWER, UNIT]) {
    assertEqual(drewWord(opened, word), true, `the overlay drew "${word}"`);
  }
  // And the figures, as substrings, because how each is formatted is the build's.
  assertMatches(drawn, String(POSED_SCORE), "the overlay drew the score");
  assertMatches(drawn, String(POSED_HEAT), "the overlay drew the tower's heat");
  assertMatches(
    drawn,
    String(TOWER_DEF.redline),
    "the overlay drew the tower's redline",
  );
  assertMatches(drawn, String(POSED_HP), "the overlay drew the unit's hp");
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
