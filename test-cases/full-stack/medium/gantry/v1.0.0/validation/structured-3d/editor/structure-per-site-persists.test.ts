// editor/structure-per-site-persists — the structure authored on a site is that
// site's, and it is still there when the site is opened again.
//
// `specs/state.md` § The session: "Per site: the structure and the tape authored
// on it, which persist across visits for the session." § What a site opening does
// says an opening "keeps that site's stored structure and tape", and
// `specs/instrumentation.md` closes the reading: "A site that is not open reports
// the structure and tape stored on it through `structure` and `program` once it
// is opened."
//
// SO THE CHECK MAKES TWO VISITS. A crane is built on site 0, site 1 is opened and
// its structure read, and site 0 is opened again and read once more. The first
// reading is what says the structure is per site — site 1 was never built on, so
// it reports nothing — and the second is what says the authoring survived the
// trip. Both are the one requirement: the structure belongs to the site it was
// authored on.
//
// WHAT IS COMPARED IS THE WHOLE MEMBER, id, ends and material, because that is
// what "the structure authored on it" means: `specs/state.md` § The structure
// being built gives a member as "an id unique for the life of the site's
// structure, its two lattice nodes, and its material", and a build that stored
// only the geometry would come back with the members renumbered.
//
// The three members are the smallest set that carries all three materials past
// the editor's rules: two short struts on site 0's ground anchors and, between
// their heads, one horizontal member — a cable on one pair and a rail on the
// other. There is no ring, so no track rule but horizontality is checked and no
// arm-to-tower path can exist; each member is inside its material's maximum
// length and inside the envelope; the lot costs `68` against a `3000` budget.
// The ids run `0`, `1`, `2` because `clearStructure` "returns `nextMemberId` to
// `0`" and each placement takes the next.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MaterialName,
  type Vec3,
} from "../harness";

/** The crane authored on site 0, in the order that gives each member its id. */
const MEMBERS: readonly (readonly [Vec3, Vec3, MaterialName])[] = [
  [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, "strut"],
  [{ x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, "cable"],
  [{ x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }, "rail"],
];

/** The site built on, and the site visited in between. */
const HOME = 0;
const AWAY = 1;

/** A member's two nodes, in an order that is the same either way round. */
function endsOf(a: Vec3, b: Vec3): string {
  const one = `${a.x},${a.y},${a.z}`;
  const two = `${b.x},${b.y},${b.z}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a site's structure to itself and hands it back on the next visit", async () => {
  await openSite(h, HOME);
  await clearAll(h);
  for (const [a, b, material] of MEMBERS) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, material);
  }
  assertLength(
    (await h.snapshot()).structure.members,
    MEMBERS.length,
    `the members authored on site ${HOME} (specs/structure.md)`,
  );

  await openSite(h, AWAY);
  const away = await h.snapshot();
  assertEqual(away.siteIndex, AWAY, "the site that was opened");
  assertLength(
    away.structure.members,
    0,
    `the members site ${AWAY} reports: nothing was authored on it, and site ` +
      `${HOME}'s crane is not carried onto it (specs/state.md)`,
  );
  assertNull(away.structure.ring, `the ring site ${AWAY} reports`);
  assertLength(
    away.structure.counterweights,
    0,
    `the counterweights site ${AWAY} reports`,
  );

  await openSite(h, HOME);
  await h.advance(1);
  const home = await h.snapshot();
  assertEqual(home.siteIndex, HOME, "the site that was opened again");
  assertLength(
    home.structure.members,
    MEMBERS.length,
    `the members site ${HOME} hands back on the next visit (specs/state.md)`,
  );
  for (const [index, [a, b, material]] of MEMBERS.entries()) {
    const member = home.structure.members.find((one) => one.id === index);
    assertNotNull(member, `the stored member carrying id ${index}`);
    assertEqual(
      member === undefined ? null : endsOf(member.a, member.b),
      endsOf(a, b),
      `the two nodes stored member ${index} runs between`,
    );
    assertEqual(
      member?.material,
      material,
      `stored member ${index}'s material`,
    );
  }

  await h.capture(
    "structure-per-site-persists",
    "Site 1's crane, still standing on the second visit",
  );
});
