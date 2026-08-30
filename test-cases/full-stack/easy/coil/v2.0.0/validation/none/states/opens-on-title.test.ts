// states/opens-on-title — a freshly loaded game is on the title, on its first
// menu item.
//
// specs/ui.md: "the game opens on `title`", and "Arriving at any of these screens
// sets `menuIndex` to `0`." Both are read off the game as it stands the moment it
// has initialized, before a key is pressed and before anything is posed.
//
// It is read from a SECOND LOAD of the same build rather than through the harness
// this suite opened with, because a harness resets the game before it hands the
// page over and specs/instrumentation.md has a reset restore the title screen and
// a `menuIndex` of `0` whatever the build did at load. Reading it after one would
// decide the reset rather than the load, and a build that opened on its own
// how-to screen would pass. `session.ts` explains the second page in full.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openFreshSession } from "./session";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("loads onto the title screen with the first item highlighted", async () => {
  const fresh = await openFreshSession(h);
  try {
    await captureStill({ ...h, page: fresh.page }, "title");
    assertEqual(
      fresh.snapshot.screen,
      "title",
      "the screen a freshly loaded game is on",
    );
    assertEqual(
      fresh.snapshot.menuIndex,
      0,
      "the highlighted item of the title menu",
    );
  } finally {
    await fresh.page.close().catch(() => undefined);
  }
});
