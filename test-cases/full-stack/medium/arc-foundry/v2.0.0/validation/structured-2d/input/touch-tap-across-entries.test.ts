// input/touch-tap-across-entries — a contact landing and lifting in two entries
// takes neither.
//
// THE REQUIREMENT. `specs/ui.md`: "An entry is taken only when both edges of the
// gesture fall inside one entry's region: the press and the release for a pointer,
// the landing and the lift for a touch contact. Two edges in different regions take
// no entry." On a touch screen it is the only way to change your mind once a finger
// is down, so a build that commits on the landing has no way to be let go of.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. A contact lands at the
// centre of one reported rectangle, travels to the centre of another, and lifts
// there. The screen is read back: a build that took either choice has left the map
// select.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  controlCenter,
  createHarness,
  type Harness,
  menuControl,
  openMenu,
  touchDrag,
} from "../harness";

/** The entry the contact lands in, and the one it lifts in. */
const LANDED = "map-switchyard";
const LIFTED = "map-transformer";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes no entry when the landing and the lift fall in different entries", async () => {
  h.debug.reset();
  openMenu(h, "mapselect");

  const from = controlCenter(menuControl(h, LANDED));
  const to = controlCenter(menuControl(h, LIFTED));
  await touchDrag(h, from, to);
  captureStill(h, "across");

  assertEqual(
    h.snapshot().screen,
    "mapselect",
    `landing a contact inside the reported \`${LANDED}\` rectangle and lifting ` +
      `inside the reported \`${LIFTED}\` one to take neither, so the map select ` +
      "is still showing (specs/ui.md)",
  );
});
