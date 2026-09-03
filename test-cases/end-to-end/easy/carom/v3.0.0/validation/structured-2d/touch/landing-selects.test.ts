// Carom — touch/landing-selects: a contact landing on an item selects it.
//
// specs/ui.md: "A touch contact lands inside an item's region, or travels onto
// one" makes `menuIndex` that item's index. A finger never hovers, so the
// landing is the first the build hears of it — which is why a landing selects
// where a mouse would first have had to move, and why this is a point of its own
// beside the pointer's.
//
// The contact is LANDED AND LEFT DOWN. A confirm takes both of its edges inside
// one region, and the lift is the second of them, so a gesture that stops at the
// landing is the one that isolates the selection: what is read back is
// `menuIndex` alone, and `touch/tap-confirms` grades the lift.
//
// It starts from the title, which `reset()` restores with `menuIndex` at 0;
// `openTitle` settles that reset with one advanced frame before the contact
// lands, so the landing cannot be read by a world the reset is leaving. The
// selection this reads is therefore one the landing had to move rather than one
// it inherited. The contact is a `PointerEvent`-shaped event carrying
// `pointerType: "touch"`, dispatched at the target the engine listens on and
// aimed at the region the build reports through `menuItemRect` — everything past
// the dispatch is the engine's own, so what is graded is the build's handling
// and not where it drew the words.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title, so the gesture runs over a world that cannot move under it either way,
// and no paddle is taken — a menu is not driven through one.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuCenter,
  openTitle,
  type Harness,
} from "../harness";

/** The title entry the contact lands on: not the one `reset` leaves selected. */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("selects the item a touch contact lands on", async () => {
  await openTitle(h);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, 0);

  const at = menuCenter(h, HOWTO);
  h.pointerDown(at.x, at.y, { device: "touch" });
  await h.advance(1);
  captureStill(h, "selected");

  assertEqual(h.snapshot().menuIndex, HOWTO);
});
