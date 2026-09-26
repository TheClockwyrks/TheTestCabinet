// controls/refused-second-click-keeps-the-pending-node — a second click the rules
// refuse leaves the pending node held.
//
// `specs/controls.md` § The build tools: "A second click that the rules refuse
// leaves the pending node held, so a slip does not cost the selection." The rule
// the second click here breaks is the length cap `specs/structure.md` states —
// "A member placement is refused when ... its length exceeds its material's
// maximum" — with `STRUT_MAX_LEN` (`6`).
//
// THE REFUSAL IS THE LENGTH AND NOTHING ELSE. The two nodes are `(0, 0, 0)` and
// `(8, 0, 0)`, `8` apart along one axis: both are on the lattice pitch and inside
// site 1's envelope (`x -8..12`), they are distinct, no member joins them, the
// yard is emptied so no obstacle can reach the segment, no ring stands so the
// arm-to-tower rule has no flange to trip on, and `80` is far inside the site's
// budget of `3000`. So the only rule the placement breaks is the one this
// scenario is built on, and what the reading shows is what a refusal leaves.
//
// BOTH READINGS ARE TAKEN: no member joined the structure, which is what makes
// the click a refused one rather than an accepted one, and the pending node still
// reads the first node, which is the requirement.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { STRUT_MAX_LEN } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The first click's node, and the second's: farther apart than STRUT_MAX_LEN. */
const FIRST: Vec3 = { x: 0, y: 0, z: 0 };
const SECOND: Vec3 = { x: 8, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places no member and keeps the first node held pending", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("strut");

  const first = await h.project(FIRST.x, FIRST.y, FIRST.z);
  const second = await h.project(SECOND.x, SECOND.y, SECOND.z);
  assertTrue(
    first.visible && second.visible,
    "both lattice nodes the clicks are made at are drawn on the stage",
  );

  await h.click(first.x, first.y);
  assertEqual(
    JSON.stringify((await h.snapshot()).pendingNode),
    JSON.stringify(FIRST),
    "the node the first click held pending (specs/controls.md)",
  );

  await h.click(second.x, second.y);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "state",
    "The refused second click with the first node still held",
  );

  assertLength(
    s.structure.members,
    0,
    `the members standing after a second click ${
      SECOND.x - FIRST.x
    } from the pending node, past STRUT_MAX_LEN (${STRUT_MAX_LEN}) ` +
      "(specs/structure.md)",
  );
  assertNotNull(
    s.pendingNode,
    "the pending node after a second click the rules refuse, which leaves it " +
      "held so a slip does not cost the selection (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(FIRST),
    "the node still held pending: the first click's",
  );
});
