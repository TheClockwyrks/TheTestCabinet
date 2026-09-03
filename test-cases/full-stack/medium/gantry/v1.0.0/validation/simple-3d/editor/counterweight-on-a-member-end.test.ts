// editor/counterweight-on-a-member-end — a node a member ends at carries a
// counterweight.
//
// `specs/structure.md` § Counterweights: a counterweight is "placed on any node
// the structure uses, a node a member ends at or a flange node of the ring". This
// check decides the first half of that phrase, as
// `counterweight-on-a-flange-node` decides the second.
//
// SO THE STRUCTURE IS ONE MEMBER AND NOTHING ELSE, and there is no ring: the only
// node the structure uses at `(0, 4, 0)` is the top end of that member, so a
// counterweight landing there landed because a member ends there. One strut from
// the anchor `(0, 0, 0)` straight up is four units, inside `STRUT_MAX_LEN` (`6`),
// costs `40` against site 0's `3000` budget, and both its ends lie inside that
// site's envelope, so nothing refuses it.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The strut's two ends: a ground anchor of site 0, and the node above it. */
const FOOT: Vec3 = { x: 0, y: 0, z: 0 };
const HEAD: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a counterweight on the node a member ends at", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    HEAD.x,
    HEAD.y,
    HEAD.z,
    "strut",
  );
  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    1,
    "the strut the counterweight hangs on (specs/structure.md)",
  );

  await h.debug.addCounterweight(HEAD.x, HEAD.y, HEAD.z);
  await h.advance(1);

  const { structure } = await h.snapshot();
  assertContains(
    structure.counterweights,
    HEAD,
    `the counterweight on (${HEAD.x}, ${HEAD.y}, ${HEAD.z}), the node the ` +
      "strut ends at (specs/structure.md)",
  );
  assertLength(
    structure.counterweights,
    1,
    "the counterweights standing: the one that was placed",
  );

  await h.capture(
    "counterweight-on-a-member-end",
    "A counterweight on the top of a single strut",
  );
});
