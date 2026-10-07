// editor/refused-edit-pushes-no-history — a refused edit pushes no undo history.
//
// `specs/structure.md` § The editor's rules: "The editor refuses any edit that
// would break a rule, and **a refused edit changes nothing**", and the undo
// history is one of the things it does not change — `specs/instrumentation.md`
// says so of the poses that stand for those edits: "Each edit that lands pushes
// the undo history exactly as a click would", and a removal with nothing to remove
// "leaves the structure exactly as it stands and pushes no history". So the undo
// after a refusal reaches past it, to the edit before.
//
// One member is placed and the same placement is offered again, which the
// duplicate rule refuses. `historyDepth` is read across the refusal, and then the
// undo is pressed: on a build that pushed an entry for the refusal the undo would
// restore the structure the refusal did not change and leave the member standing,
// and on a build that pushed nothing it reaches the empty structure the site
// opened with. The site is opened and nothing else posed, so the history under
// test holds exactly one entry and the reading has nowhere else to come from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The member placed, and then offered a second time. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the history at the landed edit, so one undo empties the structure", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  assertEqual(
    (await h.snapshot()).historyDepth,
    0,
    "historyDepth on a site opened and not yet edited " +
      "(specs/instrumentation.md)",
  );

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  const landed = await h.snapshot();
  assertLength(
    landed.structure.members,
    1,
    "the member the placement lands (specs/structure.md)",
  );
  assertEqual(
    landed.historyDepth,
    1,
    "historyDepth after one landed edit (specs/instrumentation.md)",
  );

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  const refused = await h.snapshot();
  assertEqual(
    refused.historyDepth,
    1,
    "historyDepth across a refused edit, which changes nothing " +
      "(specs/structure.md)",
  );

  await h.press(BINDINGS.undo[0]!);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("history", "The empty structure the one undo reached");

  assertLength(
    s.structure.members,
    0,
    "the members after the undo: it reaches the landed edit, because the " +
      "refusal pushed nothing (specs/structure.md)",
  );
  assertEqual(
    s.historyDepth,
    0,
    "historyDepth after the undo popped the one entry the history held",
  );
});
