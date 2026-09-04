// Deepcore — rocket/fabrication-refused-without-the-material: Credits alone do
// not buy a component that needs a material.
//
// `specs/rocket.md`: the `FABRICATE` action "is enabled only while the Credits
// are affordable and the material is held", and "Two components need Credits
// alone. Two consume an exotic material that must be held in the satchel."
//
// So the balance is posed far above the Guidance Unit's price with an EMPTY
// satchel, and `FABRICATE` is called. Ample Credits are the point: the only thing
// missing is the Resonite, so a build that installed the component here has read
// the price and ignored the material.
//
// Nothing may move: not the checklist, and not the balance.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENTS } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene } from "./pad-scene";

/** The Guidance Unit is the third entry on the checklist. */
const GUIDANCE = ROCKET_COMPONENTS[2];

/** Far above the price, so want of Credits cannot be what refuses it. */
const BALANCE = 50_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("installs nothing on ample Credits with the material not held", async () => {
  openPadScene(h);
  h.debug.setRocketInstalled(2);
  h.debug.setMaterial("resonite", 0);
  h.debug.setMaterial("cryenite", 0);
  h.debug.setCredits(BALANCE);

  const before = h.snapshot();
  assertEqual(
    before.rocket.nextComponent,
    GUIDANCE.id,
    "the component the pad offers next",
  );
  assertEqual(before.satchel.resonite, 0, "Resonite held before the attempt");

  h.debug.fabricate();
  const after = h.snapshot();

  await h.advance(2);
  captureStill(h, "missing");

  assertDeepEqual(
    after.rocket.installed,
    before.rocket.installed,
    "the checklist after the refused fabrication",
  );
  assertEqual(
    after.credits,
    BALANCE,
    "the balance after the refused fabrication",
  );
});
