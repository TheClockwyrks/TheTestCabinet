// presentation/envelope-extent-visible — the envelope's extent is drawn as an aid on the build screen.
//
// `specs/ui.md` § Build lists what the build screen shows: "the ground, the
// lattice and ENVELOPE AIDS, the anchors, …". `specs/world.md` fixes what the
// envelope is: the box the crane may be built inside.
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

it("draws the envelope aid on the build screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("envelope", "The build screen showing the envelope's extent");

  assertTrue(
    entriesOf(drawn, "aid", "envelope").length > 0,
    `the envelope aid among what the build screen drew (specs/ui.md)`,
  );
});
