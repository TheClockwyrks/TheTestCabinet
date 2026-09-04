// Wireworm — instrumentation/foe-travel-gate: `setFoeTravel(id, false)` holds a
// foe in place, and holds nothing else.
//
// specs/instrumentation.md: "Gates the foe's locomotion alone: its position holds
// and its behavior runs on." specs/foes.md is what the gate suspends: every foe
// carries a velocity in logical units per second, integrated against the delta
// time of each update, and a glitch travels horizontally at `GLITCH_H_SPEED`
// (`210`) and downward at `GLITCH_V_SPEED` (`62`), both at once. A second of
// ungated travel is therefore hundreds of units of motion, and this point
// requires none of it.
//
// WHY THE SUITE RESTS ON IT. It is the gate that lets a foe be posed as an ACTOR
// — something that works the one tile it stands on, with no motion at all — so a
// check on what a glitch EATS or what a corruptor SLAMS reads one tile rather
// than a trail. It is also what keeps a foe posed for one scenario from
// descending off the board partway through it.
//
// THE BOARD IS EMPTY UNDER THE FOE. The mind runs on with the travel gated off,
// and a glitch's mind removes the node on the tile its center occupies, so a node
// posed here would be eaten and the reading would be about the eating. That is
// `foes.glitch-eats-inert`'s point, not this one; here there is nothing to eat and
// the only thing that can change is the position.
//
// THE READING IS THE CENTER THE SNAPSHOT REPORTED AT THE CALL, not the tile center
// the pose was aimed at, so where `addFoe` places a foe is `poses-read-back`'s
// point and this one asserts only that the place did not change.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  foeOf,
  poseFoe,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the glitch is posed: a tile in the middle of an empty board. */
const GLITCH_C = 20;
const GLITCH_R = 9;

/** The second of game time the item names. */
const SWEEP_TICKS = ticksFor(1);

/**
 * The tolerance on "the same center".
 *
 * Six decimal places, which is float noise rather than motion: specs/foes.md
 * integrates a velocity against each update's delta, so a gated foe adds nothing
 * at all and any figure past this is travel that was supposed to be off.
 */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the same center a second later", async () => {
  startPlaying(h);

  const id = poseFoe(h, "glitch", GLITCH_C, GLITCH_R);
  h.debug.setFoeTravel(id, false);

  const posed = foeOf(h.snapshot(), id);
  assertEqual(posed.travel, false, "the travel gate the scenario posed");

  await h.advance(SWEEP_TICKS);
  // The glitch on the tile it never left.
  captureStill(h, "gated");

  const held = foeOf(h.snapshot(), id);
  assertCloseTo(
    held.x,
    posed.x,
    EXACT,
    "a foe with setFoeTravel(id, false) holds its center x for a second of " +
      "game time (specs/instrumentation.md)",
  );
  assertCloseTo(
    held.y,
    posed.y,
    EXACT,
    "a foe with setFoeTravel(id, false) holds its center y for a second of " +
      "game time (specs/instrumentation.md)",
  );
});
