// hopping/refuse-below-near-shore — a hop off the bottom is refused, and free.
//
// specs/hopping.md (Refused hops): a hop is refused when its target tile "is
// outside the grid: `inBounds(col, row)` is false", and "a refused hop leaves
// everything as it was ... no life is lost". specs/strait.md fixes `inBounds` as
// `0 <= r < 20` and the near shore as row `ROW_NEAR` (`19`), the bottom row of
// the strait, so a hop DOWN from it targets row `20`, which is off the strait.
//
// The near shore is where every crossing begins, so this is the edge a player
// meets first and the one a build is likeliest to leave open: the strait's other
// three edges are reached only by going out of the way. It is a refusal and not
// a death — a build that walks the critter off the bottom and drowns it there
// costs a life the specification does not — so the reading is taken again a
// settling window later, on an empty strait with every world gate shut.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_COL, START_LIVES } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** Frames watched after the refused press: half a second of game time. */
const SETTLE_FRAMES = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop down from the near shore and costs no life", async () => {
  startCrossing(h);

  const after = await captureReplay(h, "refuse", async () => {
    await hop(h, "down");
    await h.advance(SETTLE_FRAMES);
    return h.snapshot();
  });

  assertEqual(
    after.critter.row,
    ROW_NEAR,
    "the row after a hop down from the near shore",
  );
  assertEqual(
    after.critter.col,
    START_COL,
    "the column after a hop down from the near shore",
  );
  assertEqual(
    after.lives,
    START_LIVES,
    "lives after a hop down from the near shore",
  );
  assertEqual(
    after.phase,
    "crossing",
    "the phase after a hop down from the near shore",
  );
  assertTrue(
    after.critter.present,
    "the critter still in play after a refused hop",
  );
});
