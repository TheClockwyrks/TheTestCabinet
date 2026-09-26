// Floe — instrumentation/reset-restores-title: `reset()` puts every declared
// field back to the title-screen value the specification lists, and leaves
// `muted` where it stands.
//
// `specs/instrumentation.md` writes the list out in one sentence: `reset`
// restores `screen` to `title`, `menuIndex` to `0`, `phase` to `crossing`,
// `phaseTimer` to `0`, `score` to `0`, `lives` to `START_LIVES` (`3`), `level` to
// `1`, `reachedLevel` to `1`, `timer` to `crossingTimer(1)`, "the sixteen lanes
// laid out as level `1` lays them out, no critter, no bears, five open bays, no
// bonus catch, `simTime` `0`, and the four world gates back on". Every one of
// those is read below, in that order.
//
// EVERY FIELD IS POSED AWAY FROM ITS TITLE VALUE FIRST. A reset that restored
// nothing would pass on a game already sitting at its title, so the run this
// point resets is one in which not a single one of those fields holds the value
// it is about to be restored to: a score, a level and a reached level well into
// a run, one life, a menu row that is not the first, a screen and a phase that
// are neither, a hold running, a crossing timer nearly out, a critter and two
// bears on the strait, three bays filled, a bonus catch out, one lane stopped and
// turned around, all four gates held off, and accumulated simulation time.
//
// THE LANES ARE THE READING THAT DISTINGUISHES A REBUILD FROM A RESTORE. The run
// is posed at level `6`, whose sixteen lanes run about a third faster than level
// `1`'s (`LEVEL_SPEED_STEP` `1.06` per level, `specs/ice.md`), and one of them is
// stopped and reversed on top of that. So a build that empties the rosters
// without laying level `1` out again reports level `6`'s speeds, or a stopped
// lane, and is named for exactly that.
//
// `muted` IS THE ONE FIELD THAT MUST SURVIVE. "`muted` is left as it stands,
// because muting is a player preference the runtime owns"
// (`specs/instrumentation.md`), so the bit is read immediately before the reset
// and held to that same reading afterwards. The mute binding is pressed first so
// the bit under test is more likely to be the interesting one, but the comparison
// is against what the snapshot ACTUALLY reported a moment earlier — whether that
// binding works is `controls/mute-m`'s point, and a build that failed it must not
// fail this one too.
//
// NO TICK RUNS BETWEEN THE RESET AND THE READING. `simTime` "adds `TICK_DT` on
// every tick whatever the screen", so a check that drove a tick first would be
// reading the update rather than the reset.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  BAY_COUNT,
  BINDINGS,
  ICE_LANES,
  START_LIVES,
  WATER_LANES,
  crossingTimer,
  laneSpeed,
  type Phase,
  type Screen,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
  type LaneView,
} from "../harness";

/** The run posed before the reset — not one of these is a title-screen value. */
const SCORE = 8800;
const LIVES = 1;
const LEVEL = 6;
const REACHED_LEVEL = 6;
const MENU_INDEX = 3;
const SCREEN: Screen = "paused";
const PHASE: Phase = "clearing";
const PHASE_TIMER = 1.25;
const TIMER = 4.5;

/** Where the posed critter stands, and where the two posed bears settle. */
const CRITTER_COL = 11;
const CRITTER_ROW = 14;
const BEAR_TILES: readonly (readonly [number, number])[] = [
  [5, 15],
  [30, 12],
];

/** The lane posed away from its own motion: stopped, and turned around. */
const STOPPED_ROW = 12;
const STOPPED_DIR = -1; // specs/ice.md runs row 12 rightward at level 1

/** The bays posed filled, and the bay the posed bonus catch sits in. */
const FILLED_BAYS: readonly number[] = [0, 2, 4];
const FISH_BAY = 1;

/** Seconds of stepped game time run first, so `simTime` is something to restore. */
const PLAY_SECONDS = 0.4;

/**
 * How far a restored lane's speed may sit from the level-1 figure, as
 * `assertCloseTo` digits.
 *
 * Six digits is `5e-7` tiles per second. `laneSpeed(row, 1)` is the table's own
 * figure — `LEVEL_SPEED_STEP` raised to the power `0` — so the only distance a
 * conforming build can be from it is the arithmetic's, and level `6`'s speeds,
 * which is what a build that failed to re-lay the lanes reports, are a third
 * away.
 */
const SPEED_DIGITS = 6;

/** Five open bays, which is what `reset` leaves behind. */
const ALL_OPEN: boolean[] = Array.from({ length: BAY_COUNT }, () => false);

