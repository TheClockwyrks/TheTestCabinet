// editor/rail-track-rules-beyond-horizontality-not-enforced-at-placement — the
// editor takes a horizontal rail that breaks one of the other track rules.
//
// `specs/structure.md` § The trolley and the rail lists four track rules and then
// says exactly which of them the editor enforces: "The first rule is enforced the
// moment a rail member is placed; the rest are checked whenever the structure is
// readied, under Readiness below." The first rule is horizontality; collinearity,
// overlap and gaps, being in the arm, and the distinct end radii are the rest.
// `specs/structure.md` § The editor's rules says the same thing from the refusal
// side: the only rail clause among the member refusals is "it is a rail member
// and is not horizontal".
//
// SO THE SCENARIO BREAKS ONE OF THE REST AND NOTHING ELSE. Two rails, each
// horizontal, each four units long and inside `RAIL_MAX_LEN` (`6`), run outward
// from two top-flange nodes of the ring: `(0, 6, 0) → (4, 6, 0)` and
// `(0, 6, 2) → (4, 6, 2)`. They are parallel and two units apart, so they are not
// collinear — the second rule — while each of them satisfies the first on its
// own. Both are in the arm, so neither trips the arm-to-tower refusal.
//
// WHAT IS ASSERTED IS ONLY THAT THE EDITOR TOOK THEM. Whether the readiness check
// then raises `invalid-rail` is the readiness check's own point; a validator that
// asserted both would grade two requirements at once, and a build that placed the
// rails correctly and reported readiness wrongly must fail only the second.
//
// The world is emptied first, so the two rails and the ring are the whole
// structure and no earlier member can be the reason for a refusal. The ring's base
// corner is at `y = 4` rather than `0`, as the ring rule requires; all eight of
// its nodes and both rail tips lie inside site 0's envelope; and `RING_COST`
// (`300`) plus two rails at `4 * RAIL_COST_PER_UNIT` comes to `444` against a
// budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

/** The ring's base corner: off the ground, as the ring rule requires. */
const CORNER: Vec3 = { x: 0, y: 4, z: 0 };

/** Two horizontal rails on top-flange nodes, parallel and so not collinear. */
const RAILS: readonly (readonly [Vec3, Vec3])[] = [
  [
    { x: 0, y: 6, z: 0 },
    { x: 4, y: 6, z: 0 },
  ],
  [
    { x: 0, y: 6, z: 2 },
    { x: 4, y: 6, z: 2 },
  ],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a horizontal rail that breaks a track rule the editor does not check", async () => {
  await openSite(h, 0);
  // The precondition is an empty structure and nothing else. A site opened
  // after a reset already carries one (specs/state.md), and `clearStructure`
  // states it rather than leaving it implied; emptying the yard and the tape
  // too would drive surface this requirement does not concern.
  await h.debug.clearStructure();

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  assertNotNull(
    (await h.snapshot()).structure.ring,
    "the ring whose top flange the rails run from",
  );

  for (const [a, b] of RAILS) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "rail");
  }
  await h.advance(1);

  const { structure } = await h.snapshot();
  await h.capture(
    "rail-track-rules-beyond-horizontality-not-enforced-at-placement",
    "Two parallel horizontal rails the editor accepted",
  );

  assertLength(
    structure.members,
    RAILS.length,
    "the rails the editor took: each horizontal, and the pair not collinear, " +
      "which the editor does not check (specs/structure.md)",
  );
  for (const [index, [a, b]] of RAILS.entries()) {
    const placed = structure.members.find((one) => one.id === index);
    assertNotNull(
      placed,
      `the rail carrying id ${index}, from (${a.x}, ${a.y}, ${a.z}) to ` +
        `(${b.x}, ${b.y}, ${b.z})`,
    );
    assertEqual(placed?.material, "rail", `member ${index}'s material`);
  }
});
