// pointer/same-frame-pointer-wins — a pointer selection beats a keyboard
// movement edge on the same frame.
//
// specs/ui.md, "Pointer and touch": the pointer and the touch contacts are read
// once per frame, in the same input read as the keyboard actions, and are
// applied AFTER that frame's keyboard edges — so a frame carrying a keyboard
// movement edge together with a pointer selection leaves `menuIndex` at the item
// the pointer named.
//
// THE POINTER IS DISPATCHED FIRST AND THE KEY SECOND, deliberately. A build that
// applies its input in arrival order rather than in one read would then land on
// the keyboard's item and fail, where dispatching the key first would let it
// pass for the wrong reason.
//
// The reading is unambiguous because the three items are distinct: posed on
// `SOLO`, the down edge alone reaches `VERSUS` and the pointer alone reaches
// `HOW TO PLAY`, so 2 can only mean the pointer was applied last.
//
// The move runs NO frame of its own (`aimPointerAtItem`), and the key is held
// rather than tapped, so the pointer position and the key edge reach the build
// in the one input read the rule is about. Where the item sits is the build's
// own and is never guessed.
//
// Nothing advances on the title (specs/ui.md), so no bystander is posed away and
// no paddle is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  aimPointerAtItem,
  captureStill,
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

it("leaves the selection on the item the pointer named", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(SOLO);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await aimPointerAtItem(h, HOWTO);
  await h.hold("ArrowDown");
  await h.advance(1);
  await h.release("ArrowDown");
  await captureStill(h, "menu");

  const after = await h.snapshot();
  assertEqual(after.screen, "title");
  assertEqual(after.menuIndex, HOWTO);
});
