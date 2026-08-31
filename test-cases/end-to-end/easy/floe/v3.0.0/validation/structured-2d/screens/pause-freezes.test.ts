// Floe — screens/pause-freezes: nothing on the strait moves while the pause menu
// is showing.
//
// `specs/progression.md` owns the rule, under "What pausing suspends": "The
// `paused` screen suspends the simulation. While it is showing, no lane item,
// critter, bear, or bonus catch moves, the crossing timer does not drain, and no
// hold advances." `specs/ui.md` says the same thing from the screen's side — the
// `paused` screen shows "The strait, visible and frozen". This point reads the
// three bodies the item names: every lane item's `x`, and the centres of the
// critter and of the bear.
//
// EVERYTHING READ WOULD BE MOVING IF THE SCREEN WERE NOT PAUSED, WHICH IS THE
// WHOLE OF THE ARRANGEMENT. A frozen reading off a body that was never going
// anywhere grades nothing, so each of the three is posed with the faculty that
// would carry it:
//
//   - A vehicle sits on an ice lane running rightward and a floe on a water lane
//     running leftward, both at speeds this check chose. Two bands and two
//     directions, because they are two rosters (`specs/instrumentation.md`) and a
//     build that suspended one and not the other must fail.
//   - The critter stands on that floe, so its footing is `floe` and the lane
//     would carry it (`specs/water.md`). It is the only way a critter moves
//     without a key, and it is what makes "the critter holds its centre" a
//     reading rather than a tautology.
//   - A bear is settled on the median and committed to one step with
//     `setBearStep`, which commits it to travel one tile at the speed its footing
//     gives (`specs/instrumentation.md`). Its sense and its routing are posed
//     off, so the step is exactly the one this check committed and no route can
//     redirect it: a build that failed to suspend the bears reads a whole tile of
//     travel, `TILE` units away from where the pose left it.
//
// THE TICKS REALLY RAN, AND THE CHECK PROVES IT. A build that answered `advance`
// with nothing at all while paused would hold every one of those readings and
// deserve none of them, so `simTime` is read across the same span:
// `specs/instrumentation.md` makes it add `TICK_DT` on every tick whatever the
// screen and calls it the one quantity that keeps accumulating while the screen
// is `paused`. Three seconds of ticks must show up there.
//
// THE TOLERANCE IS FLOAT NOISE AND NOTHING ELSE. A suspended simulation does not
// integrate, so a frozen body's stored position is the number that was stored;
// the allowance below is a millionth of a stage unit, which no arithmetic a build
// does to hold a value still can exceed and which nothing that actually advanced
// can hide inside. The smallest displacement any of the three bodies would show
// over this span is the bear's single tile, `TILE` (`32`) units.
//
// THE SCREEN IS POSED, NOT PAUSED WITH A KEY, so a build whose pause key is dead
// loses `controls/pause-p` and still has the suspension graded here.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, fail } from "../assert";
import { TICK_DT, TILE } from "../../src/constants";
import {
  bearById,
  captureReplay,
  createHarness,
  floeById,
  laneAt,
  poseBear,
  poseLane,
  seconds,
  startCrossing,
  ticksFor,
  vehicleById,
  type BearSnapshot,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The ice lane that must hold: its row, its vehicle's column, its speed, its direction. */
const ICE_ROW = 15;
const ICE_COL = 10;
const ICE_SPEED = 2;
const ICE_DIR = 1;

/** The water lane that must hold, running the other way, with the critter aboard. */
const WATER_ROW = 6;
const WATER_COL = 16;
const WATER_SPEED = 1.5;
const WATER_DIR = -1;

/** Where the critter stands: a tile of the posed `raft4`, which spans four. */
const CRITTER_COL = WATER_COL + 2;

/** Where the bear is settled, and the step it is committed to. */
const BEAR_COL = 25;
const BEAR_ROW = 10; // the median: solid footing, and open to a bear
const BEAR_STEP = "left" as const;

/** The stretch of paused the readings are taken over, in ticks. Three seconds. */
const SPAN = ticksFor(3);

/**
 * How far a suspended body may drift, in stage units.
 *
 * A millionth of a unit: a suspended simulation integrates nothing, so a frozen
 * position is the number that was stored, and this covers only the noise of a
 * build that re-derives it rather than holding it. The smallest displacement a
 * build that failed to suspend would show is the bear's one tile, `TILE` (`32`)
 * units — seven orders of magnitude clear of it.
 */
const FREEZE_TOLERANCE = 1e-6;

/**
 * How far `simTime` may fall from the span the check drove, in seconds.
 *
 * One tick, so a build that stamps its accumulator at either end of a tick is not
 * marked down for it. A build that ran no ticks at all reads `0` against three
 * seconds.
 */
const SIM_TOLERANCE = TICK_DT;

/** The bear with that id, or a named failure: a roster that lost it is a defect. */
function requireBear(
  snapshot: FloeSnapshot,
  id: number,
  what: string,
): BearSnapshot {
  const bear = bearById(snapshot, id);
  if (bear === undefined) {
    fail(`${what} still on the strait, as bear ${id}`, snapshot.bears);
  }
  return bear;
}

/** The `x` of the lane item with that id, or a named failure. */
function itemX(snapshot: FloeSnapshot, id: number, what: string): number {
  const item = vehicleById(snapshot, id) ?? floeById(snapshot, id);
  if (item === undefined) {
    fail(`${what} still on its lane, as item ${id}`, {
      vehicles: snapshot.vehicles,
      floes: snapshot.floes,
    });
  }
  return item.x;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds every lane item, the critter and the bear over three seconds of paused", async () => {
  startCrossing(h);

  const [vehicle] = poseLane(h, ICE_ROW, "car", [ICE_COL]);
  h.debug.setLaneDirection(ICE_ROW, ICE_DIR);
  h.debug.setLaneSpeed(ICE_ROW, ICE_SPEED);

  const [floe] = poseLane(h, WATER_ROW, "raft4", [WATER_COL]);
  h.debug.setLaneDirection(WATER_ROW, WATER_DIR);
  h.debug.setLaneSpeed(WATER_ROW, WATER_SPEED);
  h.debug.setCritterTile(CRITTER_COL, WATER_ROW);

  const bear = poseBear(h, BEAR_COL, BEAR_ROW, {
    sense: false,
    routing: false,
  });
  h.debug.setBearTarget(bear, BEAR_COL, BEAR_ROW);
  h.debug.setBearStep(bear, BEAR_STEP);

  h.debug.setScreen("paused");

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    laneAt(posed, ICE_ROW)?.speed,
    ICE_SPEED,
    "an ice lane that would be carrying its vehicle",
  );
  assertEqual(
    laneAt(posed, WATER_ROW)?.speed,
    WATER_SPEED,
    "a water lane that would be carrying its floe",
  );
  assertEqual(
    posed.critter.footing,
    "floe",
    "the critter aboard that floe, so the lane would carry it too",
  );
  assertEqual(
    requireBear(posed, bear, "the bear this check committed to a step").travel,
    true,
    "a bear whose locomotion would carry out the step it was given",
  );

  const { before, after } = await captureReplay(h, "pause", async () => {
    const opened = h.snapshot();
    await h.advance(SPAN);
    return { before: opened, after: h.snapshot() };
  });

  assertEqual(
    after.screen,
    "paused",
    "the whole span read from the paused screen",
  );
  assertBetween(
    after.simTime - before.simTime,
    seconds(SPAN) - SIM_TOLERANCE,
    seconds(SPAN) + SIM_TOLERANCE,
    `${seconds(SPAN)} s of ticks really ran while the screen was paused ` +
      `(specs/instrumentation.md: simTime keeps accumulating)`,
  );

  assertBetween(
    itemX(after, vehicle, "the vehicle that must hold") -
      itemX(before, vehicle, "the vehicle that must hold"),
    -FREEZE_TOLERANCE,
    FREEZE_TOLERANCE,
    "the vehicle holds its x while paused (specs/progression.md)",
  );
  assertBetween(
    itemX(after, floe, "the floe that must hold") -
      itemX(before, floe, "the floe that must hold"),
    -FREEZE_TOLERANCE,
    FREEZE_TOLERANCE,
    "the floe holds its x while paused (specs/progression.md)",
  );

  assertBetween(
    after.critter.x - before.critter.x,
    -FREEZE_TOLERANCE,
    FREEZE_TOLERANCE,
    "the critter holds its centre x while paused, uncarried (specs/progression.md)",
  );
  assertBetween(
    after.critter.y - before.critter.y,
    -FREEZE_TOLERANCE,
    FREEZE_TOLERANCE,
    "and holds its centre y (specs/progression.md)",
  );

  const bearFrom = requireBear(before, bear, "the bear that must hold");
  const bearTo = requireBear(after, bear, "the bear that must hold");
  assertBetween(
    bearTo.x - bearFrom.x,
    -FREEZE_TOLERANCE,
    FREEZE_TOLERANCE,
    `the bear holds its centre x while paused rather than travelling the ` +
      `${TILE} units of its committed step (specs/progression.md)`,
  );
  assertBetween(
    bearTo.y - bearFrom.y,
    -FREEZE_TOLERANCE,
    FREEZE_TOLERANCE,
    "and holds its centre y (specs/progression.md)",
  );
});
