// hud/fuel-alert — the fuel gauge changes treatment under the threshold.
//
// `specs/character.md`: below `LOW_FUEL_FRACTION` (`0.2`) of the maximum the fuel
// gauge takes the alert treatment. What that treatment LOOKS like is the build's,
// so what is read is that the gauge is drawn differently from the same gauge
// above the threshold — and that the difference is more than the gauge simply
// being shorter.
//
// THE CONTROL IS WHAT MAKES THAT SEPARABLE. Two poses either side of the
// threshold differ in two ways at once: the alert, and two units less fuel in the
// gauge. So a second pair the SAME two units apart is read on the same side of
// the threshold, and the straddling pair has to move MORE of the band than that
// pair does. Both pairs change the same number of digits and the same length of
// fill, so what is left between them is the treatment alone.
//
// Every read is a frame no clock moves under, so a pulsing treatment is held at
// one phase and a pose read twice comes back identical.

import { afterEach, beforeEach, it } from "vitest";
import { FUEL_TIERS, LOW_FUEL_FRACTION } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";
import { changed, sampleBar, type Reading } from "./bar";

/** How far either side of a threshold each pair is posed, as a fraction. */
const STEP = 0.01;

/** Where the control pair sits above the threshold, as a fraction. */
const CONTROL_AT = LOW_FUEL_FRACTION + 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the gauge differently below the low-fuel threshold", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);

  const max = FUEL_TIERS[0];
  const at = (fraction: number): Promise<Reading> => {
    h.debug.setFuel(fraction * max);
    return sampleBar(h);
  };

  const controlHigh = await at(CONTROL_AT + STEP);
  const controlLow = await at(CONTROL_AT - STEP);
  const above = await at(LOW_FUEL_FRACTION + STEP);
  const below = await at(LOW_FUEL_FRACTION - STEP);
  captureStill(h, "alert");

  const control = changed(controlHigh, controlLow);
  const straddling = changed(above, below);

  assertGreaterThan(straddling, 0, "specs/character.md");
  assertGreaterThan(straddling, control, "specs/character.md");
});
