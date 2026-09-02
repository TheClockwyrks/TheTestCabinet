// hunter/reset-on-entering-tile — traffic arriving on the tile a bear is ENTERING
// takes it off the strait.
//
// specs/hunter.md: while a bear is between tiles it occupies both of them, and a
// vehicle in a lane whose speed is above `0` covering EITHER one removes it. This
// item is the tile it is travelling into; `reset-on-leaving-tile` is the tile it
// came from, because a build that reads only the tile a bear is standing on passes
// that one and fails this.
//
// THE POSE MAKES THE TWO TILES COME APART IN TIME. The bear is frozen mid-glide
// between (20, 15) and (21, 15) — its travel off, so it stays exactly there — and
// a car is released on row 15, whose lane `specs/ice.md` runs LEFTWARD. Coming
// from the right, the car covers the tile the bear is ENTERING half a second
// before it reaches the tile the bear came from, so the window this reads is one
// in which only the entering tile is covered.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
import { TILE, laneSpeed, tileCX, tileCY } from "../constants";
import {
  bearStepTile,
  bearTile,
  captureReplay,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { requireBear, samplePerTick, vehicleCoversTile } from "./harness";

/** The row, the tile the bear is leaving, and the tile it is entering. */
const ROW = 15;
const LEAVING_COL = 20;
const ENTERING_COL = LEAVING_COL + 1;

/** Where the car is laid, five columns right of the tile it will reach first. */
const CAR_COL = ENTERING_COL + 5;

/** The level the lane's speed is taken at. */
const LEVEL = 1;

/** Long enough to cover the arrival on both tiles at the specified lane speed. */
const WATCH_SECONDS = 4;

/** Ticks of slack allowed between the tile being covered and the bear being gone. */
const SLACK_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a mid-glide bear when a vehicle reaches the tile it is entering", async () => {
  startCrossing(h, LEVEL);
  const id = poseBear(h, LEAVING_COL, ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  h.debug.setBearStep(id, "right");
  // Frozen exactly half a tile along the step, so it occupies both tiles.
  h.debug.setBearPosition(id, tileCX(LEAVING_COL) + TILE / 2, tileCY(ROW));

  poseLane(h, ROW, "car", [CAR_COL]);
  h.debug.setLaneSpeed(ROW, laneSpeed(ROW, LEVEL));

  // The scenario this check needs, read off the game itself: the bear really is
  // between the two tiles and so occupying both of them. A bear settled on one of
  // them would make the reading below the other rule's rather than this one's.
  const bear = requireBear(h.snapshot(), id, "the mid-glide bear");
  assertDeepEqual(
    bearTile(bear),
    { col: LEAVING_COL, row: ROW },
    "the tile the bear last settled on",
  );
  assertDeepEqual(
    bearStepTile(bear),
    { col: ENTERING_COL, row: ROW },
    "the tile the bear is travelling into",
  );

  const samples = await captureReplay(h, "reset", () =>
    samplePerTick(h, ticksFor(WATCH_SECONDS)),
  );

  const arrival = samples.findIndex((snapshot) =>
    vehicleCoversTile(snapshot, ENTERING_COL, ROW),
  );
  if (arrival === -1) {
    fail(
      `a vehicle over the tile the bear was entering (${ENTERING_COL}, ${ROW}) ` +
        `within ${WATCH_SECONDS} s of the lane being released`,
      "the tile was never covered",
    );
  }

  const verdict = samples[Math.min(arrival + SLACK_TICKS, samples.length - 1)];
  // The window really is the entering tile's alone: the tile the bear came from
  // is still clear, so nothing below could be a reading of that one instead.
  assertEqual(
    vehicleCoversTile(verdict, LEAVING_COL, ROW),
    false,
    `a vehicle over the tile the bear was leaving (${LEAVING_COL}, ${ROW})`,
  );
  assertLength(
    verdict.bears,
    0,
    `the hunt once a vehicle covered the tile the bear was entering ` +
      `(${ENTERING_COL}, ${ROW})`,
  );
});
