// foes/glitch-descends — a glitch travels down the board at its own rate.
//
// `specs/foes.md`: "A glitch travels horizontally at GLITCH_H_SPEED in its
// current horizontal direction and downward at GLITCH_V_SPEED, both at once",
// each velocity "integrated against the delta time of each update". This point
// reads the downward half of that, as the distance the center descended over a
// stated span, against `GLITCH_V_SPEED` (`62`) and within the review item's
// margin.
//
// THE MIND IS HELD OFF. The dart is a faculty of the mind
// (`specs/instrumentation.md`), and foes/glitch-darts is the point that decides
// it; here it would only stir the horizontal axis this reading does not take.
// The travel is what descends the glitch, and the travel is the one faculty this
// requirement exercises.
//
// NOTHING IN THE SPAN IS A BOUNDARY. The glitch is posed high on a middle
// column, so neither the side edges its direction reverses at nor the bottom
// edge it leaves through comes anywhere near — the descent is 124 units and the
// horizontal carry at most 420, from a start 656 units in and 496 above the
// bottom. So the only thing that can fail here is the rate the item names.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_V_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseFoe,
  requireFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The span the descent is measured over, as the review item states it. */
const SPAN_SECONDS = 2;

/** Whole frames of the suite's clock covering that span: 200, exactly. */
const SPAN_FRAMES = framesFor(SPAN_SECONDS);

/** What `specs/foes.md` fixes the glitch descends over that span. */
const EXPECTED_DESCENT = GLITCH_V_SPEED * SPAN_SECONDS;

/** The review item's margin: 20% of the specified descent. */
const TOLERANCE = 0.2 * EXPECTED_DESCENT;

/** Where the glitch is posed: high, on a middle column, clear of every edge. */
const START_C = 20;
const START_R = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("descends at the glitch's own downward speed", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "glitch", START_C, START_R, { mind: false });

  const before = requireFoe(
    await h.snapshot(),
    id,
    "the glitch posed to descend",
  );
  const after = await captureReplay(h, "descent", async () => {
    await h.advance(SPAN_FRAMES);
    return requireFoe(await h.snapshot(), id, "the glitch that was descending");
  });

  const descended = after.y - before.y;
  assertLessThanOrEqual(
    Math.abs(descended - EXPECTED_DESCENT),
    TOLERANCE,
    `the center descends ${EXPECTED_DESCENT} units over ${SPAN_SECONDS} s ` +
      `(GLITCH_V_SPEED ${GLITCH_V_SPEED}); the distance descended was ` +
      `${descended}, off by`,
  );
});
