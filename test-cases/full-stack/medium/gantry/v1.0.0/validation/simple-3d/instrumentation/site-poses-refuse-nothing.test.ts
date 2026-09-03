// instrumentation/site-poses-refuse-nothing — posing the site's loads and obstacles
// refuses nothing and moves nothing that is built.
//
// `specs/instrumentation.md` § The site: "Loads and obstacles are the site's, not
// the structure's, so posing them refuses nothing and changes nothing that is built:
// a member standing where an obstacle is posed stays where it is, and the run that
// follows ends as `structure-struck-obstacle` on the tick the collision test reaches
// it. The editor's refusals govern edits to the structure, and posing the site is not
// one of those."
//
// THE OBSTACLE IS PUT OVER A MEMBER THAT IS ALREADY THERE, which is the one
// arrangement where the two rules pull opposite ways: `specs/structure.md` refuses a
// member "whose segment reaches inside an obstacle", so a build that ran the site
// poses through the editor's rules — or that reached back and deleted what the new
// box now contains — would refuse this call or lose the member. The order is what
// makes the case: the member first, the box second.
//
// The box strictly contains the middle of the member's segment on all three axes,
// which is what `specs/world.md` means by reaching inside: "a body meets an obstacle
// when some point of the body lies inside the box, strictly between the box's minimum
// and its maximum on all three axes".
//
// Nothing is advanced. The verdict the run would reach is the collision test's, on a
// tick, and this point is about the pose alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The member the box is then posed over: a leg from an anchor node. */
const A = { x: 0, y: 0, z: 0 } as const;
const B = { x: 0, y: 2, z: 0 } as const;

/** The box, which the leg runs up through the middle of. */
const MIN = { x: -1, y: 0, z: -1 } as const;
const SIZE = { x: 2, y: 3, z: 2 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes an obstacle posed over a standing member, and leaves the member where it is", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  const before = await h.snapshot();

  await h.debug.addObstacle(MIN.x, MIN.y, MIN.z, SIZE.x, SIZE.y, SIZE.z);

  const after = await h.snapshot();
  await h.capture("state", "the obstacle posed over a standing member");

  assertLength(
    before.structure.members,
    1,
    "the member standing before the obstacle was posed over it",
  );
  assertLength(
    after.site.obstacles,
    1,
    "the obstacle the pose appends: posing the site refuses nothing " +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    after.site.obstacles[0],
    { min: MIN, size: SIZE },
    "the box that was posed, over the member's segment",
  );
  assertEqual(
    JSON.stringify(after.structure),
    JSON.stringify(before.structure),
    "the structure across an obstacle posed over it: a member standing where " +
      "an obstacle is posed stays where it is",
  );
});
