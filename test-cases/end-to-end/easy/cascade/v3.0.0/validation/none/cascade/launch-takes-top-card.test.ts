// cascade/launch-takes-top-card — a launch takes the foundation's top card.
//
// specs/victory.md: "Each launch takes the current top card of the foundation
// whose turn it is, so each foundation walks its King down to its Ace over its
// turns, and the cascade launches all fifty-two cards."
//
// Every one of the fifty-two launches is read, and each against the foundation
// it actually came from: `readLaunches` reports the pile that shrank and that
// pile's top card immediately before the launch. So this decides the top-card
// rule without resting on the launch ORDER being right —
// `launch-cycles-foundations` is the point that grades the order, and a build
// that cycles wrongly but always takes the top card passes here.
//
// The walk is read the way the review item states it: the ranks one foundation
// gave up, in the order it gave them up, are King down to Ace. A foundation is
// built Ace up to King (`specs/foundations.md`), so that sequence is exactly what
// "the current top card, every time" produces, and it is the reading a wrong
// model shows up in — a build taking the BOTTOM card walks Ace up instead, and a
// build taking a fixed card repeats one rank.
//
// A card is identified by its suit and rank, which name it uniquely in a deck
// with one of each (`specs/deal.md`). That a launched card keeps the id it
// carried on the table is `specs/instrumentation.md`'s separate statement and is
// not decided here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { DECK_SIZE, FOUNDATION_COUNT, RANK_MAX, RANK_MIN } from "../constants";
import { type Harness, captureStill, createHarness } from "../harness";
import { openCascade, readLaunches } from "./flight";

/**
 * The launch the still is taken on: the last of the first three full rounds, by
 * which point every foundation has visibly walked King, Queen, Jack into the air.
 */
const STILL_AFTER = 3 * FOUNDATION_COUNT;

/** King down to Ace: what one foundation gives up over its thirteen turns. */
const WALK: number[] = [];
for (let rank = RANK_MAX; rank >= RANK_MIN; rank -= 1) WALK.push(rank);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("launches the top card of the foundation it came from, every time", async () => {
  await openCascade(harness);

  const opening = await readLaunches(harness, STILL_AFTER);
  await captureStill(harness, "walk");
  const rest = await readLaunches(harness, DECK_SIZE - STILL_AFTER);

  const launches = [...opening, ...rest];
  assertEqual(
    launches.length,
    DECK_SIZE,
    "launches read over the whole cascade",
  );

  for (const launch of launches) {
    assertEqual(
      launch.flyer.suit,
      launch.took.suit,
      `the suit launch ${launch.ordinal} put in flight, against the top card of foundation ${launch.foundation}`,
    );
    assertEqual(
      launch.flyer.rank,
      launch.took.rank,
      `the rank launch ${launch.ordinal} put in flight, against the top card of foundation ${launch.foundation}`,
    );
  }

  for (let index = 0; index < FOUNDATION_COUNT; index += 1) {
    const walked = launches
      .filter((launch) => launch.foundation === index)
      .map((launch) => launch.flyer.rank);
    assertDeepEqual(
      walked,
      WALK,
      `the ranks foundation ${index} launched, in the order it launched them`,
    );
  }
});
