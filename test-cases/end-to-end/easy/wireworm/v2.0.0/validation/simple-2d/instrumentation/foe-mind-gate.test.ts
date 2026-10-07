// Wireworm — instrumentation/foe-mind-gate: `setFoeMind(id, false)` stops a foe
// acting on the field, and stops nothing else.
//
// specs/instrumentation.md: "Gates the foe's own behavior alone: the glitch's
// dart and its eating, the dropper's node-laying, the corruptor's slam. Its
// travel runs on." specs/foes.md is what the gate suspends here: a glitch removes
// the node on the tile its center occupies, whatever that node's charge.
//
// WHY THE SUITE RESTS ON IT. It is the gate that lets a foe be posed as a
// TRAVELLER — something that crosses a scenario without reshaping the field it
// crosses — and its partner `setFoeTravel` lets one be posed as an ACTOR that
// works one tile with no motion at all. Every `foes` point about motion is posed
// with one of the two, so the pair is proved here before anything leans on it.
//
// THE FIELD IS LAID WIDE ENOUGH TO CATCH THE GLITCH WHEREVER IT GOES. The
// specification does not fix which way `addFoe` points a glitch, so the block of
// nodes covers every tile a second of travel can reach in either direction:
// specs/foes.md gives a glitch `GLITCH_H_SPEED` (`210`) and `GLITCH_V_SPEED`
// (`62`) units per second, so one second is at most seven tiles across and two
// down from where it was posed, and the block is wider and deeper than that on
// every side. Reading the direction off the build instead would let a build
// choose a direction with nothing in it.
//
// THE GLITCH MUST HAVE CROSSED A TILE for the reading to mean anything: a foe
// that never left the tile it was posed on never travelled across the field, and
// this point would pass on a scenario that never happened. So a change of tile is
// required, and the distance it covered — which is `foes.glitch-descends`'s and
// `foes.glitch-darts`'s point — is not.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_H_SPEED, GLITCH_V_SPEED, TILE } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  foeOf,
  poseField,
  poseFoe,
  sameTile,
  startPlaying,
  ticksFor,
  tileOf,
  type Harness,
} from "../harness";

/** Where the glitch is posed, in the middle of the block laid under it. */
const GLITCH_C = 20;
const GLITCH_R = 9;

/** The second of travel the reading is taken over. */
const SPAN_S = 1;
const SWEEP_TICKS = ticksFor(SPAN_S);

/**
 * The block of nodes laid under the glitch, sized from specs/foes.md's own
 * figures so it catches a second of travel whichever way the glitch points.
 *
 * `GLITCH_H_SPEED * SPAN_S / TILE` is `6.6` tiles across and
 * `GLITCH_V_SPEED * SPAN_S / TILE` is `1.9` tiles down; both margins below are
 * larger, so every tile the glitch's center can reach carries a node.
 */
const REACH_C = Math.ceil((GLITCH_H_SPEED * SPAN_S) / TILE) + 2;
const REACH_R = Math.ceil((GLITCH_V_SPEED * SPAN_S) / TILE) + 2;
const FIELD_C = GLITCH_C - REACH_C;
const FIELD_R = GLITCH_R - REACH_R;
const FIELD_COLS = REACH_C * 2 + 1;
const FIELD_ROWS = REACH_R * 2 + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("crosses a field of nodes without removing one", async () => {
  startPlaying(h);

  poseField(
    h,
    Array.from({ length: FIELD_ROWS }, () => "0".repeat(FIELD_COLS)),
    FIELD_C,
    FIELD_R,
  );

  const id = poseFoe(h, "glitch", GLITCH_C, GLITCH_R);
  h.debug.setFoeMind(id, false);

  const before = h.snapshot();
  assertEqual(
    before.nodes.length,
    FIELD_ROWS * FIELD_COLS,
    "the block of nodes the scenario laid",
  );
  const posedFoe = foeOf(before, id);
  const posedTile = tileOf(posedFoe.x, posedFoe.y);

  await h.advance(SWEEP_TICKS);
  // The row of nodes the mindless glitch crossed.
  captureStill(h, "gated");

  const after = h.snapshot();
  const moved = foeOf(after, id);
  assertEqual(
    sameTile(tileOf(moved.x, moved.y), posedTile),
    false,
    "the glitch must cross tiles for this scenario to be the one the point " +
      "describes: its travel runs on with its mind gated off " +
      "(specs/instrumentation.md)",
  );

  assertDeepEqual(
    after.nodes,
    before.nodes,
    "a foe with setFoeMind(id, false) removes no node it crosses " +
      "(specs/instrumentation.md)",
  );
});
