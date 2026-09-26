// foes/glitch-descends — a glitch travels down the board at its own rate.
//
// specs/foes.md: "A glitch travels horizontally at GLITCH_H_SPEED in its current
// horizontal direction and downward at GLITCH_V_SPEED, both at once", each
// "integrated against the delta time of each update". This measures the downward
// half of that, as the distance the center descended over a stated span.
//
// The glitch's mind is held off, so the dart re-pick — which is a faculty of the
// mind (specs/instrumentation.md) and the requirement foes/glitch-darts decides
// — takes no part in this reading. Its travel is what descends it, and travel is
// the one faculty this item exercises. The glitch is posed near the middle of
// the board so that neither the side edges it reverses at nor the bottom edge it
// leaves through is anywhere near the span measured.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { GLITCH_V_SPEED } from "../constants";
import {
  captureReplay,
  createHarness,
  foeById,
  poseFoePoint,
  resetTo,
  startPlaying,
  tileCenter,
  type Harness,
} from "../harness";

/** The span the descent is measured over, as the review item states it. */
const SPAN_SECONDS = 2;

/** What specs/foes.md fixes the glitch descends over that span. */
const EXPECTED_DESCENT = GLITCH_V_SPEED * SPAN_SECONDS;

/** The review item's margin: 20% of the specified descent. */
const TOLERANCE = 0.2 * EXPECTED_DESCENT;

/**
 * Where the glitch is posed: the middle column, high enough that the whole
 * descent — and the 420 units of horizontal travel a mind-held glitch makes at
 * GLITCH_H_SPEED over the span — stays clear of every edge of the board.
 */
const START = tileCenter(20, 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("descends at the glitch's own downward speed", async () => {
  resetTo(h);
  startPlaying(h);
  const id = poseFoePoint(h, "glitch", START.x, START.y);
  h.debug.setFoeMind(id, false);

  const before = foeById(h.snapshot(), id);
  const after = await captureReplay(h, "descent", async () => {
    await h.advanceSeconds(SPAN_SECONDS);
    return foeById(h.snapshot(), id);
  });

  const descended = (after?.y ?? Number.NaN) - (before?.y ?? Number.NaN);
  assertLessThanOrEqual(
    Math.abs(descended - EXPECTED_DESCENT),
    TOLERANCE,
    `the center descends ${EXPECTED_DESCENT} units over ${SPAN_SECONDS} s ` +
      `(GLITCH_V_SPEED ${GLITCH_V_SPEED}); the distance descended was`,
  );
});
