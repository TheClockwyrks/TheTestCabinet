// scoring/death-scores-nothing-crush — a life lost to a vehicle pays nothing.
//
// The second of `specs/progression.md`'s three ways a crossing ends badly, read
// for what `specs/scoring.md` pays for it: nothing. `scoring/death.ts` beside
// this file carries the reasoning the three share, the posed score, and the two
// readings each of them is decided on.
//
// ONE CAR ON ONE LANE, posed three tiles short of the critter's column and given
// a speed and a direction of this check's own, so the arrival is this check's
// rather than the level's traffic happening to reach the same tile.
//
// WHAT THIS DOES NOT DECIDE. That a crush costs a life at all is
// `progression/crush-costs-life`; a drowning and a catch are the two points
// beside this one. This point is the score, across a vehicle arriving on the
// critter.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_COL } from "../constants";
import {
  createHarness,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { POSED_SCORE, die, scoredNothing } from "./death";

/** The ice row a crush is taken on, and where the car starts. */
const ICE_ROW = 15;
const CAR_COL = START_COL - 3;

/** The speed and direction this check gives the crushing lane. */
const LANE_SPEED = 2;
const LANE_DIR = 1;

/**
 * One second of lane motion: the middle of the window the car covers the
 * critter's column in, which `progression/crush-costs-life` works out in full.
 */
const CRUSH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the score exactly as it stood through a crush", async () => {
  await startCrossing(h);
  await h.debug.setScore(POSED_SCORE);
  await poseLane(h, ICE_ROW, "car", [CAR_COL]);
  await h.debug.setCritterTile(START_COL, ICE_ROW);
  await h.debug.setLaneDirection(ICE_ROW, LANE_DIR);
  await h.debug.setLaneSpeed(ICE_ROW, LANE_SPEED);

  const before = await h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the crush");
  assertEqual(
    before.vehicles.length,
    1,
    "one car on the ice band, posed three tiles short of the critter",
  );

  scoredNothing(
    "a vehicle arriving on the critter",
    await die(h, "score", CRUSH_TICKS),
  );
});
