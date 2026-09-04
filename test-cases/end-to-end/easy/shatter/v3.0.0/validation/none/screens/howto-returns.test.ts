// Shatter — screens/howto-returns: leaving the how-to screen returns to the title.
//
// THE RULE. `specs/ui.md`, on `howto`: "Confirming leaves the screen as leaving it
// does, and both return to `title`".
// `specs/controls.md` binds `Escape` to "Leave the screen" on any screen that is not
// live play, and reads it as a press edge, "once per press".
//
// THE SCREEN IS POSED, THE LEAVING IS DRIVEN. `setScreen("howto")` is the direct route
// to the screen this item leaves — how the screen is REACHED is
// `screens/howto-reachable`'s requirement — and the leave itself has to be a real key,
// since `specs/instrumentation.md` carries no operation for it and posing the title
// would answer the question for the build.
//
// WHY THE HOW-TO AND NOT SOME OTHER SCREEN. `Escape` carries two meanings, and the
// screen decides which applies: it PAUSES live play and LEAVES anything else. A build
// that resolved the key against the wrong screen would pause a screen that cannot be
// paused, or leave a game that should have been paused; this item takes the second
// meaning on the screen `specs/ui.md` gives a return, and `controls/pause-escape` takes
// the first.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `Escape` is the key that leaves a screen
// (`controls/back-escape`), what the how-to draws
// (`screens/howto-shows-the-controls`), or where the title's own entries lead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_BACK } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { SETTLE_TICKS, reachHowto } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when the how-to screen is left", async () => {
  await reachHowto(h);

  await h.tap(KEY_BACK);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen leaving the how-to returned to (specs/ui.md)",
  );
});
