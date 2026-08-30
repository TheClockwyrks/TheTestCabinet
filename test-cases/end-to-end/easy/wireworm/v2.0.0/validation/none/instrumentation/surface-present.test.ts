// Wireworm — instrumentation/surface-present: the debug and automation surface
// the build installs is there, is whole, and is wired to the running game rather
// than to a plausible-looking object.
//
// specs/instrumentation.md makes the surface a deliverable: "the build installs
// the finished surface on `window.__wireworm` as soon as the game has
// initialized", and "Every scenario driven from code reaches the game through it,
// so it is present and exactly as specified here". It carries `version`
// (`WIREWORM_DEBUG_VERSION`, `1`) and every operation that file names — which
// under this engine includes the two clock operations, `setAutoStep` and
// `advance`, that exist only where nothing outside the build owns the clock.
// So the first half of this check is reflection: each operation is present, as a
// function, under the name the specification gives it, and the version reads `1`.
//
// THE SECOND HALF IS THE ONE THAT MATTERS. A surface that answers every call and
// reports a state unconnected to the game passes reflection and then fails every
// other point in this suite for reasons that name the wrong mechanic. So two
// poses are driven and read back through the game itself: `setNode` puts a charge
// on a tile and `snapshot` reports that charge, and `addWorm` builds a worm that
// the build's own step clock then carries off the tile it was posed on.
//
// THE POSED CHARGE IS THE DISTINGUISHING ONE. `POSED_CHARGE` is `2` rather than
// `0` or `3`, so a build whose `setNode` creates a node and ignores the argument
// reads `0`, one that saturates every node reads `3`, and one that never created
// the node at all reads absent. Each wrong model reads as a different answer
// (specs/nodes.md fixes the four charges).
//
// WHAT THIS DOES NOT DECIDE. Not the worm's cadence: the drive below is three
// level-1 step intervals long, so a build whose interval is anywhere up to three
// times the figure specs/worm.md fixes still takes a step here and is graded on
// its cadence by `worm/step-cadence` alone. Not where the head went, either —
// only that the surface's `addWorm` produced a worm the simulation moves.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  failSurface,
  framesFor,
  headOf,
  poseWorm,
  REQUIRED_OPS,
  startPlaying,
  WIREWORM_DEBUG_VERSION,
  wormById,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/**
 * The tile the posed node stands on, well clear of the worm's row so neither
 * reading can be an effect of the other.
 */
const NODE_C = 30;
const NODE_R = 8;

/**
 * The charge posed on it: `2`, which specs/nodes.md calls charged.
 *
 * The distinguishing value of the four. A build that creates the node and
 * ignores the charge reads `0`, one that saturates reads `3`, and one whose
 * `setNode` created nothing reads absent — so a failure names which wrong model
 * the build implemented rather than merely saying the node was wrong.
 */
const POSED_CHARGE = 2;

/** The tile the posed worm's head starts on, on an otherwise empty row. */
const WORM_C = 5;
const WORM_R = 3;

/**
 * How many level-1 step intervals the worm is driven for.
 *
 * specs/worm.md fixes `wormStepInterval(1)` at `WORM_STEP_L1` (`0.14` s), and
 * one interval would be enough for a build that keeps to it. Three is
 * deliberately loose: this point decides that the surface built a worm the
 * simulation carries, and a build whose interval is off by as much as a factor
 * of three still steps here and is graded on its cadence by `worm/step-cadence`
 * instead. Nothing about where the head lands is read.
 */
const STEP_ALLOWANCE = 3;

/** That span in frames of the suite's clock. */
const DRIVE_FRAMES = framesFor(STEP_ALLOWANCE * WORM_STEP_L1);

/**
 * The tile a worm's head stands on, as `"c,r"`, or what the snapshot reported
 * instead — so a build whose worm vanished fails naming that rather than
 * throwing on a missing entry.
 */
function headTile(snapshot: WirewormSnapshot, id: number): string {
  const worm = wormById(snapshot, id);
  if (worm === undefined) return `no worm carrying id ${id}`;
  const head = headOf(worm);
  return head === undefined ? "a worm of no segments" : `${head.c},${head.r}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("carries every documented operation and drives the running game", async () => {
  // The surface itself first: a build that installed nothing, or installed
  // something incomplete, is named for exactly that rather than failing later on
  // a call it never had.
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  // Reflection through reads that invoke nothing, so a build missing one
  // operation is told which one.
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    WIREWORM_DEBUG_VERSION,
    `window.__wireworm.version, which specs/instrumentation.md fixes as ` +
      `WIREWORM_DEBUG_VERSION (${WIREWORM_DEBUG_VERSION})`,
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(
      probed.ops[op],
      "function",
      `typeof window.__wireworm.${op}, an operation specs/instrumentation.md ` +
        `requires on the surface`,
    );
  }

  // An empty, quiet board: nothing on it but the two things posed below.
  await startPlaying(h);

  await h.debug.setNode(NODE_C, NODE_R, POSED_CHARGE);
  const id = await poseWorm(h, { c: WORM_C, r: WORM_R });

  // Read before a frame runs: the harness holds the game off the wall clock, so
  // nothing stands between the pose and the reading that checks it.
  const posed = await h.snapshot();

  await h.advance(DRIVE_FRAMES);
  const driven = await h.snapshot();
  // Before the assertions, so a failing check still leaves the picture of the
  // board it was reading.
  await captureStill(h, "live");

  assertEqual(
    chargeAt(posed, NODE_C, NODE_R),
    POSED_CHARGE,
    `the charge snapshot() reports on tile (${NODE_C}, ${NODE_R}) after ` +
      `setNode(${NODE_C}, ${NODE_R}, ${POSED_CHARGE}) — null means no node ` +
      `was created`,
  );

  assertEqual(
    headTile(posed, id),
    `${WORM_C},${WORM_R}`,
    `the head tile snapshot() reports for the worm addWorm(${WORM_C}, ` +
      `${WORM_R}) appended`,
  );

  // And the build's own step clock carried it off that tile: the surface posed
  // a worm the simulation runs, not a record it keeps.
  assertNotEqual(
    headTile(driven, id),
    `${WORM_C},${WORM_R}`,
    `the head tile after ${STEP_ALLOWANCE} level-1 step intervals ` +
      `(${(STEP_ALLOWANCE * WORM_STEP_L1).toFixed(2)} s of game time), which ` +
      `is the tile it was posed on`,
  );
});
