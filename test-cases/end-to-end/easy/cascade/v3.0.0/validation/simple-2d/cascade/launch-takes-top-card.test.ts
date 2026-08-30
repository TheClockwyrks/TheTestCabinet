// cascade/launch-takes-top-card — each launch takes its foundation's top card.
//
// specs/victory.md: "Each launch takes the current top card of the foundation whose
// turn it is, so each foundation walks its King down to its Ace over its turns." A
// foundation is built Ace at the bottom to King on top, so the card the cascade
// takes off it is its King first and its Ace last.
//
// One foundation is watched, and it is watched for all thirteen of its turns, which
// is the whole of the sentence: a build that takes the top card once and the bottom
// card thereafter, or one that takes the King every time, reads as a different
// sequence. Which foundation the cards come off is `launch-cycles-foundations`, so
// this reads the ranks alone, of the cards that came off foundation `WATCHED`.
//
// The foundation is posed complete by `startCascade`, Ace through King, so the walk
// this asserts is the full thirteen.

import { afterEach, beforeEach, it } from "vitest";
import {
  DECK_SIZE,
  LAUNCH_INTERVAL,
  RANK_MAX,
  RANK_MIN,
} from "../../src/constants";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startCascade,
  type Harness,
} from "../harness";
import { watchLaunches, type Launch } from "./flight";

/** The foundation whose walk is read. Its first turn is the cascade's first launch. */
const WATCHED = 0;

/** The ranks that foundation gives up over its turns: its King down to its Ace. */
const EXPECTED_WALK = Array.from(
  { length: RANK_MAX - RANK_MIN + 1 },
  (_unused, step) => RANK_MAX - step,
);

/**
 * How long the sweep may run for, in frames.
 *
 * The watched foundation's last turn is the cascade's forty-ninth launch, so a whole
 * deck of intervals covers it with three launches to spare.
 */
const MAX_FRAMES = framesFor(LAUNCH_INTERVAL * DECK_SIZE);

/** The ranks that came off the watched foundation, in the order they left. */
function walkOf(launches: readonly Launch[]): number[] {
  return launches
    .filter((launch) => launch.foundation === WATCHED)
    .map((launch) => launch.flyer.rank);
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("walks the foundation's King down to its Ace", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await watchLaunches(
    harness,
    MAX_FRAMES,
    (seen) => walkOf(seen).length >= EXPECTED_WALK.length,
  );
  captureStill(harness, "walk");

  assertDeepEqual(
    walkOf(launches),
    EXPECTED_WALK,
    `the ranks foundation ${WATCHED} gave up, in the order they launched`,
  );
});
