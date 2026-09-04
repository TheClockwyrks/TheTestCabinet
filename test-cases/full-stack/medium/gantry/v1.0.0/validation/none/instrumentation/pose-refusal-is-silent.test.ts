// instrumentation/pose-refusal-is-silent — a pose the game's rules refuse changes
// nothing and reports nothing.
//
// `specs/instrumentation.md` § A deterministic core: "Silent refusal as data. A
// pose the game's own rules refuse leaves the state exactly as it was, so a
// caller reads the outcome of any pose back from `snapshot` rather than from a
// return value." The rule over every operation says what "exactly as it was"
// covers: "The refusal is silent and readable in the snapshot: no member appears,
// no cost is spent, no step joins the tape, and no run begins."
//
// THE REFUSED POSE IS A MEMBER LONGER THAN ITS MATERIAL ALLOWS, which
// `specs/structure.md` refuses outright — "A member placement is refused when …
// its length exceeds its material's maximum" — and which is a refusal rather than
// an invalid argument: both its ends are lattice nodes inside the site's
// envelope, so nothing about the call is outside the domain
// `specs/instrumentation.md` states, and the rule that governs it is the
// editor's.
//
// A MEMBER STANDS BEFORE THE REFUSED ONE IS OFFERED, so every reading afterwards
// is a real figure rather than a zero: the structure carries a member, a cost,
// and one entry of undo history, and each must be exactly what it was. Without it
// a build that emptied the structure on a refusal would still read `0` everywhere
// and pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { STRUT_MAX_LEN } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** A strut the rules accept: two lattice nodes `2` apart, inside site 1. */
const STANDING = { a: [0, 0, 0], b: [0, 2, 0] } as const;

/** A strut of `8` units, past `STRUT_MAX_LEN` (`6`), on lattice nodes inside it. */
const OVERLONG = { a: [2, 0, 0], b: [10, 0, 0] } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the structure exactly as it was, and raises nothing, on a refusal", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.addMember(...STANDING.a, ...STANDING.b, "strut");
  const before = await h.snapshot();

  let raised: string | null = null;
  try {
    await h.debug.addMember(...OVERLONG.a, ...OVERLONG.b, "strut");
  } catch (error) {
    raised = error instanceof Error ? error.message : String(error);
  }
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    before.structure.members.length,
    1,
    "the member standing before the refused edit, which is the scenario this " +
      "point rests on",
  );
  assertNull(
    raised,
    `addMember for a strut of ${STRUT_MAX_LEN + 2} units, which the editor ` +
      "refuses, to raise nothing (specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(after.structure.members),
    JSON.stringify(before.structure.members),
    "the members after a refused placement: no member appears " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.structure.cost,
    before.structure.cost,
    "the cost after a refused placement: no cost is spent " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.structure.nextMemberId,
    before.structure.nextMemberId,
    "the id the next member takes after a refused placement, which advances " +
      "only with a member that lands (specs/instrumentation.md)",
  );
  assertEqual(
    after.historyDepth,
    before.historyDepth,
    "the undo history after a refused placement, which only an edit that " +
      "lands pushes (specs/instrumentation.md)",
  );
});
