// presentation/obstacles-drawn — each obstacle is drawn in the yard as its box.
//
// `specs/ui.md` § Build lists what the build screen shows: "the ground, the
// lattice and envelope aids, the anchors, THE OBSTACLES, …". `specs/world.md`
// fixes an obstacle as an axis-aligned box nothing may reach inside.
//
// WHAT IS ASKED IS PRESENCE, AND NOTHING ELSE. "Palettes, fonts, layouts, and
// styling are the build's choices" — so this asks only that the frame drew the
// thing, which `drawn()` answers by carrying an entry for it: "A thing the frame
// did not draw has no entry, which is how the reading says a mark is absent, an
// aid is hidden, or a model was never placed" (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  addOneObstacle,
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

it("draws the site's obstacles in the yard", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("build");
  await addOneObstacle(h, { x: 4, y: 0, z: 4 }, { x: 2, y: 3, z: 2 });
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("obstacle", "An obstacle drawn in the yard");

  assertTrue(
    entriesOf(drawn, "obstacle", "obstacle").length > 0,
    `an obstacle among what the frame drew (specs/ui.md)`,
  );
});
