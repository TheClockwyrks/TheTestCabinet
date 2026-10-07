// instrumentation/open-site-empties-the-history — opening a site leaves nothing
// to undo.
//
// `specs/state.md` § What a site opening does: opening a site "empties the undo
// history", and `specs/instrumentation.md` § The run and the screens binds
// `openSite` to it — it "carries the effects `specs/state.md` states for opening a
// site". `specs/structure.md` fixes what the history holds: "undo restores the
// structure to what it was before the most recent structure-changing edit, as far
// back as the site was opened", and § Snapshot shape reports its depth as
// `historyDepth`, "edits the open site can still undo".
//
// So the scenario is a site with edits behind it, left and returned to. Four
// members are placed on site `0` — each "pushes the undo history exactly as a click
// would" — and the history is read on the site opened next, and again on site `0`
// when it is opened a second time. Both readings decide the one requirement in the
// one direction, and each catches a different way of not meeting it: a build that
// kept a single history for the session reports those four edits on site `1`, and a
// build that stored the history per site and handed it back on the return reports
// them on site `0`. Opening site `0` again also brings its stored structure back
// (`specs/state.md`: opening a site "keeps that site's stored structure and tape"),
// so the second reading is taken over the very edits that pushed the history.
//
// The four members are placed on an emptied yard and nothing else stands: they are
// only there to push history, so the site's authored load and any obstacle are
// cleared first rather than left to refuse a placement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Four legs from the ground anchors, each one structure-changing edit. */
const MEMBERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 0, 2],
  [2, 0, 2],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the undo history when a site is opened", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const [x, y, z] of MEMBERS) {
    await h.debug.addMember(x, y, z, x, y + 2, z, "strut");
  }
  const edited = await h.snapshot();
  assertEqual(
    edited.structure.members.length,
    MEMBERS.length,
    "the members placed on site 1, which is the scenario this point rests on",
  );
  assertGreaterThan(
    edited.historyDepth,
    0,
    "the history those edits pushed, which is what an opening must empty",
  );

  await h.debug.openSite(1);
  assertEqual(
    (await h.snapshot()).historyDepth,
    0,
    "historyDepth on the site opened next (specs/state.md)",
  );

  await h.debug.openSite(0);
  const returned = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    returned.historyDepth,
    0,
    "historyDepth on site 1 opened a second time, its edits restored with it " +
      "but nothing left to undo (specs/state.md)",
  );
});
