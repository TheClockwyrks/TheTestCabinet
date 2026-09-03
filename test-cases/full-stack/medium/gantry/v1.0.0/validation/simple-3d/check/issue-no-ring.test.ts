// check/issue-no-ring — a crane with no slew ring raises `no-ring`.
//
// specs/structure.md § Readiness: "`no-ring` — The crane has no slew ring", and
// the table's opening sentence says each issue is "reported wherever readiness
// is reported", which for the static check is the `issues` list
// specs/instrumentation.md fixes.
//
// The scenario is a structure that carries members and no ring: three struts
// standing on site 1's anchors, each with a member path to an anchor so nothing
// is disconnected. It is the smallest structure that isolates the missing ring —
// the crane is otherwise unremarkable, and the reading is about the part that is
// absent.
//
// `poseCrane` places no ring for a design whose `ring` is null, so the structure
// reaches the check having never had one.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/**
 * Two legs off two of site 1's ground anchors and the beam between their tops:
 * every member reaches an anchor, and no ring stands anywhere.
 */
const NO_RING: CraneDesign = {
  site: 0,
  name: "Ringless",
  ring: null,
  counterweights: [],
  members: [
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 2, 0], [2, 2, 0], "strut"],
  ],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no-ring for a structure that carries members and no slew ring", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, NO_RING);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "a structure of struts carrying no slew ring");

  assertContains(
    issues,
    "no-ring",
    "the issue a crane with no slew ring raises (specs/structure.md " +
      "§ Readiness)",
  );
});
