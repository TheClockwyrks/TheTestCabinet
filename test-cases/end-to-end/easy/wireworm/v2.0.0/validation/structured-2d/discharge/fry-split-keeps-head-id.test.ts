// discharge/fry-split-keeps-head-id — the head-side piece keeps the worm's id.
//
// specs/worm.md fixes which piece inherits: "The first surviving run, counted from
// the head end, keeps the worm's id, its two headings, and its diving flag", while
// "Each further run becomes a new worm, taking a fresh id". specs/instrumentation.md
// repeats it as a rule of identity, so an id stays findable across a cut.
//
// The board poses the same cut discharge/fry-splits poses — thirteen segments along
// a row, a critical node one row below their middle, five middle segments fried —
// and then asks which id stands on which end. The piece holding the tile the old
// head stood on must report the id the worm carried before the discharge; the piece
// holding the tile the old tail stood on must report a different one. Both of those
// tiles are four columns clear of the fried run, so which piece is read does not
// move with a build whose fry radius is a tile out either way.
//
// The two readings are what separate the wrong models. A build that hands the id
// to the trailing run fails the first; a build that gives both pieces the old id,
// which would make `removeWorm` and every per-entity operation ambiguous, fails
// the second; a build that issues fresh ids to both fails the first.
//
// The worm's faculties are off, so neither piece has walked off the tile its id is
// read on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertNotEqual,
  assertNull,
} from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWormPath,
  startPlaying,
  wormOn,
  type Harness,
  type Tile,
} from "../harness";
import { detonate } from "./detonation";

/** The row the worm lies along. */
const ROW = 10;

/** The columns its segments occupy, from the head end. */
const HEAD_COLUMN = 17;
const TAIL_COLUMN = 5;

/** The worm, head first: thirteen segments along one row. */
const SEGMENTS: Tile[] = Array.from(
  { length: HEAD_COLUMN - TAIL_COLUMN + 1 },
  (_unused, index) => ({ c: HEAD_COLUMN - index, r: ROW }),
);

/**
 * The critical node: one row below the middle column of the worm, so the five
 * segments on columns `9` through `13` lie within `DISCHARGE_RADIUS` (`2`) of it
 * and the four segments at each end do not.
 */
const STRUCK = { c: 11, r: ROW + 1 };

/** The tile the old head stood on, which the head-side run still holds. */
const HEAD_SIDE = { c: HEAD_COLUMN, r: ROW };

/** The tile the old tail stood on, which the tail-side run still holds. */
const TAIL_SIDE = { c: TAIL_COLUMN, r: ROW };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the old id on the head-side piece and gives the trailing piece a fresh one", async () => {
  startPlaying(h);
  const original = poseWormPath(h, SEGMENTS);
  h.debug.setWormStepping(original, false);
  h.debug.setWormBody(original, false);

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "pieces");
  const after = h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );

  const headSide = wormOn(after, HEAD_SIDE.c, HEAD_SIDE.r);
  assertDefined(
    headSide,
    "precondition: a worm still holds the old head's tile",
  );
  assertEqual(
    headSide?.id,
    original,
    "the id reported by the piece carrying the old head",
  );

  const tailSide = wormOn(after, TAIL_SIDE.c, TAIL_SIDE.r);
  assertDefined(tailSide, "precondition: a worm still holds the tail-side run");
  assertNotEqual(
    tailSide?.id,
    original,
    "the id reported by the trailing piece",
  );
});
