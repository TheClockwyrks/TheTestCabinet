// worm/split-keeps-head-id — after a middle-segment split, the piece carrying the
// old head keeps the worm's id and the trailing piece takes a fresh one.
//
// specs/worm.md, "Cutting the worm": "The first surviving run, counted from the
// head end, keeps the worm's id, its two headings, and its diving flag ... Each
// further run becomes a new worm, taking a fresh id".
// specs/instrumentation.md carries the same rule beside the surface, because every
// per-entity operation is addressed by id: an entity added through the surface is
// appended to its roster and keeps its id until something removes it.
//
// WHY THIS IS ITS OWN POINT. A build can split a worm into two runs of the right
// lengths — which is `worm.shot-middle-splits`'s requirement — and still hand both
// pieces new ids, which silently breaks every per-entity operation a caller was
// holding. So the count is read there and the IDENTITY is read here.
//
// THE PIECES ARE TOLD APART BY WHERE THEY ARE, NOT BY THEIR IDS. The head-side
// piece is the one standing on the tile the old head stood on; anything else would
// assume the answer. What is then asserted is that THAT piece reports the id the
// worm had before the shot, and that the other piece reports a different one.
//
// THE WORM IS POSED STILL, AND THE WORLD IS ONE WORM AND ONE BOLT.
// `startPlaying` leaves the board empty and the three world gates shut; the worm's
// STEP faculty is off, so the chain cannot move out from under the bolt and the
// old head's tile is where the old head is.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import {
  assertEqual,
  assertLength,
  assertNotEqual,
  assertTruthy,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
  type WormSnapshot,
} from "../harness";

/** The row the worm lies along, and the head's column. */
const ROW = 5;
const HEAD_C = 11;

/** Segments the worm carries, laid behind the head to column 5. */
const LENGTH = 7;

/** The segment the bolt is aimed at: the fourth from the head, at column 8. */
const BREAK_C = HEAD_C - 3;

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

it("keeps the worm's id on the head-side piece and gives the other a fresh one", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);
  poseBolt(h, BREAK_C, BOLT_R);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: FLIGHT_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "pieces");

  assertEqual(
    swept.hit,
    true,
    `the bolt to resolve within ${FLIGHT_TIMEOUT} frames of the climb`,
  );
  const worms = swept.snapshot.worms;
  assertLength(worms, 2, "worms on the board after the middle-segment split");

  // The head-side piece is found by the tile the old head stood on, so the
  // reading never assumes which id it carries.
  const found = worms.find((worm) => {
    const head = worm.segments[0];
    return head.c === HEAD_C && head.r === ROW;
  });
  assertTruthy(
    found,
    `a piece led from the tile the old head stood on, (${HEAD_C}, ${ROW})`,
  );
  const headSide = found as WormSnapshot;
  assertEqual(
    headSide.id,
    id,
    "the id of the piece carrying the old head, which addWorm handed back " +
      "before the shot",
  );

  const trailing = worms.find((worm) => worm !== headSide) as WormSnapshot;
  assertNotEqual(trailing.id, id, "the id of the trailing piece");
});
