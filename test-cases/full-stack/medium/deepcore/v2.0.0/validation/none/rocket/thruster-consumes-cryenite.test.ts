// Deepcore — rocket/thruster-consumes-cryenite: the Thruster Assembly eats a
// Cryenite.
//
// `specs/rocket.md` gives the Thruster Assembly a material of "one Cryenite"
// alongside its Credits, and says fabricating "deducts the Credits and consumes
// the material from the satchel."
//
// The three components before it are posed installed so the Thruster Assembly is
// what the pad offers, TWO Cryenite are posed in the satchel, and the pad's own
// `FABRICATE` is called. The satchel must come back holding exactly one: two
// rather than one so the reading distinguishes "took one" from "emptied the
// satchel". The Resonite count is posed and read too, because the component
// consumes its own material and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { ROCKET_COMPONENTS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene } from "./pad-scene";

/** The Thruster Assembly is the fourth entry on the checklist. */
const THRUSTER = ROCKET_COMPONENTS[3];

/** Two of each, so "took one" and "emptied the satchel" read differently. */
const HELD = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes one Cryenite when the Thruster Assembly is fabricated", async () => {
  await openPadScene(h);
  await h.debug.setRocketInstalled(3);
  await h.debug.setCredits(THRUSTER.credits);
  await h.debug.setMaterial("resonite", HELD);
  await h.debug.setMaterial("cryenite", HELD);

  const before = await h.snapshot();
  assertEqual(
    before.rocket.nextComponent,
    THRUSTER.id,
    "the component the pad offers next",
  );

  await h.debug.fabricate();
  const after = await h.snapshot();

  await h.advance(2);
  await captureStill(h, "thruster");

  assertContains(
    after.rocket.installed,
    THRUSTER.id,
    "the checklist after the fabrication",
  );
  assertEqual(after.satchel.cryenite, HELD - 1, "Cryenite left in the satchel");
  assertEqual(after.satchel.resonite, HELD, "Resonite left in the satchel");
});
