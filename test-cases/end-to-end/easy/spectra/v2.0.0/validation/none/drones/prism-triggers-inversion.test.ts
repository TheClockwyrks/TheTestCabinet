// drones/prism-triggers-inversion — a Prism reaching the bottom inverts the field.
//
// specs/drones.md, The spectral inversion: "When a diving Prism with a layer still
// intact has its center cross `PRISM_INVERT_Y` (`640`) traveling downward, it
// triggers a spectral inversion as `specs/bands.md` states". It is the kind's
// threat and the reason a wave has to be answered rather than waited out: a Prism
// that gets through does not hurt the ship, it changes what everything on the
// field reads as for `INVERSION_TIME` seconds.
//
// WHY THE PRISM IS POSED AT THE LINE RATHER THAN SENT DOWN FROM THE FORMATION.
// specs/swarm.md lets a dive end "either by turning back above `FIELD_BOTTOM`
// without ever entering the bottom HUD strip, or by wrapping through the bottom",
// so a conformant build is under no obligation to carry any PARTICULAR dive as far
// as 640. Posing the Prism at the line is what makes the crossing the scenario
// rather than a lottery: the requirement graded here is what happens WHEN a diving
// Prism crosses, and the drone is put where crossing is the next thing its own
// travel does.
//
// The reading is the build's own `inversionActive`, which specs/instrumentation.md
// derives from the seconds remaining. How LONG the inversion lasts, and what it
// swaps while it runs, are `bands`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X, FORM_ROW0_Y, PRISM_INVERT_Y } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at. */
const STAGE = 1;

/**
 * How far above `PRISM_INVERT_Y` the diving Prism is posed, in logical units.
 *
 * Twenty units is a fifteenth of a second at `DIVE_SPEED` (300), so the crossing
 * is the next thing the drone's own travel does under any downward path — while
 * still leaving the drone's whole body above the line at the pose, so the crossing
 * really is a crossing rather than a placement already past it.
 */
const ABOVE_LINE = 20;

/** Where the diving Prism starts: on the ship's lane, just above the line. */
const AT = { x: FORM_CENTER_X, y: PRISM_INVERT_Y - ABOVE_LINE } as const;

/**
 * Frames the crossing is swept for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." A build whose dive
 * turns back above the line without ever reaching it therefore spends this whole
 * budget and is read as not having inverted, which is a verdict rather than a
 * hang.
 */
const SWEEP_FRAMES = framesFor(8);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("begins a spectral inversion when a diving Prism crosses PRISM_INVERT_Y", async () => {
  await startPosed(harness, { stage: STAGE });
  await poseDrone(harness, "prism", AT.x, AT.y, {
    // A layer still intact, which is what the crossing requires.
    shell: true,
    slotX: FORM_CENTER_X,
    slotY: FORM_ROW0_Y,
    phase: "diving",
    travel: true,
  });

  const inverted = await harness.until((snapshot) => snapshot.inversionActive, {
    maxFrames: SWEEP_FRAMES,
    poll: 1,
  });
  await captureStill(harness, "inverted");

  assertEqual(
    inverted.snapshot.inversionActive,
    true,
    "a spectral inversion running after a diving Prism crossed PRISM_INVERT_Y (specs/drones.md)",
  );
});
