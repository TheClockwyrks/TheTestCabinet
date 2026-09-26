// Deepcore — rocket/guidance-consumes-resonite: the Guidance Unit eats a
// Resonite.
//
// `specs/rocket.md` gives the Guidance Unit a material of "one Resonite"
// alongside its Credits, and says fabricating "deducts the Credits and consumes
// the material from the satchel."
//
// The two components before it are posed installed so the Guidance Unit is what
// the pad offers, TWO Resonite are posed in the satchel, and the pad's own
// `FABRICATE` is called. The satchel must come back holding exactly one: two
// rather than one so the reading distinguishes "took one" from "emptied the
// satchel", which are different rules and only one of them is stated.
//
// The Cryenite count is posed and read too: the component consumes its own
// material and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { ROCKET_COMPONENTS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene } from "./pad-scene";

/** The Guidance Unit is the third entry on the checklist. */
const GUIDANCE = ROCKET_COMPONENTS[2];

/** Two of each, so "took one" and "emptied the satchel" read differently. */
const HELD = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes one Resonite when the Guidance Unit is fabricated", async () => {
  await openPadScene(h);
  await h.debug.setRocketInstalled(2);
  await h.debug.setCredits(GUIDANCE.credits);
  await h.debug.setMaterial("resonite", HELD);
  await h.debug.setMaterial("cryenite", HELD);

  const before = await h.snapshot();
  assertEqual(
    before.rocket.nextComponent,
    GUIDANCE.id,
    "the component the pad offers next",
  );

  await h.debug.fabricate();
  const after = await h.snapshot();

  await h.advance(2);
  await captureStill(h, "guidance");

  assertContains(
    after.rocket.installed,
    GUIDANCE.id,
    "the checklist after the fabrication",
  );
  assertEqual(after.satchel.resonite, HELD - 1, "Resonite left in the satchel");
  assertEqual(after.satchel.cryenite, HELD, "Cryenite left in the satchel");
});
