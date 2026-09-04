// worm/shot-tail-shortens — a bolt into the tail leaves one worm, one segment
// shorter, with the same head.
//
// specs/worm.md, "Cutting the worm": "the segments that survive fall into runs of
// consecutive segments, counted from the head end. Each run becomes a worm of its
// own", and the section states this case outright: "A bolt into the tail leaves
// one worm, one segment shorter, with the same head."
//
// THE WORM IS POSED STILL. Its STEP faculty is off, which specs/instrumentation.md
// states leaves the rest of the board running, so nothing about the worm's own
// motion can carry the tail out from under the bolt while it climbs. The
// requirement is what the BOLT does to the chain.
//
// THE WORLD IS ONE WORM AND ONE BOLT. `startPlaying` leaves the board empty and
// the three world gates shut, so no node stands in the bolt's column to consume it
// on the way — specs/cursor.md has a bolt resolve against the FIRST thing in its
// path — and no foe or second worm exists.
//
// THE TAIL IS THE FAR END, AND THE HEAD IS READ AS WELL. A build that took the
// segment off the wrong end leaves the head on the wrong tile, so the two readings
// together separate a tail shot handled correctly from one handled at the head.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The row the worm lies along, and the head's column. */
const ROW = 5;
const HEAD_C = 11;

/** Segments the worm carries, laid behind the head to column 8. */
const LENGTH = 4;

/** The tail's column: the last segment `poseWorm` laid. */
const TAIL_C = HEAD_C - (LENGTH - 1);

/** The row the bolt is placed on, five rows below the worm and clear of it. */
const BOLT_R = 10;

/** How long the bolt's climb may take before the sweep gives up, in frames. */
const FLIGHT_TIMEOUT = ticksFor((3 * ((BOLT_R - ROW) * TILE)) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one worm a segment shorter, still led by the same head", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);
  poseBolt(h, TAIL_C, BOLT_R);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: FLIGHT_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "shortened");

  assertEqual(
    swept.hit,
    true,
    `the bolt to resolve within ${FLIGHT_TIMEOUT} frames of the climb`,
  );
  const worms = swept.snapshot.worms;
  assertLength(worms, 1, "worms on the board after the bolt struck the tail");
  assertLength(
    worms[0].segments,
    LENGTH - 1,
    "segments of the surviving worm, one fewer than the four posed",
  );
  assertDeepEqual(
    headOf(worms[0]),
    { c: HEAD_C, r: ROW },
    "the head of the surviving worm: the tile it stood on before the shot",
  );
});
