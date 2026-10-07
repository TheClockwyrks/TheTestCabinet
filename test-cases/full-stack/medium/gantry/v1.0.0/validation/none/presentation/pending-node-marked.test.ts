// presentation/pending-node-marked — a held first node is visibly marked.
//
// `specs/structure.md` has a member placed by two clicks, the first of which
// holds a node pending. `specs/ui.md` § Build asks that the held node be visible,
// so a player can see what the second click will join to.
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

it("marks the node a first click is holding", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.debug.setPendingNode(2, 0, 0);
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("pending", "The pending first node, marked");

  assertTrue(
    entriesOf(drawn, "mark", "pending-node").length > 0,
    `a pending-node mark among what the frame drew (specs/ui.md)`,
  );
});
