// screens/opens-on-title — the game is on the `title` screen when it is ready to
// be played, before anything has asked it for another one.
//
// `specs/screens.md`: "The game is on exactly one of four screens at a time, and
// it opens on `title`." That is the first thing a player meets, and a build that
// opened straight onto a table, or onto its how-to page, has none of the entry
// the specification describes — which is why the item is capped at `broken`.
//
// THE READING IS TAKEN BEFORE ANY RESET, which is the whole of what makes this
// item decide anything. `specs/instrumentation.md` has `reset` restore `screen`
// to `"title"` as well, so a reading taken after the harness's opening reset
// would report `title` off a build that opened on its table and reset correctly —
// a false pass on the most severely capped item in this group. So the reading is
// `Harness.openingScreen`: the state the build stood the game up in, read once
// before anything reset it, and with the clock already stopped, so what is read
// is the screen the build chose for itself.
//
// Nothing is posed and nothing is cleared, for the same reason. The requirement
// is the state the build hands over, so touching it before the reading would be
// measuring the harness. That `reset` ALSO returns to the title is
// `instrumentation/reset-restores-title`: two requirements, two items, and a
// build that has broken one of them is now graded for exactly that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  failSurface,
  type Harness,
} from "../harness";

/** One frame, so the canvas carries the screen the assertion read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("is on the title screen when it is handed over", async () => {
  // A build with no usable surface reported no opening state either, so the
  // fault is named rather than read as a build that opened on nothing.
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const opened = h.openingScreen;

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "title");

  assertEqual(
    opened,
    "title",
    "the screen the game opened on, read before any reset (specs/screens.md)",
  );
});
