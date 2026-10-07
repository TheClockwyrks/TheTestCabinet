// input/pointer-press-across-entries — a press and a release in two entries take
// neither.
//
// THE REQUIREMENT. `specs/ui.md`: "An entry is taken only when both edges of the
// gesture fall inside one entry's region: the press and the release for a pointer,
// the landing and the lift for a touch contact. Two edges in different regions take
// no entry." It is what lets a player who pressed the wrong entry slide off it
// rather than commit, and it is the negative half of the rule
// `pointer-activates-menu` decides the positive half of.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. The pointer is pressed
// at the centre of one reported rectangle and released at the centre of another,
// and the screen is read back: a build that took either choice has left the map
// select. Both rectangles are the build's own, so nothing here assumes a layout.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  controlCenter,
  createHarness,
  type Harness,
  menuControl,
  openMenu,
  pointerDrag,
} from "../harness";

/** The entry the press lands in, and the one the release lifts in. */
const PRESSED = "map-switchyard";
const RELEASED = "map-transformer";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes no entry when the press and the release fall in different entries", async () => {
  h.debug.reset();
  openMenu(h, "mapselect");

  const from = controlCenter(menuControl(h, PRESSED));
  const to = controlCenter(menuControl(h, RELEASED));
  await pointerDrag(h, from, to);
  captureStill(h, "across");

  assertEqual(
    h.snapshot().screen,
    "mapselect",
    `pressing inside the reported \`${PRESSED}\` rectangle and releasing inside ` +
      `the reported \`${RELEASED}\` one to take neither, so the map select is ` +
      "still showing (specs/ui.md)",
  );
});
