// presentation/lattice-aids-visible — the buildable lattice is drawn as an aid on the build screen.
//
// `specs/ui.md` § Build lists what the build screen shows: "`build` shows the yard
// through the camera: the ground, THE LATTICE and envelope aids, the anchors, the
// obstacles, the loads at their starting poses, the pads, and the structure as
// built."
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

it("draws the lattice aid on the build screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("lattice", "The build screen showing the lattice aid");

  assertTrue(
    entriesOf(drawn, "aid", "lattice").length > 0,
    `the lattice aid among what the build screen drew (specs/ui.md)`,
  );
});
