// hunter/removed-on-death — a life lost clears the hunt.
//
// specs/hunter.md: "A crossing ends | The critter loses a life, or a crossing ends
// in a bay, and every bear on the strait leaves." specs/progression.md says the
// same from the run's side: on the tick a life is lost the phase becomes `dying`,
// the critter leaves the strait, and every bear leaves with it.
//
// So the reading is taken on the very tick the phase becomes `dying`, one tick at
// a time, and what it requires is an EMPTY roster — not a roster that empties
// somewhere in the hold, and not one bear left standing.
//
// TWO BEARS, because the rule is "every bear" and a build that clears one slot
// rather than the roster passes with one. They are posed with `addBear` and the
// emergence gate is left SHUT: what a crossing's end clears is the strait, and
// nothing about that is the emergence faculty, so opening that gate would put a
// bear into the scenario the item never asked for.
//
// THE DEATH IS A DROWNING, which is the cheapest one to reach: `specs/water.md`
// takes a life on any tick the critter's footing is `water`, and an emptied water
// row is what `startCrossing` already leaves. No gate is opened to get it, and the
// timer, the traffic and the catch all stay out of the scenario.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** Two bears, well apart, on rows an emptied strait leaves bare. */
const BEARS = [
  { col: 8, row: 15 },
  { col: 30, row: 12 },
] as const;

/** Where the critter is put to drown: a water row with no floe under it. */
const DROWN_COL = 20;
const DROWN_ROW = 6;

/** How long the death is waited on: it is due on the very next tick. */
const WATCH_SECONDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the roster empty on the tick a lost life turns the phase to dying", async () => {
  startCrossing(h);
  const frozen = { sense: false, routing: false, travel: false } as const;
  for (const at of BEARS) poseBear(h, at.col, at.row, frozen);

  const dying = await captureReplay(h, "reset", async () => {
    h.debug.setCritterTile(DROWN_COL, DROWN_ROW);
    return h.until((snapshot) => snapshot.phase === "dying", {
      maxFrames: ticksFor(WATCH_SECONDS),
      poll: 1,
    });
  });

  assertTrue(
    dying.hit,
    `the phase dying within ${WATCH_SECONDS} s of the critter standing on ` +
      `open water, so there is a lost life for the hunt to be cleared by`,
  );
  assertLength(
    dying.snapshot.bears,
    0,
    `the hunt on the tick the phase became dying, ${BEARS.length} bears ` +
      `having been on the strait`,
  );
});
