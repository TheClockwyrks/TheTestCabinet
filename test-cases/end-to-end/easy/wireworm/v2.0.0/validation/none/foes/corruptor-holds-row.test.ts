// foes/corruptor-holds-row — a corruptor never descends.
//
// `specs/foes.md`: "Its center y never changes: it holds the row it entered on
// for the whole crossing and never descends."
//
// So the reading is the VERTICAL displacement over a long stretch of crawling,
// and the specification fixes it at nothing. Three seconds is long enough that a
// build descending at even the slowest of the three foes' rates —
// `GLITCH_V_SPEED` (`62`) — would have fallen the height of nearly six tiles,
// and the corruptor crawls throughout, because the rule is written about a
// corruptor that is CROSSING rather than one standing still.
//
// THE MIND IS HELD OFF. Slamming a node is a faculty of the mind
// (`specs/instrumentation.md`) and takes no part in where a corruptor is; the
// crossing this rule is about is the travel. It is posed mid-board, so three
// seconds of crawling at `CORRUPTOR_SPEED` carries it `390` units and leaves it
// on the board whichever way it entered from — which the check confirms before
// reading the row, since a corruptor that left the board has no row to report.

import { afterEach, beforeEach, it } from "vitest";
import { CORRUPTOR_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseFoe,
  requireFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The span the row is held over, as the review item states it. */
const SPAN_SECONDS = 3;
const SPAN_FRAMES = framesFor(SPAN_SECONDS);

/**
 * How far the center may drift vertically: nothing.
 *
 * `specs/foes.md` fixes the center `y` as never changing, so this is not a
 * margin around a figure — it is the noise of carrying a coordinate through
 * three hundred floating-point updates that add a zero-valued term to it.
 */
const DRIFT_TOLERANCE = 1e-6;

/** Where the corruptor is posed: mid-board, on a row a corruptor enters on. */
const START_C = 20;
const START_R = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the corruptor's row for the whole of a crossing", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "corruptor", START_C, START_R, { mind: false });

  const before = requireFoe(
    await h.snapshot(),
    id,
    "the corruptor posed to cross the board",
  );
  await h.advance(SPAN_FRAMES);
  const after = requireFoe(
    await h.snapshot(),
    id,
    `the corruptor still crossing after ${SPAN_SECONDS} s at ` +
      `CORRUPTOR_SPEED ${CORRUPTOR_SPEED} from mid-board`,
  );

  await captureStill(h, "row");
  assertLessThanOrEqual(
    Math.abs(after.y - before.y),
    DRIFT_TOLERANCE,
    `the center y never changes over ${SPAN_SECONDS} s of crawling; it moved ` +
      `${after.y - before.y} units vertically, of a magnitude`,
  );
});
