// states/title-index-records-the-confirmed-entry — confirming a title entry
// records it.
//
// specs/ui.md, "The remembered title selection": "Confirming an item on the title
// menu sets `titleIndex` to that item's index, from the keyboard, from a pointer,
// and from a touch contact alike." specs/instrumentation.md carries `titleIndex`
// in the snapshot and opens it at `0`, which is what makes the recording
// readable. What the recorded value is USED for is
// `states/title-returns-to-the-entry-left-from`; this point decides only that
// confirming writes it.
//
// `HOW TO PLAY` is the item confirmed, because it is the entry a fresh session
// does NOT open on: a build that never writes `titleIndex` reads back the `0` a
// reset left, so confirming index `1` is what separates the two.
//
// The highlight is posed onto the item through the surface rather than walked to
// with `down`, so a build with a broken down edge fails
// `controls/menu-highlight-moves` alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_INDEX, KEY } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets titleIndex to the index of the item confirmed", async () => {
  const title = await openTitle(h);
  assertEqual(title.screen, "title", "the screen the key is pressed on");
  assertEqual(title.titleIndex, 0, "the remembered selection a reset leaves");

  await h.debug.setMenuIndex(HOWTO_INDEX);
  await h.tap(KEY.confirm);
  await captureStill(h, "remembered");

  const confirmed = await h.snapshot();
  assertEqual(confirmed.screen, "howto", "the screen the entry opened");
  assertEqual(
    confirmed.titleIndex,
    HOWTO_INDEX,
    "the title's remembered selection after the confirm",
  );
});
