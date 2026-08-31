// hunter/pursues — a bear closes on the critter.
//
// specs/hunter.md: "A bear's target is the tile the critter is on, read afresh
// every tick", and on settling it commits to the first step of a shortest route
// to that target. Whatever route a build picks, the tile distance it has left
// shrinks: at `BEAR_ICE_SPEED` (3) tiles a second a bear covers nine tiles in the
// three seconds read, so a build that routes at all closes twelve tiles of
// distance by some of it.
//
// The bar is exactly what the item states — STRICTLY SMALLER — rather than a
// figure, because how far a bear gets in three seconds is `ice-speed`'s
// requirement and which of the shortest routes it picks is the build's own choice.
// What fails here is a bear that wanders, sits still, or runs away.
//
// The strait is emptied, so nothing closes a tile and every route is open; both
// bodies sit on the ice band, where an emptied strait leaves nothing under them.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import { ROW_NEAR } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  critterTile,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { requireBear, tileDistance } from "./harness";

/** The critter, and a bear twelve tiles of tile distance away from it. */
const CRITTER_COL = 20;
const CRITTER_ROW = 12;
const BEAR_COL = CRITTER_COL + 6;
const BEAR_ROW = ROW_NEAR - 1;

/** The tile distance the pursuit opens on, which is what the item states. */
const OPENING_DISTANCE = 12;

/** The game time the pursuit is given, from the item. */
const PURSUIT_SECONDS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has less tile distance left after three seconds of pursuit", async () => {
  startCrossing(h);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const id = poseBear(h, BEAR_COL, BEAR_ROW);

  const closed = await captureReplay(h, "pursue", async () => {
    await h.advance(ticksFor(PURSUIT_SECONDS));
    return h.snapshot();
  });

  const bear = requireBear(closed, id, "the pursuing bear");
  assertLessThan(
    tileDistance({ col: bear.col, row: bear.row }, critterTile(closed)),
    OPENING_DISTANCE,
    `tile distance left after ${PURSUIT_SECONDS} s of a pursuit that opened ` +
      `${OPENING_DISTANCE} tiles out`,
  );
});
