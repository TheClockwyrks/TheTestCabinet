// Deepcore — rocket/components-build-in-order: the checklist offers one component
// at a time, in its stated order.
//
// `specs/rocket.md`: "The Launch Pad panel shows the rocket as a checklist of
// five components, built in order. Each becomes available once the one before it
// is installed", and its table fixes that order — Hull Frame, Fuel Cells,
// Guidance Unit, Thruster Assembly, Ignition Core.
//
// So the pad is read at every installed count from none to all five. At each one
// the component offered next must be the next entry in that order, and the list
// of installed components must be exactly the entries before it; at five there is
// nothing left to offer and `nextComponent` is `null`. Reading the installed list
// alongside is what makes this the ORDER rather than just the next name: a build
// that installed the right count in the wrong sequence fails.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENT_IDS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene } from "./pad-scene";

/** The count the still is taken at: part way along the checklist. */
const PART_WAY = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("offers the next component in the order specs/rocket.md states", async () => {
  openPadScene(h);

  for (let count = 0; count <= ROCKET_COMPONENT_IDS.length; count += 1) {
    h.debug.setRocketInstalled(count);
    const { rocket } = h.snapshot();

    assertDeepEqual(
      rocket.installed,
      ROCKET_COMPONENT_IDS.slice(0, count),
      `the checklist with ${count} installed`,
    );
    assertEqual(
      rocket.nextComponent,
      count < ROCKET_COMPONENT_IDS.length ? ROCKET_COMPONENT_IDS[count] : null,
      `the component offered with ${count} installed`,
    );
  }

  h.debug.setRocketInstalled(PART_WAY);
  await h.advance(2);
  captureStill(h, "checklist");
});
