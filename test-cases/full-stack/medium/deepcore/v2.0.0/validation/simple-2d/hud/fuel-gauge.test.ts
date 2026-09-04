// hud/fuel-gauge — the fuel gauge reads the fuel against the tank.
//
// `specs/ui.md`: the status bar carries a fuel gauge. `specs/character.md`: the
// maximum is set by the fuel tank tier, and `specs/upgrades.md` gives the tier's
// figures. So a gauge that reads the fuel HELD AGAINST THE TANK has to be drawn
// differently by both of the things that change that reading: the fuel, and the
// tank it is read against.
//
// The palette and the shape are the build's, so what is read is that the band is
// drawn differently — the whole band, pixel for pixel, between poses. Every read
// is taken on a frame no clock moves under, so nothing on a timer moves between
// two of them and a control pose read twice comes back identical. That control is
// asserted too, because without it a difference proves nothing.
//
// Both fuel fractions stay above `LOW_FUEL_FRACTION`, so what is read here is the
// gauge and never the alert treatment, which is its own point.

import { afterEach, beforeEach, it } from "vitest";
import { FUEL_TIERS } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  stageTiers,
  standAtCamp,
  type Harness,
} from "../harness";
import { changed, sampleBar } from "./bar";

/** Two fuel loads, both comfortably above the alert threshold. */
const FULL = FUEL_TIERS[0];
const PART = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the gauge differently for the fuel held and for the tank", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);

  h.debug.setFuel(FULL);
  const full = await sampleBar(h);
  const fullAgain = await sampleBar(h);

  h.debug.setFuel(PART);
  const part = await sampleBar(h);
  captureStill(h, "fuel");

  // The same fuel against a bigger tank: `setTier` clamps the value to the new
  // maximum and otherwise leaves it, so the reading changes and the fuel does not.
  stageTiers(h, { fuel: 3 });
  h.debug.setFuel(PART);
  const bigger = await sampleBar(h);

  assertEqual(changed(full, fullAgain), 0, "specs/ui.md");
  assertGreaterThan(changed(full, part), 0, "specs/ui.md");
  assertGreaterThan(changed(part, bigger), 0, "specs/upgrades.md");
});
