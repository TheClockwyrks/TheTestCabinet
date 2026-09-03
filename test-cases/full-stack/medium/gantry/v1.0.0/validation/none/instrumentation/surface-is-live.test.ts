// instrumentation/surface-is-live — the surface is the game's own, not a stub
// beside it.
//
// specs/instrumentation.md § The operations, of the whole surface: "Every
// scenario driven from code reaches the game through it, so it is present and
// exactly as specified here", and of a pose: "A pose arranges the yard through
// the same systems play uses." A surface answering out of a shadow copy would
// satisfy every shape check in this suite and grade nothing, because every other
// validator's scenario would be posed somewhere the game never looks.
//
// One pose decides it, read back three ways that the game itself derives rather
// than stores. `setRing(0, 2, 0)` "places the slew ring by its base corner at that
// lattice node", and on an emptied structure the only refusals left are the
// envelope and the budget (specs/structure.md), so it lands. What then has to
// move with it:
//
//   - `structure.ring`, the pose read straight back;
//   - `structure.cost`, which is "derived from the rules in
//     `specs/structure.md`" — a crane of nothing but a ring costs `RING_COST`;
//   - the `check` reading, which "reports exactly what the `check` action
//     reports" and is "computed on the spot", so `no-ring` — "the crane has no
//     slew ring" — is no longer among its issues.
//
// The last is the one a stub cannot fake: the check is the game's own readiness
// pass over the structure the game holds.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { RING_COST } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The ring's base corner: `y` is not `0`, since it sits on a tower. */
const CORNER = { x: 0, y: 2, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands a posed ring in the state the game holds, and every reading reports it", async () => {
  await openSite(h, 0);
  await clearAll(h);

  const before = await h.check();
  assertContains(
    before.issues,
    "no-ring",
    "the readiness issue an emptied structure carries (specs/structure.md)",
  );

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  const s = await h.snapshot();
  assertDeepEqual(
    s.structure.ring,
    { corner: CORNER },
    "the ring the pose placed, read back from the game's own state",
  );
  assertEqual(
    s.structure.cost,
    RING_COST,
    "the cost of a crane that is nothing but a ring (specs/structure.md)",
  );

  const after = await h.check();
  assertTrue(
    !after.issues.includes("no-ring"),
    "the `no-ring` issue, gone from a check computed over the posed ring " +
      "(specs/structure.md)",
  );

  await h.advance(1);
  await h.capture("ring-posed", "The ring the pose put in the game's own state");
});
