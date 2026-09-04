// Deepcore — rocket/fabrication-refused-without-credits: a thin balance buys
// nothing.
//
// `specs/rocket.md`: the `FABRICATE` action "is enabled only while the Credits
// are affordable and the material is held." `specs/expedition.md` states the
// general rule: "Credits never go negative, and an action that cannot be
// afforded is disabled."
//
// So the balance is posed ONE Credit short of the Guidance Unit's price, with its
// Resonite held, and `FABRICATE` is called. One short rather than empty, because
// the boundary is where an off-by-one build differs from a correct one, and
// because a build that refused only an empty purse would pass anything looser.
//
// Nothing may move: not the checklist, not the satchel, not the balance.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { ROCKET_COMPONENTS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene } from "./pad-scene";

/** The Guidance Unit is the third entry on the checklist. */
const GUIDANCE = ROCKET_COMPONENTS[2];

/** Held, so the only thing missing is the money. */
const HELD = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("installs nothing and deducts nothing one Credit short of the price", async () => {
  await openPadScene(h);
  await h.debug.setRocketInstalled(2);
  await h.debug.setMaterial("resonite", HELD);
  await h.debug.setCredits(GUIDANCE.credits - 1);

  const before = await h.snapshot();
  assertEqual(
    before.rocket.nextComponent,
    GUIDANCE.id,
    "the component the pad offers next",
  );

  await h.debug.fabricate();
  const after = await h.snapshot();

  await h.advance(2);
  await captureStill(h, "short");

  assertDeepEqual(
    after.rocket.installed,
    before.rocket.installed,
    "the checklist after the refused fabrication",
  );
  assertEqual(
    after.credits,
    GUIDANCE.credits - 1,
    "the balance after the refused fabrication",
  );
  assertEqual(
    after.satchel.resonite,
    HELD,
    "Resonite after the refused fabrication",
  );
});
