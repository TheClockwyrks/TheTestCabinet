// instrumentation/bear-travel-gate — `setBearTravel(id, false)` gates that bear's
// locomotion and nothing else, so it holds its centre while its routing goes on
// choosing.
//
// specs/instrumentation.md fixes the gate: "Gates that bear's locomotion alone.
// Off, its center holds however long a scenario runs and the two tiles it occupies
// hold with it. Its sense and its routing run untouched, so it still reports the
// target it reads and the step its routing chose."
//
// SO BOTH HALVES ARE READ, AND THEY FAIL INDEPENDENTLY. A build that gates the
// whole creature holds the centre and reports no step; a build that gates nothing
// travels. The step is the half that says the gate is locomotion's alone.
//
// THE STEP THE ROUTING MUST REPORT IS FIXED BY specs/hunter.md AND IS THE ONLY ONE.
// A settled bear "commits to one step ... The first step of a shortest route from
// its tile to its target made only of tiles open to it, choosing the step that most
// shortens that route." The bear stands on the ice band, twelve tiles to the LEFT
// of the critter and on the critter's own row, on a strait carrying nothing at all,
// so every neighbouring tile is open and exactly one of the four shortens the route
// — the step to the right. A build routing toward the critter reports that tile; a
// build routing away, or on the wrong axis, reports a tile this check names.
//
// THE CENTRE IS HELD TO THE TILE CENTRE IT WAS SETTLED ON, exactly. `addBear` puts
// a bear "its center on that tile's center" (specs/instrumentation.md), and a gated
// bear's centre "holds however long a scenario runs", so there is no tolerance to
// state: a build that moved it by a hundredth of a unit moved it.
//
// ONLY THE FACULTIES THE REQUIREMENT EXERCISES ARE ON. The sense and the routing
// run, because the requirement is that they still do; nothing else is on the
// strait, and the critter is posed rather than hopped there.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_HZ, tileCX, tileCY } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  type Harness,
} from "../harness";

/** Where the critter stands: the ice band, twelve tiles right of the bear. */
const CRITTER_COL = 20;
const CRITTER_ROW = 15;

/** The gated bear's tile, and the one step its routing must commit it to. */
const BEAR_COL = 8;
const BEAR_ROW = 15;
const STEP_COL = BEAR_COL + 1;
const STEP_ROW = BEAR_ROW;

/**
 * The span the held bear is watched over, in ticks: one second of game time.
 *
 * The figure this review item states. At `BEAR_ICE_SPEED` (`3` tiles a second,
 * specs/hunter.md) an ungated bear covers three tiles in it, so a build that
 * travels at all is a long way from where it started.
 */
const SPAN_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a gated bear's centre while its routing still commits a step", async () => {
  startCrossing(h);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);

  // Its sense and its routing are left running: the requirement is that the gate
  // takes the locomotion and nothing else.
  const bear = poseBear(h, BEAR_COL, BEAR_ROW, { travel: false });

  const held = await captureReplay(h, "gate", async () => {
    await h.advance(SPAN_TICKS);
    return bearOf(h.snapshot(), bear);
  });

  assertEqual(
    `${held.x},${held.y}`,
    `${tileCX(BEAR_COL)},${tileCY(BEAR_ROW)}`,
    `the CENTRE of the bear with setBearTravel(${bear}, false) after one second ` +
      `of game time, against the centre of the tile it was settled on — a gated ` +
      `bear's centre holds however long a scenario runs ` +
      `(specs/instrumentation.md)`,
  );
  assertEqual(
    `${held.col},${held.row}`,
    `${BEAR_COL},${BEAR_ROW}`,
    "the tile the gated bear last settled on over that same second",
  );
  assertEqual(
    `${held.stepCol},${held.stepRow}`,
    `${STEP_COL},${STEP_ROW}`,
    `the tile the gated bear is travelling into — its routing runs untouched, ` +
      `and from (${BEAR_COL}, ${BEAR_ROW}) on an empty strait the one step that ` +
      `shortens the route to the critter on (${CRITTER_COL}, ${CRITTER_ROW}) is ` +
      `the one to its right (specs/hunter.md)`,
  );
});
