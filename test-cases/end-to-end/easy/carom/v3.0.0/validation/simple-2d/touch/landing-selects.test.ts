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
// The title is reached by `openTitle`, whose `reset` puts `menuIndex` at `0`, so
// the selection this reads is one the landing had to move rather than one it
// inherited. The contact is a `PointerEvent`-shaped event carrying
// `pointerType: "touch"`, dispatched at the target the runtime listens on and
// aimed at the region the build reports through `menuItemRect` — so a build that
// lays its menu out any way it likes is graded on what it does with the contact,
// not on where it drew the words.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` (specs/ui.md) and the reading is of neither a ball nor an obstacle, so
// there is no bystander to remove. No paddle is taken: a menu is not driven
// through one.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuItemCenter,
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
  openTitle(h);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, 0);

  const at = menuItemCenter(h, HOWTO);
  await h.pressPointer(at.x, at.y, { device: "touch" });
  captureStill(h, "selected");

  assertEqual(h.snapshot().menuIndex, HOWTO);
});
