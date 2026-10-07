// mazing/top-routes-to-the-bottom-exhaust — a unit from the top vent crosses the
// whole floor and leaves through the bottom exhaust.
//
// specs/floor.md fixes the top vent's opposite exhaust as the bottom one, and
// says a unit that enters at a vent is assigned that vent's opposite exhaust for
// its whole life and never the nearer one, so each stream crosses the whole
// floor. specs/mazing.md: "A unit leaves the floor when the tile its centre
// occupies is one of the opening tiles of its assigned exhaust".
//
// THE SECOND STREAM, ON ITS OWN ITEM. The left stream is
// `mazing/left-routes-to-the-right-exhaust`; this one decides the top stream,
// separately, so a build that wired one vent's exhaust and not the other grades
// differently from one that wired neither.
//
// WHAT IS READ, AND WHY IT IS THE TILE BEFORE THE LAST. A unit is removed on the
// frame its centre reaches an opening tile of its exhaust, so it is never
// observable standing on the tile it left through: what is observable is the last
// tile it was seen on, and that it is then gone from the roster. The sweep keeps
// the last reading taken while the unit was still on the floor, takes the tile
// from that centre by specs/floor.md's own inverse map rather than from the
// `col`/`row` the build reports, and holds it to two things — that it was against
// the bottom casing, and that it was on one of the eight columns the bottom
// exhaust opens onto.
//
// THE SAMPLING. The departure is sampled every `8` frames of this suite's clock,
// which at a Mote's own `60` units per second (specs/surge.md) is `4` logical
// units, well under a tile's `19` (specs/floor.md). So the last sample before the
// unit crosses into the exhaust row lands inside the row before it, which is why
// the bound below is `ROWS - 2` rather than `ROWS - 1`: it is the resolution of
// the reading, not a slackening of the rule.
//
// THE FLOOR IS EMPTY. Which route a unit takes across an open floor is its own
// business — specs/mazing.md fixes no tie-break among equal-cost routes — and
// this point decides only where the crossing ends.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  fail,
} from "../assert";
import { BOTTOM_EXHAUST_COLS, ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  tileAtPoint,
  type Harness,
} from "../harness";
import { unitOf, walkOffTheFloor, type Departure } from "./scenario";

/** The row the sampled departure starts at: five tiles short of the exhaust. */
const APPROACH_ROW = ROWS - 6;

/**
 * How long the coarse approach may run, in seconds of game time.
 *
 * An open top corridor is `35` tiles, or `665` logical units, which a Mote covers
 * in `11.1` s at its own `60` units per second (specs/surge.md). Double that
 * leaves ample room for a build that takes a longer equal-cost route and still
 * bounds one that never arrives.
 */
const APPROACH_SECONDS = 24;

/** How long the sampled departure may run: the last five tiles, doubled over. */
const DEPARTURE_SECONDS = 4;

/** Frames between two samples of the departure: `4` logical units of travel. */
const POLL_FRAMES = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("walks a top-vent unit off the floor through the bottom exhaust", async () => {
  startRun(h);
  const walker = poseWalker(h, "mote", "top");
  assertEqual(
    unitOf(h.snapshot(), walker).exhaust,
    "bottom",
    "a top-vent unit is assigned the bottom exhaust (specs/floor.md)",
  );

  const departure: Departure = await walkOffTheFloor(
    h,
    walker,
    (unit) => tileAtPoint(unit.x, unit.y).row >= APPROACH_ROW,
    {
      approachSeconds: APPROACH_SECONDS,
      departureSeconds: DEPARTURE_SECONDS,
      pollFrames: POLL_FRAMES,
      // The picture is kept with the unit still on the floor, five tiles short of
      // the exhaust: a still taken after it has gone would show an empty floor.
      atApproach: () => captureStill(h, "route"),
    },
  );

  const last = departure.last;
  if (last === null) {
    fail(
      "a unit on the floor to watch across it (specs/instrumentation.md)",
      "the surge roster never held the unit that was added",
    );
  }
  const tile = tileAtPoint(last.x, last.y);

  assertEqual(
    departure.left,
    true,
    `the unit leaves the floor within ${APPROACH_SECONDS + DEPARTURE_SECONDS} ` +
      `s of game time; it was last seen on tile (${tile.col}, ${tile.row}) ` +
      `with ${last.remaining.toFixed(2)} tiles of route left, and whether it ` +
      `had gone was`,
  );
  assertGreaterThanOrEqual(
    tile.row,
    ROWS - 2,
    `the last tile it was seen on is against the bottom casing, which at a ` +
      `${POLL_FRAMES}-frame poll is row ${ROWS - 2} or ${ROWS - 1}; it was ` +
      `last seen on row`,
  );
  assertContains(
    BOTTOM_EXHAUST_COLS,
    tile.col,
    `the last tile it was seen on is on one of the bottom exhaust's columns ` +
      `(specs/floor.md); the column it was last seen on was ${tile.col}, and ` +
      `the columns the exhaust opens onto are`,
  );
});
