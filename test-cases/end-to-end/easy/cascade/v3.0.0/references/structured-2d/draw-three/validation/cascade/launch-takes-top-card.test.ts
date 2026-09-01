// cascade/launch-takes-top-card — each launch takes its foundation's top card.
//
// specs/victory.md: "Each launch takes the current top card of the foundation
// whose turn it is, so each foundation walks its King down to its Ace over its
// turns." A foundation is built Ace at the bottom to King on top, so the card the
// cascade takes off it is its King first and its Ace last.
//
// ALL FOUR FOUNDATIONS ARE WATCHED, each for all thirteen of its turns, which is
// the whole of the sentence: a build that takes the top card off one foundation
// and the bottom card off the other three, or one that takes the King every time,
// reads as a different sequence somewhere. Which foundation the cards come off is
// `launch-cycles-foundations` and is not docked again here — each launch is read
// against the pile that actually shrank on its frame, so a build that cycles the
// slots in another order still has its walks read correctly.
//
// AND EACH LAUNCH IS READ AGAINST THE CARD IT WAS SUPPOSED TO TAKE, suit and rank
// both: `watchLaunches` reports the top card that foundation held on the frame
// before, so a build that launched the right rank of the wrong suit is caught by
// the same sweep at no extra cost. A card is named uniquely in a deck of one each
// by its suit and rank (specs/deal.md); that a launched card keeps the id it
// carried on the table is specs/instrumentation.md's separate statement and is not
// decided here.
//
// Every foundation is posed complete by `startCascade`, Ace through King, so each
// walk this asserts is the full thirteen and the sweep is the whole deck.

import { afterEach, beforeEach, it } from "vitest";
import {
  DECK_SIZE,
  FOUNDATION_COUNT,
  LAUNCH_INTERVAL,
  RANK_MAX,
  RANK_MIN,
} from "../../src/constants";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { captureStill, startCascade, type Harness } from "../harness";
import {
  createFlightHarness,
  flightFrames,
  watchLaunches,
  type Launch,
} from "./flight";

/** The ranks one foundation gives up over its turns: its King down to its Ace. */
const EXPECTED_WALK = Array.from(
  { length: RANK_MAX - RANK_MIN + 1 },
  (_unused, step) => RANK_MAX - step,
);

/**
 * How long the sweep may run for, in frames.
 *
 * The last of the fifty-two launches falls on the fifty-second interval, so a whole
 * deck of intervals plus three covers every one of them with room to spare.
 */
const MAX_FRAMES = flightFrames(LAUNCH_INTERVAL * (DECK_SIZE + 3));

/** The ranks that came off one foundation, in the order they left. */
function walkOf(launches: readonly Launch[], foundation: number): number[] {
  return launches
    .filter((launch) => launch.foundation === foundation)
    .map((launch) => launch.flyer.rank);
}

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("walks every foundation's King down to its Ace", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await watchLaunches(
    harness,
    MAX_FRAMES,
    (seen) => seen.length >= DECK_SIZE,
  );
  captureStill(harness, "walk");

  assertEqual(
    launches.length,
    DECK_SIZE,
    "launches read over the whole cascade",
  );

  for (const [ordinal, launch] of launches.entries()) {
    assertNotNull(
      launch.took,
      `the top card foundation ${launch.foundation} held on the frame before launch ${ordinal}`,
    );
    assertEqual(
      launch.flyer.suit,
      launch.took?.suit,
      `the suit launch ${ordinal} put in flight, against the top card of foundation ${launch.foundation}`,
    );
    assertEqual(
      launch.flyer.rank,
      launch.took?.rank,
      `the rank launch ${ordinal} put in flight, against the top card of foundation ${launch.foundation}`,
    );
  }

  for (let index = 0; index < FOUNDATION_COUNT; index += 1) {
    assertDeepEqual(
      walkOf(launches, index),
      EXPECTED_WALK,
      `the ranks foundation ${index} gave up, in the order they launched`,
    );
  }
});
