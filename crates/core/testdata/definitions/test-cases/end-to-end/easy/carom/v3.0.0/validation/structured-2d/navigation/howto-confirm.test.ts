// Carom — navigation/howto-confirm: Enter on the how-to screen returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes, and only that one:
// the how-to screen is POSED with `setScreen` (`openHowTo`) rather than reached
// by confirming HOW TO PLAY on the title, because that confirm is
// navigation/title-howto's own point to grade. Posing it is also what makes the
// reading below exact — returning to the title sets `menuIndex` to `titleIndex`,
// which a confirm on the title would have moved to the item it confirmed, and
// which `reset` leaves at 0.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. Nothing on the field is posed or removed:
// specs/ui.md advances nothing on the how-to screen and nothing on the title, so
// no ball and no obstacle can move under this transition. The still is the frame
// the press left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openHowTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns from the how-to screen to the title on Enter", async () => {
  await openHowTo(h);
  assertEqual(h.snapshot().screen, "howto");
  assertEqual(h.snapshot().titleIndex, 0);

  await h.tap("Enter");
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, 0);
});
