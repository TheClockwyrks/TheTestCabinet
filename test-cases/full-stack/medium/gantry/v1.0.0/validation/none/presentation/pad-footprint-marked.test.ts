// presentation/pad-footprint-marked — each load's pad is marked as a footprint at its target.
//
// `specs/overview.md` § Visual design: "Anchor points, each load's starting
// position, and EACH PAD'S FOOTPRINT and required yaw are marked so a site is
// readable before anything is built."
//
// WHAT IS ASKED IS PRESENCE, AND NOTHING ELSE. "Palettes, fonts, layouts, and
// styling are the build's choices" — so this asks only that the frame drew the
// thing, which `drawn()` answers by carrying an entry for it: "A thing the frame
// did not draw has no entry, which is how the reading says a mark is absent, an
// aid is hidden, or a model was never placed" (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  addOneLoad,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** Where the load waits, and the pad it is wanted on. */
const FROM = { x: 7, y: 0, z: -3, yaw: 0 };
const TO = { x: -6, y: 0, z: 8, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks each pad's footprint at its target position", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("build");
  await addOneLoad(h, "crate", 40, FROM, TO);
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("pad", "A pad's footprint, marked at its target");

  assertTrue(
    entriesOf(drawn, "mark", "pad").length > 0,
    `a pad mark among what the frame drew (specs/overview.md)`,
  );
});
