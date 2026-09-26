// touch/landing-selects — a contact landing on an item selects it.
//
// specs/ui.md: "A touch contact lands inside an item's region, or travels onto
// one" makes `menuIndex` that item's index. A finger never hovers, so the
// landing is the first the build hears of it — which is why a landing selects
// where a mouse would have had to move first, and why this is a point of its
// own beside the click.
//
// The contact is LANDED AND LEFT DOWN. A confirm requires both of its edges inside
// one region, and the lift is the second of them, so a gesture that stops at the
// landing is the one gesture that isolates the selection: what is read back is
// `menuIndex` alone, and `touch/tap-confirms` grades the lift.
//
// The title is reached by `reset`, which puts `menuIndex` at `0` — so the
// selection this reads is one the landing had to move, not one it inherited. The
// contact is a real one dispatched through Chromium's own input pipeline at the
// region the build reports for the item, so a build that lays its menu out any
// way it likes is graded on what it does with the contact and not on where it
// drew the words.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title, so there is no bystander that could move under the gesture, and no
// paddle is taken — a menu is not driven through one.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuRect,
  openTitle,
  rectCenter,
  touchPress,
  type Harness,
} from "../harness";

/** The title entry the contact lands on: not the one `reset` leaves selected. */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the item a touch contact lands on", async () => {
  await openTitle(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, 0);

  const at = rectCenter(await menuRect(h, HOWTO));
  await touchPress(h, at.x, at.y);
  await captureStill(h, "selected");

  assertEqual((await h.snapshot()).menuIndex, HOWTO);
});
