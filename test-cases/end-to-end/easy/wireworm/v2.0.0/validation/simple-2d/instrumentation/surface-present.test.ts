// Wireworm — instrumentation/surface-present: the debug and automation surface
// is present, whole, and live.
//
// specs/instrumentation.md makes the surface a deliverable of the build: its
// `initialize` returns the finished surface beside the state, as
// `[state, debug]`, the engine hands that same value back from `engine.debug`,
// and it is reached that way alone — nothing is installed on the page. Every
// other suite in this project poses its scenario through it, so a missing
// surface also shows up as every other suite failing to run; this one names the
// fault plainly.
//
// THREE HALVES, AND EACH IS THE BUILD'S.
//
// PRESENCE. `engine.debug` holds an object rather than nothing.
//
// COMPLETENESS. `version` is `WIREWORM_DEBUG_VERSION` (`1`), a plain number, and
// every operation specs/instrumentation.md names is a function on the surface.
// The list is `REQUIRED_OPS` in `surface.ts`, which is that file's operation
// tables written down. `setAutoStep` and `advance` are deliberately NOT demanded:
// under an engine the clock is the engine's, and the specification gives those
// two to the engineless build alone. Neither is `setMuted`, which the
// specification does not carry at all.
//
// LIVENESS. A surface that answers with a plausible-looking object unconnected to
// the running game is the failure worth naming, so the check poses one node and
// one worm and requires both readings to be of the real game: the node's charge
// comes back off `snapshot`, and the worm's head is on a different tile once a
// step interval of game time has passed. The posed charge is `2` rather than `0`
// or `3` so every wrong answer reads as a different number — a build that ignored
// the argument reads `0`, one that saturated reads `3`, and one that never
// created the node reads no node at all (specs/nodes.md fixes the four charges).
//
// WHICH TILE the head lands on is `worm.winds-horizontal`'s requirement and is
// not asserted here: this point asks only that the posed worm moved at all, so a
// build whose winding is wrong fails that point and not this one.

import { afterEach, beforeEach, it } from "vitest";
import { wormStepInterval } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  headOf,
  poseWorm,
  sameTile,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
} from "../harness";
import { REQUIRED_OPS, WIREWORM_DEBUG_VERSION } from "../surface";

/**
 * The charge the liveness pose writes, and the tile it writes it on.
 *
 * `2` is the distinguishing value of specs/nodes.md's four charges: a build that
 * ignored the argument reads `0`, one that saturated at `CHARGE_MAX` reads `3`,
 * and one that laid no node at all reads `null`.
 */
const POSED_CHARGE = 2;
const NODE_C = 10;
const NODE_R = 5;

/** Where the liveness pose puts its one-segment worm: a clear row of its own. */
const WORM_C = 10;
const WORM_R = 12;

/**
 * Frames covering one and a half of level 1's step intervals.
 *
 * specs/worm.md: a worm steps each time its clock reaches
 * `wormStepInterval(level)`, which is `0.14` s at level 1, and its clock starts
 * when the worm comes into existence. One and a half intervals is past the first
 * step and short of the second, so the head has moved exactly once.
 */
const ONE_STEP_TICKS = ticksFor(wormStepInterval(1) * 1.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface beside its state from initialize", () => {
  // `engine.debug` is whatever the build's `initialize` returned as the second
  // element of `[state, debug]`, so reading it is the check: there is no page
  // property to look for and nothing the harness could have supplied in the
  // build's place. A build that returned `null` there has no surface.
  assertNotNull(
    h.engine.debug,
    "src/game.ts's initialize must return the debug surface beside its state, " +
      "as [state, debug] (specs/instrumentation.md)",
  );
  assertEqual(typeof h.engine.debug, "object");
});

it("carries the version and every specified operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number", "version is a plain number");
  assertEqual(api.version, WIREWORM_DEBUG_VERSION, "WIREWORM_DEBUG_VERSION");
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof api[op],
      "function",
      `specs/instrumentation.md names ${op} as an operation of the surface`,
    );
  }
});

it("is live: a posed node reads back and a posed worm steps", async () => {
  startPlaying(h);

  h.debug.setNode(NODE_C, NODE_R, POSED_CHARGE);
  const id = poseWorm(h, WORM_C, WORM_R);
  h.debug.setWormBody(id, false);

  // The node the pose created is reported at the charge it was posed at, so the
  // surface reads the running game rather than an object of its own.
  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    POSED_CHARGE,
    `setNode must create the node at (${NODE_C}, ${NODE_R}) at the charge it ` +
      "was given (specs/instrumentation.md)",
  );

  const posedHead = headOf(wormOf(h.snapshot(), id));
  await h.advance(ONE_STEP_TICKS);
  // The frame the reading below is taken from: the posed node and the worm that
  // has just stepped off the tile it was posed on.
  captureStill(h, "live");

  // And the worm the pose put on the board is stepping, so the surface drives
  // the game that is actually running. Which tile it stepped to is
  // `worm.winds-horizontal`'s point, not this one.
  const head = headOf(wormOf(h.snapshot(), id));
  assertEqual(
    sameTile(head, posedHead),
    false,
    `a worm posed through addWorm must take its first step within ` +
      `${String(wormStepInterval(1) * 1.5)} s of game time (specs/worm.md)`,
  );
});
