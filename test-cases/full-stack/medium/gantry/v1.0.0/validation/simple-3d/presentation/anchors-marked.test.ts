// presentation/anchors-marked — the site's anchor points are marked in the yard.
//
// `specs/overview.md` § Visual design: "Anchor points, each load's starting
// position, and each pad's footprint and required yaw ARE MARKED so a site is
// readable before anything is built." `specs/ui.md` § Build has the build screen
// show "the anchors" among what it draws.
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

it("marks the site's anchor points in the yard", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("anchors", "The anchors marked in the yard");

  assertTrue(
    entriesOf(drawn, "mark", "anchor").length > 0,
    `an anchor mark among what the frame drew (specs/overview.md)`,
  );
});
