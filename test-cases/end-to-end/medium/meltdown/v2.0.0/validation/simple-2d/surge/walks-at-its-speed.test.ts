// surge/walks-at-its-speed — a unit covers its own speed in logical units per
// second of game time.
//
// THE RULE. specs/surge.md: "Speed is the unit's base speed, in logical units per
// second". specs/mazing.md: "A unit travels toward the centre of the next tile of
// its route at its current speed, in logical units per second." The table gives
// the Mote `60` and the Sprint `120`, so over a second of game time a Mote's
// centre moves sixty logical units and a Sprint's a hundred and twenty.
//
// TWO TYPES, BECAUSE ONE FIGURE CANNOT TELL A TABLE FROM A CONSTANT. A build that
// walks everything at one pace covers the same distance in both windows, so the
// pair is what makes the reading a reading of the table. specs/surge.md picks the
// pair out itself — the Sprint "runs at double a Mote's speed" — and a factor of
// two is far outside any tolerance a frame boundary could justify.
//
// WHY THE MEASUREMENT IS A DISPLACEMENT ALONG A STRAIGHT ROW. Both units enter at
// the left vent, whose four tiles specs/floor.md puts on rows `16` to `19`, and a
// unit entering there is assigned the right exhaust, whose tiles are the same four
// rows at the far column. On an EMPTY floor the cheapest route under
// specs/mazing.md's metric is the straight run along the unit's own row: reaching
// the exhaust by way of a diagonal costs `sqrt(2)` for a step that buys one
// column, where the orthogonal step costs `1` for the same column, so no route
// that leaves the row is ever cheaper. The straight-line displacement between the
// two snapshots is therefore exactly the distance the unit travelled, and no
// assumption about WHICH tile of the vent it started on is needed.
//
// WHY THE WINDOW IS TWO SECONDS. Long enough that a frame boundary is a rounding
// rather than a term, short enough that neither unit is anywhere near the exhaust
// when it closes: two seconds carries a Sprint `240` logical units, which is under
// thirteen of the fifty columns it has to cross, so the reading is taken where the
// floor has done nothing to the quantity. Nothing else stands on the floor, so
// there is no tower to slow either unit and no wall to send it round a corner.
//
// WHAT EVERY WRONG MODEL READS. A build that moves a fixed step per FRAME rather
// than per second of game time reads a distance that depends on the frame rate,
// which at this suite's `120` Hz is nowhere near either figure; one that walks
// everything at one pace reads the same number twice; one that reads its speed as
// tiles per second rather than logical units reads a nineteenth of it.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  overWindow,
  poseWalker,
  seconds,
  startRun,
  ticksFor,
  type Harness,
  type SurgeType,
} from "../harness";

/** The window each unit is measured over, in frames of this suite's clock. */
const WINDOW_TICKS = ticksFor(2);

/** That window in seconds of game time, which is what the figure is per. */
const WINDOW_SECONDS = seconds(WINDOW_TICKS);

/**
 * How far a reading may fall from the distance the speed says: two per cent of it.
 *
 * The two ends the tolerance has to cover are both fractions of a frame. The
 * window is a whole number of this suite's `120` Hz frames, so the game time it
 * spends is exact; what is not exact is where in a frame a build resolves the
 * unit's first step, which is worth at most one frame of travel — half a logical
 * unit for a Mote and one for a Sprint, or under half a per cent of either
 * reading. Two per cent is four times that, and still an order of magnitude below
 * the gap between the two figures this point reads, so no build that walks the
 * Mote at the Sprint's pace can hide inside it.
 */
const TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Walk one unit of `type` down an empty row and report how far its centre moved. */
async function travelledBy(h: Harness, type: SurgeType): Promise<number> {
  startRun(h);
  const id = poseWalker(h, type, "left");
  const window = await overWindow(h, WINDOW_TICKS);
  return window.travel(id);
}

it("covers 60 logical units a second for a Mote and 120 for a Sprint", async () => {
  const mote = await travelledBy(h, "mote");
  const sprint = await travelledBy(h, "sprint");
  captureStill(h, "travel");

  for (const [type, travelled] of [
    ["mote", mote],
    ["sprint", sprint],
  ] as const) {
    const expected = SURGE_DEFS[type].speed * WINDOW_SECONDS;
    const slack = TOLERANCE * expected;
    assertLessThanOrEqual(
      Math.abs(travelled - expected),
      slack,
      `${type}: logical units its centre covered in ${WINDOW_SECONDS} s of ` +
        `game time, against the ${expected} its speed of ` +
        `${SURGE_DEFS[type].speed} gives it`,
    );
  }
});
