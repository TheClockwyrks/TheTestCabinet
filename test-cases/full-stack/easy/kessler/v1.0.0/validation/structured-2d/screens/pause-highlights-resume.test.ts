// screens/pause-highlights-resume — every entry into the pause menu lands on
// RESUME.
//
// specs/screens.md, "What is highlighted on arrival": its table gives `paused`,
// "on every entry into it", entry `0`, RESUME. "Every entry" is what this point
// reads: the pause menu is opened, its highlight moved off RESUME, resumed, and
// opened again — and the second arrival must be back on RESUME however far the
// highlight had moved the first time.
//
// THE PAUSE IS A REAL PRESS, because the arrival rule is about a transition and
// `setScreen` sets the screen and nothing else. The displaced highlight is POSED
// rather than walked there with the `down` key, so a build whose only fault is
// its `down` key fails that key's own point and not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  openHarness,
  startFreshSession,
  tap,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds to `pause`. */
const PAUSE = BINDINGS.pause[0];

/** The last entry of the pause menu: where the highlight is displaced to. */
const LAST_ENTRY = PAUSE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights RESUME however far the highlight had moved before", async () => {
  startFreshSession(h);

  await tap(h, PAUSE);
  h.debug.setMenuIndex(LAST_ENTRY);
  const displaced = h.snapshot();
  assertEqual(displaced.screen, "paused", "the pause menu, opened");
  assertEqual(
    displaced.menu.index,
    LAST_ENTRY,
    "the displaced highlight, before the menu is left",
  );

  // `pause` on `paused` does exactly what RESUME does (specs/screens.md).
  await tap(h, PAUSE);
  assertEqual(h.snapshot().screen, "playing", "the resumed session");

  await tap(h, PAUSE);
  await h.frameDraw();
  captureStill(h, "paused");

  const after = h.snapshot();
  assertEqual(after.screen, "paused", "the pause menu, entered again");
  assertEqual(after.menu.index, 0, "the highlight on arrival: RESUME");
});
