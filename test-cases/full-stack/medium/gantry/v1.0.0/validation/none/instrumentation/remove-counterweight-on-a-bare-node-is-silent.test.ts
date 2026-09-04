// instrumentation/remove-counterweight-on-a-bare-node-is-silent —
// `removeCounterweight` on a node carrying none is a silent refusal.
//
// `specs/instrumentation.md` § The structure: "A removal with nothing to remove is
// a refusal rather than an invalid argument, so it is silent: `clearRing` on a
// crane carrying no ring and `removeCounterweight` on a lattice node carrying none
// both leave the structure exactly as it stands and push no history." Three things
// follow, and all three are this one requirement: the call does not fail loudly the
// way an argument outside its domain does, the structure is untouched, and the undo
// history is not pushed.
//
// THE NODE IS A LATTICE NODE. The same file makes a coordinate that is not a
// multiple of `LATTICE_PITCH` an invalid argument that fails loudly, so a check on
// the SILENT path has to name a node that is perfectly well-formed and simply bare
// — `(4, 4, 4)` here, which nothing this check builds reaches.
//
// One member and one counterweight, on an emptied world: the counterweight that
// stands is what makes "leaves the structure exactly as it stands" readable, and a
// larger crane would only add nodes for the removal to have found.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the structure and the history alone when the node carries no counterweight", async () => {
  await openSite(h, 0);
  // The world this point concerns is the structure alone, so the structure is the
  // only thing emptied: `clearStructure` "empties the open site's structure" and
  // is refused by nothing, and the site's own loads and obstacles cannot carry a
  // counterweight or reach the undo history.
  await h.debug.clearStructure();
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  // A node the structure uses, so the placement is accepted (specs/structure.md).
  await h.debug.addCounterweight(0, 2, 0);

  const before = await h.snapshot();

  // The refusal itself: a well-formed lattice node the structure does not carry a
  // counterweight on. It must not raise.
  await h.debug.removeCounterweight(4, 4, 4);

  const after = await h.snapshot();
  await h.capture("state", "the crane a bare-node removal left untouched");

  assertLength(
    before.structure.counterweights,
    1,
    "the counterweight standing before the refused removal",
  );
  assertEqual(
    JSON.stringify(after.structure),
    JSON.stringify(before.structure),
    "the structure across a removeCounterweight on a bare node " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.historyDepth,
    before.historyDepth,
    "historyDepth across a removal with nothing to remove: it pushes no history",
  );
});
