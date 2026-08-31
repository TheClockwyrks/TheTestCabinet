// instrumentation/overlay-toggle — one backtick press shows the overlay, the
// next hides it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics): "the
// backtick key (`KeyboardEvent.code` `Backquote`) shows and hides it".
//
// HOW IT IS READ. The overlay reports values as text over the game's frame, so
// showing it must ADD drawn text and hiding it must take exactly that
// contribution away. The scene is a posed, empty, static field: nothing else
// changes between frames, so the frame before the press, the frame after it,
// and the frame after the second press differ only by the panel. Shown is read
// as strictly more text than the baseline; hidden as the baseline's own count
// again, with the panel's added lines gone. Where the panel sits and what it
// says are the panel's own business — `overlay-sources` reads the content.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { frameText, minusLines, pressToggle } from "./overlay";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows on the first press and hides on the second", async () => {
  isolate(h);
  const before = await frameText(h);

  await pressToggle(h);
  const shown = await frameText(h);
  captureStill(h, "shown");
  assertGreaterThan(
    shown.length,
    before.length,
    "text drawn with the overlay shown",
  );

  await pressToggle(h);
  const hidden = await frameText(h);
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
