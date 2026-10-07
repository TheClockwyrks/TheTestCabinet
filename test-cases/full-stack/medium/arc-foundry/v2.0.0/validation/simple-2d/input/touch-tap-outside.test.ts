// input/touch-tap-outside — a contact lifting outside every entry takes none.
//
// THE REQUIREMENT. `specs/ui.md`: "An entry is taken only when both edges of the
// gesture fall inside one entry's region ... an edge outside every region takes
// none." A finger slid off the menu entirely is the touch screen's way of putting a
// choice back, and it owes the player the same nothing as sliding onto a neighbour.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. A contact lands at the
// centre of a reported rectangle, travels to a point the build reported no
// rectangle over — searched for over the stage rather than named here — and lifts
// there. The screen is read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  controlCenter,
  createHarness,
  type Harness,
  openMenu,
  pointOutside,
  touchDrag,
} from "../harness";

/** The entry the contact lands in. */
const LANDED = "map-switchyard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes no entry when the lift falls outside every entry", async () => {
  h.debug.reset();
  const entries = openMenu(h, "mapselect");
  const landed = entries.find((entry) => entry.action === LANDED)!;

  await touchDrag(h, controlCenter(landed), pointOutside(entries));
  captureStill(h, "outside");

  assertEqual(
    h.snapshot().screen,
    "mapselect",
    `landing a contact inside the reported \`${LANDED}\` rectangle and lifting ` +
      "outside every reported rectangle to take no entry, so the map select is " +
      "still showing (specs/ui.md)",
  );
});
