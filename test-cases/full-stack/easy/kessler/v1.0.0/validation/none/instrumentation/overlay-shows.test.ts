// instrumentation/overlay-shows — the backtick key shows the overlay.
//
// specs/instrumentation.md (Diagnostics): the debug overlay "draws the
// registered sources, the backtick key (`KeyboardEvent.code` `Backquote`) shows
// and hides it". This point is the showing half; `overlay-hides` is the other.
//
// HOW IT IS READ. The overlay reports values as text over the game's frame, so
// showing it must ADD drawn text. The scene is a posed, empty, static field:
// nothing else changes between the frame before the press and the frame after
// it, so the difference is the panel. Where the panel sits and what it says are
// its own business — `overlay-sources` reads the content.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { frameText, pressToggle } from "./overlay";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the overlay on the first press", async () => {
  await isolate(h);
  const before = await frameText(h);

  await pressToggle(h);
  const shown = await frameText(h);
  await captureStill(h, "shown");

  assertGreaterThan(
    shown.length,
    before.length,
    "text drawn with the overlay shown",
  );
});
