// Meltdown — heat/heat-never-negative: heat stops at zero.
//
// specs/heat.md puts the floor on the scale twice: heat "is clamped to that range
// at the end of every frame", and the resolution writes each new heat "clamped to
// `[0, 100]`". So a frame whose arithmetic would take an emitter below zero
// leaves it AT zero, and no snapshot ever reports a negative heat.
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
// A HALF-SECOND FRAME IS A LEGAL FRAME. specs/instrumentation.md mandates no
// fixed timestep — every rate in this game is per second and integrated against
// the game time the frame carries — so the game time this frame carries is half a
// second and the arithmetic over it is not in doubt. The harness supplies the
// clock rather than the game, so this check builds its own `ConstantClock` and
// leaves the suite's 120 Hz default to everything else.
//
// THE ARRANGEMENT. A Stutter posed at heat `2` between two level-III Sinks, whose
// `SINK_OUTPUT` of `36` per shared edge-tile drains `36 * 2 * (H / 100)` from each
// of two faces, beside the `0.19` its two open faces shed to air. That is `3.07`
// heat per second against the `2` the tower has, so over the one-second frame the
// item names the frame's arithmetic reaches `-1.07` and the clamp is the only
// thing between that and the reported value.
//
// AND THE OVERSHOOT DOES NOT DEPEND ON THE MASS. specs/heat.md divides the change
// by the Stutter's `0.5`, which doubles it to `6.14` — but the undivided `3.07`
// already passes zero on its own, so a build whose clamp is right and whose mass
// division is wrong still reports `0` here and fails `heat/mass-divides-the-gain`
// and `heat/mass-divides-the-cooling` alone. A shorter frame would have made this
// item fail for the mass as well, which is a different requirement.

import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  poseTower,
  startRun,
  towerOf,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor } from "./faces";
import { BOXED_SITE } from "./sites";

/** The emitter read, the heat it opens at, and the movers beside it. */
const TOWER = "stutter";
const OPENING_HEAT = 2;
const SINK_LEVEL = 3;

/** The two faces the Sinks stand against, one on each side of the footprint. */
const SINK_FACES: readonly Face[] = ["N", "S"];

/**
 * The one frame the scenario runs, in milliseconds: the second the item names,
 * undivided.
 *
 * Geometry, not a tolerance: it says how long the frame is, not how far a build
 * may miss by. Why it has to be this coarse is at the head of this file.
 */
const FRAME_MS = 1000;

/**
 * How close the settled heat must come to zero, as decimal places.
 *
 * Six places is `0.0000005`. The clamp is an exact assignment of `0`, not an
 * arithmetic result, so a conformant build reports zero itself and the places are
 * there only so that a build which reaches zero by a slightly different route —
 * clamping a `-1e-16` — is not failed for a rounding artefact. What the bound
 * excludes is the unclamped value, `-1.07`.
 */
const ZERO_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(FRAME_MS) });
});

afterEach(() => {
  h?.dispose();
});

it("Heat stops at zero", async () => {
  startRun(h);
  const site = BOXED_SITE;
  const id = poseIdleTower(h, TOWER, site.col, site.row, 0, OPENING_HEAT);

  // A Sink flush against the N face and another against the S face, each at
  // level III. specs/heat.md has the Sink drain through a face that would
  // otherwise shed nothing, and both stack.
  for (const face of SINK_FACES) {
    const at = faceAnchor(
      { type: TOWER, col: site.col, row: site.row },
      face,
      "sink",
    );
    const sink = poseTower(h, "sink", at.col, at.row);
    h.debug.setTowerLevel(sink, SINK_LEVEL);
  }

  await h.advance(1);
  captureStill(h, "floor");
  const settled = towerOf(h.snapshot(), id).heat;

  assertGreaterThanOrEqual(
    settled,
    0,
    `the heat reported after a frame whose own arithmetic reaches -1.07`,
  );

  assertCloseTo(
    settled,
    0,
    ZERO_DIGITS,
    `the heat reported after a second beside two level-${SINK_LEVEL} Sinks`,
  );
});