/** Every lane of a band, held to the rows and the level-1 motion its table fixes. */
function assertBand(
  lanes: readonly LaneView[],
  table: readonly { row: number; dir: number; speed: number }[],
  band: string,
): void {
  assertLength(lanes, table.length, `the ${band} lanes after reset()`);
  for (const [index, lane] of lanes.entries()) {
    const spec = table[index];
    assertEqual(
      lane.row,
      spec.row,
      `the row of ${band} lane ${index} after reset(), which lays the band ` +
        `out in ascending row order`,
    );
    assertEqual(
      lane.dir,
      spec.dir,
      `the direction of the lane on row ${spec.row} after reset()`,
    );
    assertCloseTo(
      lane.speed,
      laneSpeed(spec.row, 1),
      SPEED_DIGITS,
      `the speed of the lane on row ${spec.row} after reset(), in tiles per ` +
        `second, against what level 1 lays it out at`,
    );
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores every declared field to its title value and leaves muted alone", async () => {
  // The runtime's mute bit, reached the only way there is: the real binding
  // (specs/instrumentation.md, What the runtime provides instead).
  await h.tap(BINDINGS.mute[0]);

  // A quiet crossing, then some stepped time on it, so `simTime` has something
  // to be restored from.
  await startCrossing(h);
  await h.advance(ticksFor(PLAY_SECONDS));

  // The run posed away from every title value.
  await h.debug.setLevel(LEVEL);
  await h.debug.setLaneSpeed(STOPPED_ROW, 0);
  await h.debug.setLaneDirection(STOPPED_ROW, STOPPED_DIR);
  await h.debug.addCritter(CRITTER_COL, CRITTER_ROW);
  for (const [col, row] of BEAR_TILES) {
    await poseBear(h, col, row, {
      sense: false,
      routing: false,
      travel: false,
    });
  }
  for (const bay of FILLED_BAYS) await h.debug.setBay(bay, true);
  await h.debug.setFishBay(FISH_BAY);
  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setReachedLevel(REACHED_LEVEL);
  await h.debug.setMenuIndex(MENU_INDEX);
  await h.debug.setTimer(TIMER);
  await h.debug.setPhaseTimer(PHASE_TIMER);
  await h.debug.setScreen(SCREEN);
  await h.debug.setPhase(PHASE);

  const before = await h.snapshot();
  assertGreaterThan(
    before.simTime,
    0,
    `the simulation time accumulated before the reset, which ` +
      `specs/instrumentation.md returns to 0 — with none accrued there would ` +
      `be nothing to restore`,
  );

  await h.debug.reset();
  // Read with no tick between: simTime adds TICK_DT on every tick whatever the
  // screen, so a tick run here would be read as the update rather than the reset.
  const title = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing reset still leaves the picture of the
  // screen it produced.
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "snapshot().screen after reset()");
  assertEqual(title.menuIndex, 0, "snapshot().menuIndex after reset()");
  assertEqual(title.phase, "crossing", "snapshot().phase after reset()");
  assertEqual(title.phaseTimer, 0, "snapshot().phaseTimer after reset()");
  assertEqual(title.score, 0, "snapshot().score after reset()");
  assertEqual(
    title.lives,
    START_LIVES,
    `snapshot().lives after reset(), which specs/instrumentation.md restores ` +
      `to START_LIVES (${START_LIVES})`,
  );
  assertEqual(title.level, 1, "snapshot().level after reset()");
  assertEqual(title.reachedLevel, 1, "snapshot().reachedLevel after reset()");
  assertCloseTo(
    title.timer,
    crossingTimer(1),
    SPEED_DIGITS,
    `snapshot().timer after reset(), in seconds, which specs/` +
      `instrumentation.md restores to crossingTimer(1) (${crossingTimer(1)} s)`,
  );

  // The sixteen lanes, laid out as level 1 lays them out.
  assertBand(title.iceLanes, ICE_LANES, "ice");
  assertBand(title.waterLanes, WATER_LANES, "water");
  assertGreaterThan(
    title.vehicles.length,
    0,
    "the vehicles on the ice band after reset(), which lays the strait out " +
      "for level 1 (specs/ice.md gives every lane enough to reach both edges)",
  );
  assertGreaterThan(
    title.floes.length,
    0,
    "the floes on the water band after reset(), which lays the strait out " +
      "for level 1 (specs/water.md)",
  );

  assertEqual(
    title.critter.present,
    false,
    "snapshot().critter.present after reset(), which leaves no critter on " +
      "the strait",
  );
  assertLength(title.bears, 0, "the bears on the strait after reset()");
  assertDeepEqual(title.bays, ALL_OPEN, "the five bays after reset()");
  assertEqual(title.fishBay, null, "snapshot().fishBay after reset()");
  assertEqual(title.simTime, 0, "snapshot().simTime after reset()");

  assertEqual(
    title.bearEmergence,
    true,
    "snapshot().bearEmergence after reset(), which turns the four world " +
      "gates back on",
  );
  assertEqual(title.catchTest, true, "snapshot().catchTest after reset()");
  assertEqual(title.fishCadence, true, "snapshot().fishCadence after reset()");
  assertEqual(
    title.timerRunning,
    true,
    "snapshot().timerRunning after reset()",
  );

  // And the one field reset must not touch.
  assertEqual(
    title.muted,
    before.muted,
    "snapshot().muted after reset(), against the bit the snapshot reported a " +
      "moment before it — muting is a player preference the runtime owns, and " +
      "reset leaves it exactly as it stands",
  );
});
