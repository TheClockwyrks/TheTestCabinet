// rocks/drift-speed-medium — a Medium the star returns enters inside its own range.
//
// `specs/rocks.md`, The three sizes: a rock's "base drift speed is the speed it
// enters the field with, drawn uniformly from its size's range", and the table
// gives `medium` `ROCK_SPEED_MIN.medium` to `ROCK_SPEED_MAX.medium` (`90` to `150`).
// Star recycling names the same figure from the other side: a recycled rock
// re-enters "at a fresh base drift speed drawn from its size's range".
//
// A RECYCLE IS THE ONLY WAY THIS SIZE ENTERS THE FIELD, which is why this item is
// posed the way it is. `specs/progression.md` fills a wave with Large rocks alone,
// and every Medium that ever exists arrives either as a fragment of the size above
// — whose velocity `specs/collision.md` fixes as its parent's plus a kick, not as a
// base drift speed — or out of the star. So the entry the range governs is the
// recycle, and that is what the check drives.
//
// EVERY ENTRY, NOT ONE. The speed is a draw, so a single reading says almost
// nothing: a build that always returns a rock at one fixed speed inside the window
// passes one reading, and so does a build whose draw is nearly always right. The
// check slings 5 Mediums through the star, one after another on a field emptied
// between each, and holds every one of the 5 entry speeds against the window.
// Nothing is posed for the speed: `setNextRockSpeed` is how a check that wants a
// particular one gets it, and this check wants the build's own draw, made afresh at
// each re-entry (`specs/rocks.md`).
//
// THE WINDOW IS THE SPECIFICATION'S AND THE TOLERANCE IS THE REVIEW ITEM'S, two
// percent, which is `1.8` units per second below `90` and `3.0` above `150`. That
// is room for a build's own arithmetic and for the third of a unit per second the
// well adds over the single tick between the re-entry and the reading — the nearest
// point of any edge is `360` units from the star (`specs/field.md`), where
// `specs/gravity.md` pulls at `34.7` units per second squared. It is not room on the
// figure: a build that returns a rock at rest, or at the speed it went in, reads
// hundreds of units outside.
//
// THE FIELD HOLDS ONE ROCK AND NOTHING ELSE. `startPlaying` empties every roster and
// shuts both world gates before each sling, the rock is dropped from straight above
// the star's centre so the well's pull is exactly along its fall, and the recycle is
// found as a move of more than `200` units inside one tick — which nothing drifting
// can produce, so a build with no recycling in it fails rather than being read as one.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { ROCK_SPEED_MAX, ROCK_SPEED_MIN } from "../constants";
import { magnitude } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";
import {
  FALL_FROM,
  FALL_SPEED,
  poseRockAt,
  slingIntoTheStar,
  theOneRock,
} from "./scene";

/** How many entries are read: a draw is not decided by one of them. */
const ENTRIES = 5;

/** How far outside the range a reading may sit: two percent, the item's figure. */
const TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-enters every Medium inside a Medium's base drift speed range", async () => {
  const speeds: number[] = [];
  for (let entry = 0; entry < ENTRIES; entry += 1) {
    await startPlaying(h);
    await poseRockAt(h, "medium", FALL_FROM, { x: 0, y: FALL_SPEED });
    const recycle = await slingIntoTheStar(h);
    if (entry === 0) await captureStill(h, "entry");
    speeds.push(
      magnitude(velocityOf(theOneRock(recycle.at, "the recycled Medium"))),
    );
  }

  for (const [entry, speed] of speeds.entries()) {
    assertBetween(
      speed,
      ROCK_SPEED_MIN.medium * (1 - TOLERANCE),
      ROCK_SPEED_MAX.medium * (1 + TOLERANCE),
      `entry ${entry + 1} of ${ENTRIES}: the base drift speed a recycled Medium enters at (specs/rocks.md)`,
    );
  }
});
