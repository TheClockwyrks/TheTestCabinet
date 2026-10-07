// screens/howto-back-returns-to-title — `back` leaves the how-to for the title.
//
// THE RULE. "`confirm` and `back` both return to `title`" (`specs/ui.md`,
// `howto`); the how-to row of `specs/controls.md`'s What each screen reads says
// "`confirm` and `back` return to `title`", and the navigation table gives `back`
// as "Leaves the current screen". This point decides `back`; `confirm` is
// `howto-confirm-returns-to-title`'s.
//
// THE POSE. A fresh session and the how-to as arriving at it leaves it. Nothing
// else is posed: away from the editor there is no run for `back` to stop and no
// challenge for it to close, so the press has exactly one thing to do.
//
// THE PRESS IS A REAL ONE, through `Escape`, the key `specs/controls.md` binds
// `back` to, and the frame that delivers it.
//
// THE VERDICT. `screen` is `title` after the press, and it is read against
// `howto` as well so a build that stayed put is reported as staying.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import {
  backAction,
  captureStill,
  createHarness,
  openHowto,
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

it("returns to the title screen on one back press", async () => {
  await openTitle(h);
  await openHowto(h);

  const arrived = await h.snapshot();
  assertEqual(
    arrived.screen,
    "howto",
    "the press under test is made on the how-to",
  );

  const after = await backAction(h);
  await captureStill(h, "title");

  assertNotEqual(
    after.screen,
    "howto",
    "back leaves the how-to rather than being read as nothing on it",
  );
  assertEqual(
    after.screen,
    "title",
    "back on the how-to returns to the title screen",
  );
});
