// pointer/click-confirms — a press and a release inside one item confirms it.
//
// specs/ui.md, "Pointer and touch": a pointer pressed and released inside one
// item's region makes `menuIndex` that item's index AND confirms it, and the
// effect is the one the keyboard table gives `confirm` on that screen. On the
// title that entry is `HOW TO PLAY`, whose confirm sets `screen = howto` — so the
// screen the click leaves is the whole reading, and it is a reading the pointer
// alone can produce.
//
// THE SELECTION IS POSED ON A DIFFERENT ITEM. The title opens with the highlight
// on `SOLO`, and the click lands on `HOW TO PLAY`: a build that confirmed the
// standing selection instead of the one under the pointer opens a Solo countdown
// and fails, rather than passing because it happened to confirm something.
//
// Both edges fall inside the one region `menuItemRect` reports, which is what
// specs/ui.md requires of a confirm; the press and the release run a driven frame
// each, so a build that reads its pointer once per frame sees both. Where the item
// sits is the build's own and is never guessed.
//
// Nothing advances on the title or on the how-to screen (specs/ui.md), so no
// bystander is posed away and no paddle is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const SOLO = TITLE_ITEMS.indexOf("SOLO");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms the item a click presses and releases inside", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(SOLO);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await clickItem(h, HOWTO);
  await captureStill(h, "howto");

  assertEqual((await h.snapshot()).screen, "howto");
});
