// drones/prism-survives-bottom — the Prism that inverts the field is not destroyed.
//
// specs/drones.md, The spectral inversion: "A Prism that survives its dive to the
// bottom of the field swaps the whole field's bands rather than being destroyed
// there", "it enters phase `returning` and heads back toward its slot", and "The
// Prism itself is unharmed by that crossing, and it may dive again later." That is
// the half of the rule a build gets wrong by treating the bottom of the field as a
// despawn line: the inversion fires and the Prism vanishes, and the player never
// faces the same drone twice.
//
// WHAT IS DRIVEN. `drones/prism-triggers-inversion`'s scenario exactly — one Prism
// alone, shell intact, diving with travel on twenty units above the line, its slot
// posed on the grid's top row — swept to the frame the build's own inversion turns
// on. The drone is then read a fifth of a second later, which leaves a build free
// to enter the return on the crossing frame or on the one after it, and is far
// short of the shortest trip back: `DIVE_SPEED` (`300`) covers `60` units in that
// time and the slot is `500` units above the line.
//
// WHAT IS READ. The Prism is still on the field, and it is in phase `returning`.
// The two are the same sentence of the specification and neither is the trigger:
// whether the crossing inverts anything at all is
// `drones/prism-triggers-inversion`'s point, and a build that never triggers is
// named there.
//
// Nothing is destroyed in this scenario, so no stage clear is in play.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  FORM_ROW0_Y,
  PRISM_INVERT_Y,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { requireDrone } from "./roster";

/**
 * How far above `PRISM_INVERT_Y` the diving Prism is posed, in logical units.
 *
 * As in `drones/prism-triggers-inversion`: twenty units is a fifteenth of a second
 * at `DIVE_SPEED` (`300`), so the crossing is the next thing the drone's own travel
 * does under any downward path.
 */
const ABOVE_LINE = 20;

/** Where the diving Prism starts: on the ship's lane, just above the line. */
const AT = { x: FORM_CENTER_X, y: PRISM_INVERT_Y - ABOVE_LINE } as const;

/**
 * The slot the Prism is posed as belonging to.
 *
 * The centre of the grid's top row, `500` units above the line, so "heads back
 * toward its slot" is a journey the drone is unambiguously still on when it is read
 * rather than one it could have finished in the same breath.
 */
const SLOT = { x: FORM_CENTER_X, y: FORM_ROW0_Y } as const;

/**
 * Frames the crossing is swept for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds", so a build whose dive
 * never reaches the line spends this and is read where it stands.
 */
const SWEEP_FRAMES = ticksFor(8);

/**
 * Frames run after the inversion turns on, before the drone is read.
 *
 * A fifth of a second. specs/drones.md does not fix the frame the return begins on,
 * so this leaves a build free to enter `returning` on the crossing frame or on the
 * one after it; and at `DIVE_SPEED` (`300`) it covers `60` of the `500` units back
 * to the slot, so a Prism that is heading home is still heading home.
 */
const SETTLE_FRAMES = ticksFor(0.2);

/**
 * What a missing drone would mean here.
 *
 * "The Prism itself is unharmed by that crossing", so a roster that no longer holds
 * the id is the build that treats the bottom of the field as a despawn line — the
 * defect this point exists to name.
 */
const ALIVE =
  "the Prism still on the field after the crossing that inverted it, unharmed " +
  "rather than destroyed there (specs/drones.md)";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the Prism that inverted the field alive and heading for its slot", async () => {
  // An empty, quiet, live wave at stage 1 with the inversion at zero, then exactly
  // the one diver the requirement is about.
  startPosed(h);
  const prism = poseDrone(h, "prism", AT.x, AT.y, {
    shell: true,
    slot: SLOT,
    phase: "diving",
    travel: true,
  });

  await h.until((snapshot) => snapshot.inversionActive, {
    maxFrames: SWEEP_FRAMES,
    poll: 1,
  });
  await h.advance(SETTLE_FRAMES);
  captureStill(h, "survived");

  const after = requireDrone(h.snapshot(), prism, ALIVE);
  assertEqual(
    after.phase,
    "returning",
    "the phase a Prism enters after the crossing, heading back toward its slot " +
      "(specs/drones.md)",
  );
});
