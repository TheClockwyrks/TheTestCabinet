// Meltdown — heat/heat-never-negative: heat stops at zero.
//
// `specs/heat.md` puts the floor on the scale twice: heat "is clamped to that
// range at the end of every frame", and the resolution writes each new heat
// "clamped to `[0, 100]`". So a frame whose arithmetic would take an emitter
// below zero leaves it AT zero, and no snapshot ever reports a negative heat.
//
// WHY THE FRAME IS COARSE, AND WHY IT HAS TO BE. Every drain in this scenario is
// proportional to the heat it is draining — air cooling and the Sink both scale
// with `H / 100` — so the approach to zero is asymptotic and a fine frame can
// never overshoot it: the clamp would never be exercised at all, and a build with
// no clamp would pass. The only arrangement that decides the requirement is one
// where the specification's own arithmetic goes past zero, which takes a frame
// long enough that the drain over it exceeds the heat left. Since every drain
// here is proportional to the heat, that threshold does not move with the heat
// posed: it is a property of the arrangement, and for two level-III Sinks on a
// Stutter it is a third of a second.
//
// A HALF-SECOND FRAME IS A LEGAL FRAME. `specs/instrumentation.md` mandates no
// fixed timestep and defines `advance(seconds, frames)` as "`frames` whole
// frames covering `seconds` of game time, each worth `seconds / frames`", so the
// game time this frame carries is half a second and the arithmetic over it is
// not in doubt. A build that clamped its own delta would reach a different place
// over one frame than over a hundred and twenty, which the same page forbids —
// `advance(1, 1)` and `advance(1, 120)` "cover the same second and reach the
// same outcome" — and which `instrumentation/deterministic-core` decides.
//
// THE ARRANGEMENT. A Stutter posed at heat `2` between two level-III Sinks, whose
// `SINK_OUTPUT` of `36` per shared edge-tile drains `36 * 2 * (H / 100)` from each
// of two faces, over a mass of `0.5` that doubles every flow. Over a half-second
// frame that is `3.07` heat against the `2` the tower has, so the frame's
// arithmetic reaches `-1.07` and the clamp is the only thing between that and the
// reported value. Two such frames make up the second the item names, and the heat
// is read after each of them, so a build that reports the unclamped value on the
// first frame is caught there rather than after it has decayed back toward zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThanOrEqual } from "../assert";
import { BOXED_SITE } from "../fixtures";
import {
  ConstantClock,
  captureStill,
  createHarness,
  poseIdleTower,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { faceAnchor } from "./faces";

/** The emitter read, the heat it opens at, and the movers beside it. */
const TOWER = "stutter";
const OPENING_HEAT = 2;
const SINK_LEVEL = 3;

/**
 * The frame the scenario runs in, in milliseconds, and how many of them make up
 * the second the item names.
 *
 * Geometry, not a tolerance: it says how the second is divided, not how far a
 * build may miss by. Half a second is the coarsest division the reading needs
 * and the reason it must be coarse is at the head of this file.
 */
const FRAME_MS = 500;
const FRAMES_IN_A_SECOND = 2;

/**
 * How close the settled heat must come to zero, as decimal places.
 *
 * Six places is `0.0000005`. The clamp is an exact assignment of `0`, not an
 * arithmetic result, so a conformant build reports zero itself and the places
 * are there only so that a build which reaches zero by a slightly different
 * route — clamping a `-1e-16` — is not failed for a rounding artefact. What the
 * bound excludes is the unclamped value, `-1.07`.
 */
const ZERO_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(FRAME_MS) });
});

afterEach(async () => {
  await h.dispose();
});

it("Heat stops at zero", async () => {
  await startRun(h);
  const site = BOXED_SITE;
  const id = await poseIdleTower(h, TOWER, site.col, site.row, {
    heat: OPENING_HEAT,
  });

  // A Sink flush against the N face and another against the S face, each at
  // level III. `specs/heat.md` has the Sink drain through a face that would
  // otherwise shed nothing, and both stack.
  for (const side of ["N", "S"] as const) {
    const at = faceAnchor(
      { type: TOWER, col: site.col, row: site.row },
      side,
      "sink",
    );
    const sink = await poseTower(h, "sink", at.col, at.row);
    await h.debug.setTowerLevel(sink, SINK_LEVEL);
  }

  let settled = OPENING_HEAT;
  for (let frame = 1; frame <= FRAMES_IN_A_SECOND; frame += 1) {
    await h.advance(1);
    settled = requireTower(await h.snapshot(), id, `frame ${frame}`).heat;
    assertGreaterThanOrEqual(
      settled,
      0,
      `the heat reported after frame ${frame} of ${FRAMES_IN_A_SECOND}`,
    );
  }
  await captureStill(h, "floor");

  assertCloseTo(
    settled,
    0,
    ZERO_DIGITS,
    `the heat reported after a second beside two level-${SINK_LEVEL} Sinks`,
  );
});
