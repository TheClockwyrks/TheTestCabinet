// presentation/charges-distinct — the five charges are told apart from each
// other where they stand on the channel.
//
// THE REQUIREMENT. `specs/overview.md` — "The charges": "Each charge is drawn in
// a color that stands apart from the field, from the channel, and from every
// other charge". This point decides the last clause of that sentence: the five
// against each other. Standing apart from the field and the plate is
// `presentation/charges-vs-field`.
//
// WHAT IS READ, AND WHAT IS NOT. `specs/ui.md` — "Presentation": "Volute fixes no
// palette, no font, no layout, and no styling for any screen", so nothing here
// reads a hex value or names a colour. What it reads is the DISTANCE between two
// colours the build chose, which is the whole of what "stands apart" can mean
// when the palette is the build's.
//
// The reading is the mean colour over the disc of radius `CORE_RADIUS - 1`
// centred on each core, rather than one pixel, because `specs/overview.md` has
// every core carry "a glyph of its own" over its face: a single sample lands
// either on the mineral or on the glyph, and the mean over the disc is the
// charge.
//
// THE BOUND. `DISTINCT_MIN`, the case's standing tolerance for "two sampled
// pixels told apart": an RGB distance above 50 on the 0-441 scale. It is a
// distance rather than a fraction because the scale is absolute — 50 out of 441
// is a difference a player sees at a glance, and two charges a build drew in the
// same hue with different shading sit well below it.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_IDS, DISTINCT_MIN, type ChargeId } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleDisc,
  type Harness,
  type Rgb,
} from "../harness";
import { poseFiveCharges } from "./charges";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the five charges in colours that stand apart from each other", async () => {
  await poseFiveCharges(h);
  captureStill(h, "charges");

  const posed = h.snapshot();
  assertEqual(
    posed.train.length,
    CHARGE_IDS.length,
    "the cores one core of each charge put on the channel",
  );

  const sampled: { charge: ChargeId; colour: Rgb }[] = [];
  for (const core of posed.train) {
    sampled.push({
      charge: core.charge,
      colour: sampleDisc(h, core.x, core.y),
    });
  }

  for (let i = 0; i < sampled.length; i += 1) {
    for (let j = i + 1; j < sampled.length; j += 1) {
      assertGreaterThan(
        colorDistance(sampled[i].colour, sampled[j].colour),
        DISTINCT_MIN,
        `the RGB distance between ${sampled[i].charge} and ${sampled[j].charge}`,
      );
    }
  }
});
