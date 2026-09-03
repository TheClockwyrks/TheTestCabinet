// controls/member-pick-tie-lower-id — two members tied under the pointer, and
// the candidate is the one carrying the lower id.
//
// `specs/controls.md` § Clicks and drags: "A member pick considers every
// member's projected segment; the candidate is the nearest at most
// `MEMBER_PICK_PX` (`12`) logical pixels from the click, ties going to the
// member whose nearest point on that segment is nearest the camera, and then to
// the lower member id." This check is about the LAST of those three rules, so
// the scenario has to tie the first two exactly.
//
// A SHARED END NODE TIES BOTH OF THEM, AND TIES THEM EXACTLY. Two members that
// end at the same lattice node, clicked at the point the build says it drew that
// node at, are each at distance zero from the click — the click sits on both
// projected segments, at an end of each. The nearest point of either segment is
// therefore that one shared node, so the two also stand at the same distance
// from the camera, and the only rule left to separate them is the member id.
// Nothing about the build's lens enters into it: the click is read back from the
// build's own `project`, and a tie at zero is a tie under any projection.
//
// THE IDS COME FROM THE ORDER THE MEMBERS ARE PLACED. "`addMember` gives the
// member the structure's `nextMemberId` and advances it by one"
// (`specs/instrumentation.md`), and `clearStructure` returns that counter to `0`,
// so the member placed first carries id `0` and the second id `1`. A build that
// answered a tie with the member it happened to reach last would report `1`.
//
// The second member is deliberately NOT in the plane the first one lies in, so
// the two projected segments meet at the shared node alone and there is no
// stretch of screen where both would read zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The lattice node both members end at, and the point the click is made at. */
const SHARED = { x: 0, y: 4, z: 0 } as const;

/** The far end of the member placed first, which takes id `0`. */
const FIRST_END = { x: 0, y: 0, z: 0 } as const;

/** The far end of the member placed second, which takes id `1`. */
const SECOND_END = { x: 2, y: 0, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers a member tie at equal camera distance with the lower id", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(
    FIRST_END.x,
    FIRST_END.y,
    FIRST_END.z,
    SHARED.x,
    SHARED.y,
    SHARED.z,
    "strut",
  );
  await h.debug.addMember(
    SECOND_END.x,
    SECOND_END.y,
    SECOND_END.z,
    SHARED.x,
    SHARED.y,
    SHARED.z,
    "strut",
  );

  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    2,
    "the two members the scenario places, both accepted (specs/structure.md)",
  );
  assertEqual(
    posed.structure.members[0]?.id,
    0,
    "the id the member placed first carries",
  );
  assertEqual(
    posed.structure.members[1]?.id,
    1,
    "the id the member placed second carries",
  );

  const at = await h.project(SHARED.x, SHARED.y, SHARED.z);
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  await h.capture("state", "the pointer on the node both members end at");

  assertEqual(
    (await h.snapshot()).pick.member,
    0,
    "the member a click on the shared node would take: both segments are the " +
      "same zero distance from the click and their nearest points are the same " +
      "node, so the tie falls to the lower member id (specs/controls.md)",
  );
});
