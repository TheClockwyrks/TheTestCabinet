// Wireworm — instrumentation/clear-foes: `clearFoes()` empties the foe roster
// and leaves the other three rosters standing.
//
// specs/instrumentation.md gives the operation exactly that scope — it "Removes
// every foe, leaving the nodes, worms, and bolts standing" — and it is what lets
// a scenario pose a world holding only what its own requirement concerns.
//
// Every other point in this suite starts from `startPlaying`, which calls all
// four clears in a row; a clear that took something else with it would
// quietly empty a scenario that had asked for it, and the point that failed
// would be the one about the mechanic rather than the one about the clear.
//
// SO THE BOARD CARRIES ALL FOUR AT ONCE. Nodes at all four charges specs/nodes.md
// names, two worms, one foe of each of the three kinds specs/foes.md names, and
// two bolts in flight — and the three rosters that must survive are compared
// entry by entry, not merely counted, so a clear that dropped one worm of two or
// reset a foe's velocity is caught as surely as one that emptied the roster.
//
// THE FOUR CHARGES ARE THE DISTINGUISHING POSE. A node "cleared" by being set
// inert reads as a standing node at charge `0` rather than as an empty tile, and
// specs/nodes.md keeps the two apart: a tile "is either empty or holds exactly
// one node".
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. Under this engine a pose acts on
// the live game at the call and `snapshot` is built at the call
// (specs/instrumentation.md), so both readings are of the same instant and the
// survivors are held to being untouched rather than to being merely still there.
// The worms are posed with their step gated off and the foes with both faculties
// off for the same reason: this point reads what the clear did, and an entity
// that moved between the two readings would be reporting its own mechanic.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../../src/constants";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseFoe,
  poseWorm,
  startPlaying,
  type FoeKind,
  type Harness,
} from "../harness";

/** The row the four charge states are laid along, and the columns they sit on. */
const CHARGE_ROW = 5;
const CHARGE_COLS = [2, 4, 6, 8] as const;

/** Where the two worms stand, and how long each is. */
const WORM_ROW = 2;
const WORM_COLS = [12, 20] as const;
const WORM_LENGTH = 3;

/** The three foe kinds, and where one of each stands. */
const KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];
const FOE_ROW = 14;
const FOE_COLS = [4, 10, 16] as const;

/** The columns the two posed bolts climb, and the row they start on. */
const BOLT_COLS = [34, 36] as const;
const BOLT_ROW = 19;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every foe and leaves the nodes, worms and bolts standing", async () => {
  startPlaying(h);

  CHARGE_COLS.forEach((c, charge) => {
    h.debug.setNode(c, CHARGE_ROW, charge);
  });
  for (const c of WORM_COLS) {
    const id = poseWorm(h, c, WORM_ROW, WORM_LENGTH);
    h.debug.setWormStepping(id, false);
  }
  KINDS.forEach((kind, index) => {
    const id = poseFoe(h, kind, FOE_COLS[index], FOE_ROW);
    h.debug.setFoeTravel(id, false);
    h.debug.setFoeMind(id, false);
  });
  for (const c of BOLT_COLS) poseBolt(h, tileCX(c), tileCY(BOLT_ROW));

  const before = h.snapshot();
  assertGreaterThan(
    before.nodes.length,
    0,
    "the nodes this scenario posed, of which there should be four",
  );
  assertGreaterThan(
    before.worms.length,
    0,
    "the worms this scenario posed, of which there should be two",
  );
  assertGreaterThan(
    before.foes.length,
    0,
    "the foes this scenario posed, of which there should be three",
  );
  assertGreaterThan(
    before.bolts.length,
    0,
    "the bolts this scenario posed, of which there should be two",
  );

  h.debug.clearFoes();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // board it produced.
  captureStill(h, "cleared");

  assertLength(after.foes, 0, "the foes on the board after clearFoes()");

  assertDeepEqual(
    after.nodes,
    before.nodes,
    "the nodes standing, against the same roster read at the instant before " +
      "clearFoes() was called",
  );

  assertDeepEqual(
    after.worms,
    before.worms,
    "the worms on the board, against the same roster read at the instant before " +
      "clearFoes() was called",
  );

  assertDeepEqual(
    after.bolts,
    before.bolts,
    "the bolts in flight, against the same roster read at the instant before " +
      "clearFoes() was called",
  );
});
