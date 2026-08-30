// hud/satchel-readout — the bar shows which materials are held.
//
// `specs/ui.md`: the status bar shows the materials satchel, reading which of
// Resonite and Cryenite is held, so the rocket's requirements can be checked at a
// glance. `specs/rocket.md` is why it matters: two components consume a material
// that has to be in the satchel before `FABRICATE` will run.
//
// Which of the two is held is a two-bit reading, and how a build draws it — an
// icon lit, a count, a name greyed out — is the build's. So the three states a
// player has to tell apart are posed and the band is read for each, and each pair
// of them must be drawn differently. The control is the same state read twice,
// which comes back identical because every read is a frame of no length.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the satchel differently for neither, one and both", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtCamp(h);

  const held = async (
    resonite: number,
    cryenite: number,
  ): Promise<number[]> => {
    await h.debug.setMaterial("resonite", resonite);
    await h.debug.setMaterial("cryenite", cryenite);
    return sampleBar(h);
  };

  const neither = await held(0, 0);
  const neitherAgain = await held(0, 0);
  const one = await held(1, 0);
  const both = await held(1, 1);
  await captureStill(h, "satchel");

  assertEqual(changed(neither, neitherAgain), 0, "specs/ui.md");
  assertGreaterThan(changed(neither, one), 0, "specs/ui.md");
  assertGreaterThan(changed(one, both), 0, "specs/ui.md");
  assertGreaterThan(changed(neither, both), 0, "specs/ui.md");
});
