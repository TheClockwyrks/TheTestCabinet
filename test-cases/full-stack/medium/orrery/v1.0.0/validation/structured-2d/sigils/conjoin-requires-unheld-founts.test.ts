// sigils/conjoin-requires-unheld-founts — a fount mote a gripper holds blocks
// the conjoin.
//
// THE RULE. "When both founts hold unbonded, UNHELD motes of the same planet
// below `sol` and the crown is vacant, both are consumed and one mote of the
// next rung appears on the crown" (`specs/sigils.md`, `conjoin`), where the term
// is defined at the top of the same page: "unheld: no gripper holds any mote of
// the mote's constellation." One held fount is enough to fail the condition, and
// "A sigil whose condition does not hold at a boundary waits" — so NEITHER fount
// is consumed, not merely the held one.
//
// THE CONFIGURATION. One `conjoin` anchored on the middle of the field at
// rotation `0`, with a `mars` on each fount: the same planet, below `sol`, both
// unbonded, and a vacant crown. Every condition holds but one.
//
// The hold is posed rather than taken. An `arm` sits on `(-1, 0)` at rotation
// `0` and length `1`, so its one gripper is on `base + length * DIRS[0]` =
// `(0, 0)` (`specs/parts.md`), the first fount; `setGrip` is the gate
// `specs/instrumentation.md` names, "which takes hold with no `grab` ever
// running", so no cycle of tape has moved the arm or the mote. Its tape is
// empty, "which every part rests on", so the arm holds still for the cycle and
// carries the mote nowhere.
//
// THE VERDICT, read at the boundary of one cycle. Both `mars` are still on their
// founts and still `mars`, the gripper still holds the one it took, the crown is
// still vacant, and the field still holds two motes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { at, place } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  heldBy,
  looseMotes,
  moteAt,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("waits while a gripper holds one fount mote", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const crown = place(at(0, 1), anchor, rotation);
  // An arm whose one gripper reaches the first fount and whose anchor is off
  // every hex the sigil reads.
  const base = place(at(-1, 0), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("conjoin", anchor.q, anchor.r, rotation),
      armPart("arm", base.q, base.r, 0, 1, []),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;
  const west = await spawnMote(h, first, "mars");
  const east = await spawnMote(h, second, "mars");
  await takeGrip(h, arm, 0, west);

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, first)?.type,
    "mars",
    "one mars is on the first fount",
  );
  assertEqual(
    moteAt(posed, second)?.type,
    "mars",
    "the other mars is on the second fount",
  );
  assertNull(moteAt(posed, crown), "the crown is vacant");
  assertEqual(
    heldBy(posed, arm, 0),
    west,
    "the gripper over the first fount holds that fount's mote",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "held-fount");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  assertEqual(moteAt(after, first)?.id, west, "the held mars was not consumed");
  assertEqual(moteAt(after, first)?.type, "mars", "and is still mars");
  assertEqual(
    moteAt(after, second)?.id,
    east,
    "the unheld mars on the other fount was not consumed either",
  );
  assertEqual(moteAt(after, second)?.type, "mars", "and is still mars");
  assertNull(moteAt(after, crown), "nothing appears on the crown");
  assertEqual(
    heldBy(after, arm, 0),
    west,
    "the hold that blocked the conjoin persists across the boundary",
  );
  assertEqual(
    looseMotes(after).length,
    2,
    "the two motes that went into the boundary are the two that came out",
  );
});
