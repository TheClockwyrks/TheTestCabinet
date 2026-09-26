// instrumentation/overlay-hides — a second backtick press hides the overlay.
//
// specs/instrumentation.md (Diagnostics): the backtick key "shows and hides
// it". This point is the hiding half; `overlay-shows` is the other.
//
// HOW IT IS READ. Hiding must take exactly the panel's contribution away again,
// so over a posed, static field the frame after the second press draws the
// baseline's own count of text and none of the lines the panel added. Reading
// the count alone would pass a build that swapped one panel line for a line of
// its own, so the added lines are named and looked for by name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { frameText, minusLines, pressToggle } from "./overlay";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hides the overlay again on the second press", async () => {
  await isolate(h);
  const before = await frameText(h);

  await pressToggle(h);
  await pressToggle(h);
  const hidden = await frameText(h);
  await captureStill(h, "hidden");

  assertEqual(
    hidden.length,
    before.length,
    "text drawn after the second press",
  );
  assertEqual(
    minusLines(hidden, before).length,
    0,
    "panel lines left after hiding",
  );
});
