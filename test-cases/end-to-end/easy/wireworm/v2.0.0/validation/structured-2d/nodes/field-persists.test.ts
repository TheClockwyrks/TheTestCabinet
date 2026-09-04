// Wireworm — nodes/field-persists: the node field carries into the next level.
//
// specs/nodes.md, "The field persists": "Clearing a level does not reset it. The
// nodes standing when a level clears are the nodes standing when the next level's
// play begins, at the charges they held." specs/progression.md says the same from
// the run's side: on a clear, "the node field stands exactly as it was, at the
// charges it held."
//
// The wrong model this decides against is the arcade habit of laying a fresh
// board each level. The field is laid once, when a run starts, and it stands from
// there.
//
// The scenario is a real CLEAR, because the clear is what might reset the field:
// a level clears on the step in which the last of its worm segments is removed
// (specs/progression.md), so one segment is posed and a bolt removes it. The
// worm's faculties are both off, so it holds the tile it was posed on and nothing
// it does can reach the field.
//
// THE CLEAR IS THIS POINT'S PRECONDITION, and it is asserted as one: a validator
// that could not pose the world it needs fails the item it decides rather than
// leaving it undecided. That the level goes up is `progression.level-advances`'s
// requirement; what is decided here is what the field looks like on the other
// side of it.
//
// The field is then read twice, at the clear and once the next level's play is
// active, and the two readings are compared as a set rather than in the order the
// snapshot listed them — the ordering is `instrumentation.snapshot-shape`'s
// requirement. The four posed charges are checked by value as well, so a build
// that re-scattered an identically sized field still fails.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME, BOLT_SPEED, TILE } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBoltAtTile,
  poseWorm,
  startPlaying,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The field posed, one node at each of the four charges, spread across the board. */
const FIELD = [
  { c: 3, r: 4, charge: 0 },
  { c: 12, r: 7, charge: 1 },
  { c: 25, r: 11, charge: 2 },
  { c: 34, r: 15, charge: 3 },
];

/** The level the run is cleared from, and the level the clear opens. */
const FROM_LEVEL = 1;
const TO_LEVEL = FROM_LEVEL + 1;

/** The one segment whose removal clears the level, well clear of every posed node. */
const WORM_C = 20;
const WORM_R = 12;

/** The tile the bolt starts on, directly below the segment's, climbing into it. */
const FROM_R = WORM_R + 1;

/**
 * Seconds of flight run.
 *
 * A bolt climbs at `BOLT_SPEED` (`900` units per second, specs/cursor.md), so it
 * covers the half-tile from the centre of the tile below to the segment's tile in
 * `TILE / 2 / BOLT_SPEED` (`0.018` s). Five times that is well past the strike
 * and still only three tiles of travel.
 */
const FLIGHT = (5 * (TILE / 2)) / BOLT_SPEED;

/**
 * Seconds run after the clear, so the next level's banner gives way to live play.
 *
 * The banner phase runs for `BANNER_TIME` (`1.3` s, specs/progression.md) and the
 * phase becomes `active` when its timer runs out; half again as long is past that
 * moment whichever frame boundary the timer lands on.
 */
const THROUGH_BANNER = BANNER_TIME * 1.5;

/**
 * The field as an order-free list, so the comparison is about which nodes stand
 * at which charges and not about the order they are reported in.
 */
function fieldOf(snapshot: WirewormSnapshot): string[] {
  return snapshot.nodes
    .map((node) => `(${node.c}, ${node.r}) charge ${node.charge}`)
    .sort();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the next level on the field the clear left standing", async () => {
  startPlaying(h);
  h.debug.setLevel(FROM_LEVEL);
  for (const node of FIELD) h.debug.setNode(node.c, node.r, node.charge);

  const worm = poseWorm(h, WORM_C, WORM_R, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  poseBoltAtTile(h, WORM_C, FROM_R);

  await h.advanceSeconds(FLIGHT);
  const cleared = h.snapshot();
  assertEqual(
    cleared.level,
    TO_LEVEL,
    "the level the clear opened, which this point stands on",
  );
  const atClear = fieldOf(cleared);

  await h.advanceSeconds(THROUGH_BANNER);
  captureStill(h, "carried");

  const playing = h.snapshot();
  for (const node of FIELD) {
    assertEqual(
      chargeAt(playing, node.c, node.r),
      node.charge,
      `the charge on tile (${node.c}, ${node.r}) as the next level opens`,
    );
  }
  assertDeepEqual(
    fieldOf(playing),
    atClear,
    "the field standing as the next level's play begins",
  );
});
