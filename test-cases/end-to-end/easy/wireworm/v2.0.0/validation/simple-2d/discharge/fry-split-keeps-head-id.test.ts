// discharge/fry-split-keeps-head-id — the head-side piece keeps the worm's id.
//
// specs/worm.md fixes which piece inherits the identity when segments are removed
// "whatever removed them": "The first surviving run, counted from the head end,
// keeps the worm's id ... Each further run becomes a new worm, taking a fresh
// id". specs/discharge.md sends a worm cut by a discharge to that same rule.
//
// THE RULE IS ASSERTED ON THIS PATH BECAUSE IT IS STATED ON TWO. A bolt through
// the middle is `worm.split-keeps-head-id`; a discharge through the middle is
// this point. A build that numbers one path correctly and the other wrongly is
// named for the one it got wrong rather than passing on the strength of the
// other.
//
// THE PIECES ARE FOUND BY THE TILES THEY STAND ON — the old head's tile and the
// old tail's — never by their roster positions, which is the whole point of the
// ids and what `instrumentation.entity-ids` holds the surface to. Both tiles
// survive a cut of any width the specification could be read as fixing, so this
// reading does not turn on how far the blast reaches, which is
// `fries-segments-in-reach`'s requirement and `spares-segments-beyond-reach`'s.
//
// THE TRAILING PIECE IS READ AS "NOT THE OLD ID" rather than as any particular
// number. specs/instrumentation.md promises only that an id is "unique among the
// entities live at any moment", so a build is free to number a fresh worm however
// it likes; what it may not do is hand the old id to the trailing run or hand the
// head-side run a new one. Both halves are read here because they are one
// requirement: which piece inherits the identity.
//
// THE GEOMETRY IS `fry-splits`'s, and the same two guards apply — the node sits
// BELOW the worm so the climbing bolt reaches it rather than a segment, and the
// worm's STEP faculty is off so its tiles are where the scenario put them. That the cut leaves two pieces at all is `fry-splits`'s
// requirement; here it is the scenario's precondition.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../constants";
import { assertEqual, assertNotEqual, assertTruthy } from "../assert";
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

/** The row the worm lies along: clear of the entry row, the band and the edges. */
const WORM_R = 6;

/** Segments beyond the widest cut the reach could take, at each end. */
const RUN_LENGTH = 3;

/** A worm long enough to leave a run of `RUN_LENGTH` on each side of the cut. */
const WORM_LENGTH = 2 * DISCHARGE_RADIUS + 1 + 2 * RUN_LENGTH;

/** The head's tile. `poseWorm` lays the body behind it, descending columns. */
const HEAD_C = 20;

/** The tail's tile, `WORM_LENGTH - 1` columns behind the head. */
const TAIL_C = HEAD_C - (WORM_LENGTH - 1);

/**
 * The critical node's tile: one row below the middle segment of the chain.
 *
 * One row rather than `DISCHARGE_RADIUS`, so the cut lands on the middle of the
 * worm under any reach the specification could be read as fixing. How far the
 * blast reaches is `fries-segments-in-reach`'s requirement and
 * `spares-segments-beyond-reach`'s; what it leaves behind is this one's.
 */
const STRUCK_C = HEAD_C - (WORM_LENGTH - 1) / 2;
const STRUCK_R = WORM_R + 1;

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

/** The worm standing on `(c, WORM_R)`. Fails the check if no piece holds it. */
function pieceOn(worms: readonly WormSnapshot[], c: number): WormSnapshot {
  const found = worms.find((worm) =>
    worm.segments.some((seg) => seg.c === c && seg.r === WORM_R),
  );
  assertTruthy(
    found,
    `a worm standing on (${c}, ${WORM_R}), which is the scenario's ` +
      "precondition: the discharge has to have left a piece there for its id " +
      "to be read (graded by discharge.fry-splits)",
  );
  return found as WormSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the worm's id on the head-side piece and gives the trailing one a fresh id", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  const before = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH);
  h.debug.setWormStepping(before, false);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "pieces");

  const worms = swept.snapshot.worms;
  assertEqual(
    pieceOn(worms, HEAD_C).id,
    before,
    "the id of the piece carrying the old head: the first surviving run, " +
      "counted from the head end, keeps the worm's id",
  );
  assertNotEqual(
    pieceOn(worms, TAIL_C).id,
    before,
    "the id of the piece carrying the old tail, which must be a fresh id " +
      "rather than the one the worm carried before the discharge",
  );
});
