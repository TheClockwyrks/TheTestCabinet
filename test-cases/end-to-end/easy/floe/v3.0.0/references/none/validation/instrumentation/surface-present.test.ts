// Floe — instrumentation/surface-present: the debugging and automation surface
// the build installs is there, is whole, and is wired to the running game rather
// than to a plausible-looking object.
//
// `specs/instrumentation.md` makes the surface a deliverable: "the build installs
// the finished surface on `window.__floe` as soon as the game has initialized",
// and "Every scenario driven from code reaches the game through it, so it is
// present and exactly as specified here". It carries `version`
// (`FLOE_DEBUG_VERSION`, `1`) and every operation that file names — which under
// this engine includes the two clock operations, `setAutoStep` and `advance`,
// that exist only where nothing outside the build owns the clock. So the first
// half of this check is reflection: each operation is present, as a function,
// under the name the specification gives it, and the version reads `1`.
//
// THE SECOND HALF IS THE ONE THAT MATTERS. A surface that answers every call and
// reports a state unconnected to the game passes reflection and then fails every
// other point in this suite for reasons that name the wrong mechanic. So two
// poses are driven and read back through the game itself: `addCritter` puts the
// critter on a tile and `snapshot` reports it there, and `addBear` plus
// `setBearStep` commits a bear to one step that the build's own travel then
// carries out, so the bear arrives on the next tile.
//
// THE POSED TILES ARE DISTINGUISHING. The critter's column differs from its row
// and neither matches the bear's, so a build that swapped an axis, or that
// reported some other body, reads as a tile this check names rather than merely
// as "not the one expected".
//
// WHAT THIS DOES NOT DECIDE. Not the bear's speed: the drive below is three times
// the game time one tile costs at `bearIceSpeed(1)`, so a build a third as fast
// still arrives here and is graded on its speed by `hunter/ice-speed` alone. Not
// where the bear went next either — its routing is off, so the one step it was
// committed to is the whole of what is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BEAR_ICE_SPEED, type Facing } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  FLOE_DEBUG_VERSION,
  poseBear,
  REQUIRED_OPS,
  requireBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The tile the critter is posed on: inside the ice band, which
 * `specs/strait.md` makes solid ice the critter may stand on anywhere, and with
 * a column that differs from its row so a swapped axis reads as a named tile.
 */
const CRITTER_COL = 22;
const CRITTER_ROW = 15;

/** The tile the bear is settled on, and the one step it is committed to. */
const BEAR_COL = 10;
const BEAR_ROW = 15;
const STEP: Facing = "right";
const STEP_COL = BEAR_COL + 1;
const STEP_ROW = BEAR_ROW;

/**
 * How many times over the bear is given the game time one tile costs it.
 *
 * `specs/hunter.md` fixes `BEAR_ICE_SPEED` at `3` tiles per second, so one tile
 * of ice footing is a third of a second. Three times that is deliberately loose:
 * this point decides that the surface committed a step the simulation carries
 * out, and a build a third as fast still arrives inside the window and is graded
 * on its speed by `hunter/ice-speed` instead. Its routing is off, so once it has
 * settled it holds that tile however much longer the drive runs.
 */
const STEP_ALLOWANCE = 3;
const DRIVE_TICKS = ticksFor(STEP_ALLOWANCE / BEAR_ICE_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
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
    FLOE_DEBUG_VERSION,
    `window.__floe.version, which specs/instrumentation.md fixes as ` +
      `FLOE_DEBUG_VERSION (${FLOE_DEBUG_VERSION})`,
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(
      probed.ops[op],
      "function",
      `typeof window.__floe.${op}, an operation specs/instrumentation.md ` +
        `requires on the surface`,
    );
  }

  // An empty, quiet strait: nothing on it but the two bodies posed below.
  await startCrossing(h);

  await h.debug.addCritter(CRITTER_COL, CRITTER_ROW);
  // Only the faculty this point exercises is left on. Travel is what carries the
  // committed step out; the routing that would choose another step and the sense
  // that would aim it are both held off.
  const bear = await poseBear(h, BEAR_COL, BEAR_ROW, {
    sense: false,
    routing: false,
  });
  await h.debug.setBearStep(bear, STEP);

  // Read before a tick runs: the harness holds the game off the wall clock, so
  // nothing stands between the pose and the reading that checks it.
  const posed = await h.snapshot();

  await h.advance(DRIVE_TICKS);
  const driven = await h.snapshot();
  // Before the assertions, so a failing check still leaves the picture of the
  // strait it was reading.
  await captureStill(h, "state");

  assertEqual(
    `${posed.critter.col},${posed.critter.row}`,
    `${CRITTER_COL},${CRITTER_ROW}`,
    `the tile snapshot() reports the critter on after ` +
      `addCritter(${CRITTER_COL}, ${CRITTER_ROW})`,
  );
  assertEqual(
    posed.critter.present,
    true,
    `snapshot().critter.present after addCritter(${CRITTER_COL}, ` +
      `${CRITTER_ROW}), which puts a critter on the strait`,
  );

  const settled = requireBear(driven, bear, "the bear addBear appended");
  assertEqual(
    `${settled.col},${settled.row}`,
    `${STEP_COL},${STEP_ROW}`,
    `the tile the bear settled on after setBearStep(${bear}, "${STEP}") from ` +
      `(${BEAR_COL}, ${BEAR_ROW}) and ` +
      `${(STEP_ALLOWANCE / BEAR_ICE_SPEED).toFixed(2)} s of stepped game ` +
      `time — the surface poses the strait and the game's own travel runs from ` +
      `there (specs/instrumentation.md)`,
  );
});
