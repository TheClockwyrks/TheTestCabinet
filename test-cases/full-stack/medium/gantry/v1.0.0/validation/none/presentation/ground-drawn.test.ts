// presentation/ground-drawn — the plane `y = 0` is drawn as the yard floor.
//
// `specs/world.md` § The world frame: "The world is measured in units on a
// right-handed frame: `x` and `z` are horizontal, `y` is up, and THE GROUND IS THE
// PLANE `y = 0`, DRAWN AS THE YARD FLOOR." `specs/ui.md` § Build has the build
// screen show "the ground" among what it draws.
//
// WHAT IS ASKED IS PRESENCE, AND NOTHING ELSE. "Palettes, fonts, layouts, and
// styling are the build's choices" — so this asks only that the frame drew the
// thing, which `drawn()` answers by carrying an entry for it: "A thing the frame
// did not draw has no entry, which is how the reading says a mark is absent, an
// aid is hidden, or a model was never placed" (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ground plane as the yard floor", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("floor", "The yard floor under the site");

  assertTrue(
    entriesOf(drawn, "ground", "ground").length > 0,
    `the yard floor among what the frame drew (specs/world.md)`,
  );
});
