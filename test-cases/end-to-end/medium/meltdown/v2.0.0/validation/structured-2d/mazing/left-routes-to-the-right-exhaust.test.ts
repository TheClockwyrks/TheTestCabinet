// mazing/left-routes-to-the-right-exhaust — a unit from the left vent crosses the
// whole floor and leaves through the right exhaust.
//
// specs/floor.md: each vent has a fixed opposite exhaust — `left` to `right` —
// and a unit that enters at a vent is assigned that vent's opposite exhaust for
// its whole life and never the nearer one, so each stream crosses the whole
// floor. specs/mazing.md: "A unit leaves the floor when the tile its centre
// occupies is one of the opening tiles of its assigned exhaust".
//
// WHAT IS READ, AND WHY IT IS THE TILE BEFORE THE LAST. A unit is removed on the
// frame its centre reaches an opening tile of its exhaust, so it is never
// observable standing on the tile it left through: what is observable is the last
// tile it was seen on, and that it is then gone from the roster. So the sweep
// keeps the last reading taken while the unit was still on the floor, takes the
// tile from that centre by specs/floor.md's own inverse map rather than from the
// `col`/`row` the build reports, and holds it to two things — that it was against
// the right casing, and that it was on one of the four rows specs/floor.md opens
// the right exhaust onto. A build that walked the unit out of the bottom exhaust,
// or one that walked it into the casing and left it there, is named by the tile
// it was last seen on.
//
// THE SAMPLING. The departure is sampled every `8` frames of this suite's clock,
// which at a Mote's own `60` units per second (specs/surge.md) is `4` logical
// units, well under a tile's `19` (specs/floor.md). So the last sample before the
// unit crosses into the exhaust column lands inside the column before it, which
// is why the bound below is `COLS - 2` rather than `COLS - 1`: it is the
// resolution of the reading, not a slackening of the rule.
//
// THE FLOOR IS EMPTY. Which route a unit takes across an open floor is its own
// business — specs/mazing.md fixes no tie-break among equal-cost routes — and
// this point decides only where the crossing ENDS. A wall would add a requirement
// this item does not carry; `mazing/towers-block-tiles` and
// `mazing/tower-lengthens-the-route` carry that one.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, RIGHT_EXHAUST_ROWS } from "../../src/constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  fail,
} from "../assert";
import {
  captureReplay,
  createHarness,
  poseWalker,
  startRun,
  tileAtPoint,
  type Harness,
} from "../harness";
import { unitOf, walkOffTheFloor, type Departure } from "./scenario";

/**
 * The column the sampled departure starts at: five tiles short of the exhaust.
 *
 * Everything before it is walked at a coarse poll, which is what keeps a
 * sixteen-second crossing from costing a thousand snapshots for a reading taken
 * once.
 */
const APPROACH_COL = COLS - 6;

/**
 * How long the coarse approach may run, in seconds of game time.
 *
 * An open left corridor is `49` tiles, or `931` logical units, which a Mote
 * covers in `15.5` s at its own `60` units per second (specs/surge.md). Double
 * that leaves ample room for a build that takes a longer equal-cost route and
 * still bounds one that never arrives.
 */
const APPROACH_SECONDS = 32;

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

it("walks a left-vent unit off the floor through the right exhaust", async () => {
  startRun(h);
  const walker = poseWalker(h, "mote", "left");
  assertEqual(
    unitOf(h.snapshot(), walker).exhaust,
    "right",
    "a left-vent unit is assigned the right exhaust (specs/floor.md)",
  );

  const departure = await captureReplay(
    h,
    "crossing",
    (): Promise<Departure> =>
      walkOffTheFloor(
        h,
        walker,
        (unit) => tileAtPoint(unit.x, unit.y).col >= APPROACH_COL,
        {
          approachSeconds: APPROACH_SECONDS,
          departureSeconds: DEPARTURE_SECONDS,
          pollFrames: POLL_FRAMES,
        },
      ),
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
    tile.col,
    COLS - 2,
    `the last tile it was seen on is against the right casing, which at a ` +
      `${POLL_FRAMES}-frame poll is column ${COLS - 2} or ${COLS - 1}; it was ` +
      `last seen on column`,
  );
  assertContains(
    RIGHT_EXHAUST_ROWS,
    tile.row,
    `the last tile it was seen on is on one of the right exhaust's rows ` +
      `(specs/floor.md); the row it was last seen on was ${tile.row}, and the ` +
      `rows the exhaust opens onto are`,
  );
});
