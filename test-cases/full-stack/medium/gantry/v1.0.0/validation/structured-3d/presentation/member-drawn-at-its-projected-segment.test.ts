// presentation/member-drawn-at-its-projected-segment — a placed member is drawn
// along the span between the two nodes it joins.
//
// `specs/structure.md` places a member "between the two lattice nodes", and
// `specs/ui.md` § Build has the build screen show "the structure as built" — so
// the bar a player sees is the one they placed, between the nodes they placed it
// between, and not somewhere else on the lattice.
//
// THE READING IS THE EXTENT THE FRAME REPORTS COVERING. `drawn()` gives a
// member's world position and the extent it was drawn at
// (`specs/instrumentation.md`), so the check compares them against the nodes the
// snapshot says the member joins: the drawing sits at the midpoint of the two,
// and covers the span between them.
//
// THE TOLERANCE IS THE BAR'S OWN THICKNESS. `size` is what was drawn rather than
// the bare span, and a bar is drawn with a cross-section, so a quarter of a unit
// is generous against any profile a build picks and far short of the two-unit
// lattice pitch that would put it on the wrong nodes.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** The span the member is placed over. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 4, z: 0 };

/** How far the drawing may sit from the span, in units. */
const TOLERANCE = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a member along the span between the nodes it joins", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.debug.setRing(4, 2, 0);
  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  await h.advance(1);

  const members = entriesOf(await h.drawn(), "member", "strut");

  await h.capture("member", "The member drawn between its two nodes");

  assertTrue(members.length > 0, "a strut among what the frame drew");
  const drawn = members[0]!;
  assertCloseTo(drawn.x, (A.x + B.x) / 2, TOLERANCE, "the member's drawn x");
  assertCloseTo(drawn.y, (A.y + B.y) / 2, TOLERANCE, "the member's drawn y");
  assertCloseTo(drawn.z, (A.z + B.z) / 2, TOLERANCE, "the member's drawn z");
  assertCloseTo(
    drawn.size[1],
    Math.abs(B.y - A.y),
    TOLERANCE,
    "the member's drawn height against the span it joins (specs/structure.md)",
  );
});
