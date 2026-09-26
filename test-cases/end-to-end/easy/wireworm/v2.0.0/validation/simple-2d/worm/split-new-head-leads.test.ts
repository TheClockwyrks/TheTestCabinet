// worm/split-new-head-leads — the trailing piece of a split leads from the segment
// that was nearest the break, and steps along its own heading.
//
// specs/worm.md, "Cutting the worm": "Each further run becomes a new worm, taking
// a fresh id and the same two headings and diving flag as the worm it came from.
// Its leading segment is the one that was nearest the break, and that segment is
// its head and leads it from then on."
//
// TWO READINGS, ONE RULE. Which segment leads is read straight off the split — the
// trailing run's `segments[0]` must be the tile beside the break rather than the
// old tail — and then that piece is stepped once, so a build that reported the run
// in the right order but kept driving it from the far end fails on where the head
// went.
//
// HOW THE SCENARIO IS POSED AFTER THE SPLIT. Three things are set, each atomic and
// each removing something that is another point's requirement from this one:
//
//   - The node the shot segment left on the break tile is cleared. Every segment a
//     bolt destroys leaves a fresh inert node (specs/nodes.md), and the trailing
//     head steps straight into that tile — so left standing it would BLOCK the
//     step, and this point would be grading `nodes.shot-leaves-node` and
//     `worm.blocked-by-node-drops` instead of what it is about.
//   - Every worm's STEP faculty is turned off and the trailing piece's back on, so
//     the head-side piece cannot wander through the scenario and the only thing
//     that moves is the piece under test.
//   - The trailing piece's BODY faculty is turned off, so one tile moves and the
//     head's destination is unambiguous. How a body follows is
//     `worm.body-follows`'s requirement.
//
// The pieces are told apart by WHERE they are rather than by their ids, because
// which piece keeps the old id is `worm.split-keeps-head-id`'s requirement. The
// two faculty poses above still have to name an id, because every per-entity
// operation is addressed by one (specs/instrumentation.md) — so a build that hands
// both pieces the SAME id cannot have this scenario posed at all and fails here as
// well as there. That is the guidance's own rule: a debug surface that answers
// wrongly fails the point it decides.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE, WORM_STEP_L1 } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTruthy,
} from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseBolt,
  poseWorm,
  segmentAt,
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

/** The tile the trailing run's leading segment stands on: beside the break. */
const TRAILING_HEAD_C = BREAK_C - 1;

/** The row the bolt is placed on, five rows below the worm and clear of it. */
const BOLT_R = 10;

/** How long the bolt's climb may take before the sweep gives up, in frames. */
const FLIGHT_TIMEOUT = ticksFor((3 * ((BOLT_R - ROW) * TILE)) / BOLT_SPEED);

/** How long the trailing piece's step may take, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leads the trailing piece from the segment beside the break", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);
  poseBolt(h, BREAK_C, BOLT_R);

  const cut = await h.until((s) => s.bolts.length === 0, {
    maxFrames: FLIGHT_TIMEOUT,
    poll: 1,
  });
  assertEqual(
    cut.hit,
    true,
    `the bolt to resolve within ${FLIGHT_TIMEOUT} frames of the climb`,
  );
  const worms = cut.snapshot.worms;
  assertLength(worms, 2, "worms on the board after the middle-segment split");

  const found = worms.find((worm) =>
    worm.segments.some((tile) => tile.c === TRAILING_HEAD_C && tile.r === ROW),
  );
  assertTruthy(
    found,
    `a piece holding the tile beside the break, (${TRAILING_HEAD_C}, ${ROW})`,
  );
  const trailing = found as WormSnapshot;

  assertDeepEqual(
    headOf(trailing),
    { c: TRAILING_HEAD_C, r: ROW },
    "the trailing piece's leading segment: the one that was nearest the break",
  );
  assertEqual(
    trailing.dh,
    1,
    "the trailing piece's dh, taken from the worm it came from",
  );

  h.debug.clearNode(BREAK_C, ROW);
  for (const worm of worms) h.debug.setWormStepping(worm.id, false);
  h.debug.setWormStepping(trailing.id, true);
  h.debug.setWormBody(trailing.id, false);

  const stepped = await h.until((s) => !segmentAt(s, TRAILING_HEAD_C, ROW), {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "trailing");

  assertEqual(
    stepped.hit,
    true,
    `the trailing piece's head to leave tile (${TRAILING_HEAD_C}, ${ROW}) ` +
      `within ${STEP_TIMEOUT} frames`,
  );

  // Found by geometry again rather than by id: with its body held, the trailing
  // piece still stands on the tile behind the one its head just left, and reading
  // it that way keeps this point clear of `worm.split-keeps-head-id`'s.
  const moved = stepped.snapshot.worms.find((worm) =>
    worm.segments.some(
      (tile) => tile.c === TRAILING_HEAD_C - 1 && tile.r === ROW,
    ),
  );
  assertTruthy(
    moved,
    `the trailing piece, still holding (${TRAILING_HEAD_C - 1}, ${ROW})`,
  );
  assertDeepEqual(
    headOf(moved as WormSnapshot),
    { c: TRAILING_HEAD_C + 1, r: ROW },
    "the trailing piece's head one tile on along its own heading",
  );
});
