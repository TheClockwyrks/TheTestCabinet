// hud/hull-alert — the hull gauge changes treatment under the threshold.
//
// `specs/character.md`: below `LOW_HULL_FRACTION` (`0.25`) of the maximum the
// hull gauge takes the alert treatment. What that treatment LOOKS like is the
// build's, so what is read is that the gauge is drawn differently from the same
// gauge above the threshold — and that the difference is more than the gauge
// simply being shorter.
//
// THE CONTROL IS WHAT MAKES THAT SEPARABLE. Two poses either side of the
// threshold differ in two ways at once: the alert, and a little less hull in the
// gauge. So a second pair the SAME distance apart is read on the same side of the
// threshold, and the straddling pair has to move materially more of the band than
// that. What is left between the two pairs is the treatment alone.
//
// Every read is a frame of no length, so a pulsing treatment is held at one phase
// and a pose read twice comes back identical.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { HULL_MAX, LOW_HULL_FRACTION } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";
import { changed, sampleBar } from "./bar";

/** How far either side of a threshold each pair is posed, as a fraction. */
const STEP = 0.01;

/** Where the control pair sits above the threshold, as a fraction. */
const CONTROL_AT = LOW_HULL_FRACTION + 0.1;

/** How many times the control the straddling pair must move. */
const TREATMENT_FACTOR = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the gauge differently below the low-hull threshold", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtCamp(h);

  const max = HULL_MAX[0];
  const at = async (fraction: number): Promise<number[]> => {
    await h.debug.setHull(fraction * max);
    return sampleBar(h);
  };

  const controlHigh = await at(CONTROL_AT + STEP);
  const controlLow = await at(CONTROL_AT - STEP);
  const above = await at(LOW_HULL_FRACTION + STEP);
  const below = await at(LOW_HULL_FRACTION - STEP);
  await captureStill(h, "alert");

  const control = changed(controlHigh, controlLow);
  const straddling = changed(above, below);

  assertGreaterThan(straddling, 0, "specs/character.md");
  assertGreaterThan(
    straddling,
    TREATMENT_FACTOR * control,
    "specs/character.md",
  );
});
