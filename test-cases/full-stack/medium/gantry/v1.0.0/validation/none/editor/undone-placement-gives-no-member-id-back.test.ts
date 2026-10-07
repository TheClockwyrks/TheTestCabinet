// editor/undone-placement-gives-no-member-id-back — the id an undone placement
// spent is not handed back to the next one.
//
// `specs/structure.md` § The editor's rules states it outright: "An undone
// placement gives no id back: the next member id climbs with every member placed
// and falls only when the structure is emptied whole
// (`specs/instrumentation.md`), so a member restored by an undo carries the id it
// was placed with and the member placed after it takes a new one."
//
// Two struts are placed, taking ids `0` and `1` ("`addMember` gives the member
// the structure's `nextMemberId` and advances it by one"), the second is undone,
// and a third is placed. The third is the reading: an id counter that fell with
// the undo would give it `1`, and the specification gives it `2`. The site is
// opened and nothing else is posed, because a site opened on a fresh game carries
// an empty structure with `nextMemberId` at `0` and an empty history — the only
// starting point from which the ids below are the ones the specification names.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Three struts, each four units long, on nodes no two of them share. */
const FIRST = { a: [0, 0, 0], b: [0, 4, 0] } as const;
const SECOND = { a: [0, 4, 0], b: [0, 8, 0] } as const;
const THIRD = { a: [2, 0, 0], b: [2, 4, 0] } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives the member placed after an undo a fresh id", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  const opened = await h.snapshot();
  assertEqual(
    opened.structure.nextMemberId,
    0,
    "the id the first member takes on an empty structure " +
      "(specs/instrumentation.md)",
  );

  for (const { a, b } of [FIRST, SECOND]) {
    await h.debug.addMember(a[0], a[1], a[2], b[0], b[1], b[2], "strut");
  }
  const placed = await h.snapshot();
  assertLength(
    placed.structure.members,
    2,
    "the two struts the placements landed (specs/structure.md)",
  );
  assertEqual(
    placed.structure.nextMemberId,
    2,
    "nextMemberId after two placements (specs/instrumentation.md)",
  );

  await h.press(BINDINGS.undo[0]!);
  await h.debug.addMember(
    THIRD.a[0],
    THIRD.a[1],
    THIRD.a[2],
    THIRD.b[0],
    THIRD.b[1],
    THIRD.b[2],
    "strut",
  );

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "ids",
    "The strut placed after the undo, carrying a fresh id",
  );

  assertLength(
    s.structure.members,
    2,
    "the members standing: the first, and the one placed after the undo",
  );
  assertNotNull(
    s.structure.members.find((one) => one.id === 0),
    "the first strut, still carrying the id it was placed with",
  );
  assertNotNull(
    s.structure.members.find((one) => one.id === 2),
    "the strut placed after the undo, carrying an id no undo handed back " +
      "(specs/structure.md)",
  );
  assertEqual(
    s.structure.nextMemberId,
    3,
    "nextMemberId, which climbs with every placement and falls only when the " +
      "structure is emptied whole (specs/structure.md)",
  );
});
