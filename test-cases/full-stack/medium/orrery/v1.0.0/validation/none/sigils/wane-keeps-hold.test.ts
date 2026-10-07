// sigils/wane-keeps-hold — a gripper holding an essence on a `wane`'s seat is
// still holding the same mote, by id, once it is `dust`.
//
// THE RULE. "An essence mote on the seat becomes `dust`. Its filaments, its
// constellation, and any hold on it are untouched" (`specs/sigils.md`,
// Transmuting sigils). "Any hold on it" is the clause this check decides, and
// `specs/simulation.md` says what a hold is between cycles: "grips persist across
// cycles until dropped". `specs/instrumentation.md` reports one as an entry of
// `sim.grips` naming a part, a spoke and a MOTE — so a hold that survived is the
// same mote id under the same gripper, which is what makes "untouched" readable
// rather than a matter of appearance.
//
// THE CONFIGURATION. An arm at `(0, 0)`, rotation `0`, length `1`, so its one
// gripper stands on `(1, 0)`. A `wane` anchored at `(1, 0)`, so its seat is that
// same hex. A `nova` resting on it, and the gripper given that mote with
// `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`). The arm's tape is empty, so it rests: "a blank
// cell is a rest on every part, a wheel included, and never faults"
// (`specs/simulation.md`). Nothing else is on the field.
//
// THE VERDICT. After one cycle the mote under the gripper is `dust` — so the
// sigil acted — and `sim.grips` still carries exactly one entry for that arm,
// naming spoke `0` and the same mote id, with the mote still resting on the seat.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { neighbor } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

/** Where the arm's one gripper stands at rest, and the wane's seat. */
const SEAT = neighbor(ORIGIN, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("still holds the same mote once the essence under the gripper is dust", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
      sigilPart("wane", SEAT.q, SEAT.r, 0),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const held = await spawnMote(h, SEAT, "nova");
  await takeGrip(h, arm, 0, held);

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "held-wane");

  assertEqual(
    moteById(before, held)?.type,
    "nova",
    "the seat starts holding an essence, which is the condition wane acts on",
  );
  assertEqual(
    heldBy(before, arm, 0),
    held,
    "and the gripper starts holding that mote",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the arm rests on its blank tape, so the cycle reaches its boundary",
  );
  const dimmed = moteById(after, held);
  assertNotNull(dimmed, "the mote that was held is still a mote");
  assertEqual(
    dimmed?.type,
    "dust",
    "a held essence on the seat becomes dust like any other",
  );
  assertEqual(
    `${dimmed?.q},${dimmed?.r}`,
    `${SEAT.q},${SEAT.r}`,
    "and it is still resting on the seat",
  );

  const grips = gripsOf(after, arm);
  assertLength(grips, 1, "the arm still reports exactly one holding gripper");
  assertEqual(grips[0]?.spoke, 0, "on the spoke it was given the hold on");
  assertEqual(
    heldBy(after, arm, 0),
    held,
    "and what it holds is the same mote, by id: the hold is untouched",
  );
});
