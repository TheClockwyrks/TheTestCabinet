// screens/howto-confirm-returns-to-title — `confirm` leaves the how-to for the
// title.
//
// THE RULE. "`confirm` and `back` both return to `title`" (`specs/ui.md`,
// `howto`), and the how-to row of `specs/controls.md`'s What each screen reads
// says the same: "`confirm` and `back` return to `title`". The how-to has no
// menu of its own to take, so the accepting key is a way out of it. This point
// decides `confirm`; `back` is `howto-back-returns-to-title`'s.
//
// THE POSE. A fresh session and the how-to as arriving at it leaves it. Nothing
// else is posed: away from the editor there is no machine, no run and no
// challenge, and the screen the press is made on is the only thing the verdict
// depends on.
//
// THE PRESS IS A REAL ONE, through `Enter`, the key `specs/controls.md` binds
// `confirm` to, and the frame that delivers it.
//
// THE VERDICT. `screen` is `title` after the press, and it is read against
// `howto` as well so a build that stayed put is reported as staying rather than
// as landing somewhere unexpected.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title screen on one confirm press", async () => {
  await openTitle(h);
  await openHowto(h);

  const arrived = await h.snapshot();
  assertEqual(
    arrived.screen,
    "howto",
    "the press under test is made on the how-to",
  );

  const after = await pressAction(h, "confirm");
  await captureStill(h, "title");

  assertNotEqual(
    after.screen,
    "howto",
    "confirm leaves the how-to rather than being read as nothing on it",
  );
  assertEqual(
    after.screen,
    "title",
    "confirm on the how-to returns to the title screen",
  );
});
