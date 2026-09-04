// states/title-returns-to-the-entry-left-from — the title comes back on the entry
// it was left from.
//
// specs/ui.md, "The remembered title selection": "Returning to `title` from any
// screen sets `menuIndex` to `titleIndex`, so leaving `howto` lands back on `HOW
// TO PLAY`". The screens table says the same from the other side: arriving at
// `howto`, `paused`, `gameover` or `cleared` sets `menuIndex` to `0`, and
// arriving at `title` sets it to `titleIndex`.
//
// This is the READ of the remembered value. The WRITE is
// `states/title-index-records-the-confirmed-entry`, and they are two points
// because a build that records the entry and then still returns to `0` has done
// half the work and left the player re-walking the menu every time.
//
// The route is the one the specification names: confirm `HOW TO PLAY`, then leave
// it with `back`, which specs/ui.md gives as `howto`'s way out.

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

it("returns to the title with the highlight on the entry left from", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(HOWTO_INDEX);
  await h.tap(KEY.confirm);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the entry opened",
  );

  await h.tap(KEY.back);
  await captureStill(h, "returned");

  const returned = await h.snapshot();
  assertEqual(returned.screen, "title", "the screen back returned to");
  assertEqual(
    returned.menuIndex,
    HOWTO_INDEX,
    "the highlighted item the title came back on",
  );
});
