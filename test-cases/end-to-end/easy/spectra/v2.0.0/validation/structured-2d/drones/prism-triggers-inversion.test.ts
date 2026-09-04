// drones/prism-triggers-inversion — a Prism reaching the bottom inverts the field.
//
// specs/drones.md, The spectral inversion: "When a diving Prism with a layer still
// intact has its center cross `PRISM_INVERT_Y` (`640`) traveling downward, it
// triggers a spectral inversion as `specs/bands.md` states". It is the kind's
// threat and the reason a wave has to be answered rather than waited out: a Prism
// that gets through does not hurt the ship, it changes what everything on the field
// reads as for `INVERSION_TIME` seconds.
//
// WHAT IS DRIVEN. One Prism alone, its shell intact — "a layer still intact" — in
// phase `diving` with its TRAVEL ON and its fire off, posed twenty units above the
// line so its own descent carries it across within a few frames of any dive path a
// build lays out. Its fire is off because the bullets a dive carries are
// `drones/prism-fires-two-bands`' requirement and would be bystanders here; its
// slot is posed on the grid's top row so the return the crossing starts is a real
// journey rather than a step, which is what `drones/prism-survives-bottom` reads.
// `startPosed` leaves the field empty and the inversion at zero, so the reading
// below can only be the crossing's doing.
//
// WHY THE PRISM IS POSED AT THE LINE RATHER THAN SENT DOWN FROM THE FORMATION.
// specs/swarm.md lets a dive end "either by turning back above `FIELD_BOTTOM`
// without ever entering the bottom HUD strip, or by wrapping through the bottom",
// so a conformant build is under no obligation to carry any PARTICULAR dive as far
// as `640`. Posing the Prism at the line is what makes the crossing the scenario
// rather than a lottery: the requirement graded here is what happens WHEN a diving
// Prism crosses, and the drone is put where crossing is the next thing its own
// travel does.
//
// The reading is the build's own `inversionActive`, which specs/instrumentation.md
// derives from the seconds remaining. How LONG the inversion lasts, and what it
// swaps while it runs, are `bands`'.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, FORM_ROW0_Y, PRISM_INVERT_Y } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How far above `PRISM_INVERT_Y` the diving Prism is posed, in logical units.
 *
 * Geometry, not a tolerance. Twenty units is a fifteenth of a second at
 * `DIVE_SPEED` (`300`), so the crossing is the next thing the drone's own travel
 * does under any downward path — while still leaving the drone's whole centre above
 * the line at the pose (`PRISM_HALF` is `28`, so the pose straddles it rather than
 * sitting past it), so the crossing really is a crossing rather than a placement
 * already through.
 */
const ABOVE_LINE = 20;

/** Where the diving Prism starts: on the ship's lane, just above the line. */
const AT = { x: FORM_CENTER_X, y: PRISM_INVERT_Y - ABOVE_LINE } as const;

/**
 * The slot the Prism is posed as belonging to: the centre of the grid's top row.
 *
 * Far above the line, so the return the crossing starts is a real journey rather
 * than a step. Nothing here reads it; `drones/prism-survives-bottom` does.
 */
const SLOT = { x: FORM_CENTER_X, y: FORM_ROW0_Y } as const;

/**
 * Frames the crossing is swept for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." A build whose dive
 * turns back above the line without ever reaching it therefore spends this whole
 * budget and is read as not having inverted, which is a verdict rather than a hang.
 */
const SWEEP_FRAMES = ticksFor(8);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("begins a spectral inversion when a diving Prism crosses PRISM_INVERT_Y", async () => {
  // An empty, quiet, live wave at stage 1 with the inversion at zero, then exactly
  // the one diver the requirement is about.
  startPosed(h);
  poseDrone(h, "prism", AT.x, AT.y, {
    // A layer still intact, which is what the crossing requires.
    shell: true,
    slot: SLOT,
    phase: "diving",
    travel: true,
  });

  const inverted = await h.until((snapshot) => snapshot.inversionActive, {
    maxFrames: SWEEP_FRAMES,
    poll: 1,
  });
  captureStill(h, "inverted");

  assertEqual(
    inverted.snapshot.inversionActive,
    true,
    "a spectral inversion running after a diving Prism crossed PRISM_INVERT_Y " +
      "(specs/drones.md)",
  );
});
