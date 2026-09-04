// sigils/eclipse-requires-unheld-founts — a fount `dust` a gripper holds blocks
// the eclipse.
//
// THE RULE. "When both founts hold unbonded, UNHELD `dust` and both crowns are
// vacant, both `dust` are consumed, an `umbra` appears on the umbral crown, and
// a `lumen` appears on the lumen crown" (`specs/sigils.md`, `eclipse`), where
// the term is defined at the top of the same page: "unheld: no gripper holds any
// mote of the mote's constellation." One held fount fails the condition, and "A
// sigil whose condition does not hold at a boundary waits" — so NEITHER `dust`
// is consumed.
//
// THE CONFIGURATION. One `eclipse` anchored on the middle of the field at
// rotation `0`, with a `dust` on each fount, both unbonded, and both crowns
// vacant. Every condition holds but one.
//
// The hold is posed rather than taken. An `arm` sits on `(-1, 0)` at rotation
// `0` and length `1`, so its one gripper is on `base + length * DIRS[0]` =
// `(0, 0)` (`specs/parts.md`), the first fount; `setGrip` is the gate
// `specs/instrumentation.md` names, "which takes hold with no `grab` ever
// running". The arm's tape is empty, "which every part rests on", so it holds
// still for the cycle and carries the `dust` nowhere.
//
// THE VERDICT, read at the boundary of one cycle. Both fount `dust` are still
// where they were and still `dust`, the gripper still holds the one it took,
// both crowns are still vacant, and the field still holds two motes.

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

it("waits while a gripper holds one fount dust", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const umbral = place(at(0, 1), anchor, rotation);
  const lumenal = place(at(1, -1), anchor, rotation);
  // An arm whose one gripper reaches the first fount and whose anchor is off
  // every hex the sigil reads.
  const base = place(at(-1, 0), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("eclipse", anchor.q, anchor.r, rotation),
      armPart("arm", base.q, base.r, 0, 1, []),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;
  const west = await spawnMote(h, first, "dust");
  const east = await spawnMote(h, second, "dust");
  await takeGrip(h, arm, 0, west);

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, first)?.type,
    "dust",
    "one dust is on the first fount",
  );
  assertEqual(
    moteAt(posed, second)?.type,
    "dust",
    "the other is on the second",
  );
  assertNull(moteAt(posed, umbral), "the umbral crown is vacant");
  assertNull(moteAt(posed, lumenal), "the lumen crown is vacant");
  assertEqual(
    heldBy(posed, arm, 0),
    west,
    "the gripper over the first fount holds that fount's dust",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "held-dust");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  assertEqual(moteAt(after, first)?.id, west, "the held dust was not consumed");
  assertEqual(moteAt(after, first)?.type, "dust", "and is still dust");
  assertEqual(
    moteAt(after, second)?.id,
    east,
    "the unheld dust on the other fount was not consumed either",
  );
  assertEqual(moteAt(after, second)?.type, "dust", "and is still dust");
  assertNull(moteAt(after, umbral), "no umbra appears on the umbral crown");
  assertNull(moteAt(after, lumenal), "no lumen appears on the lumen crown");
  assertEqual(
    heldBy(after, arm, 0),
    west,
    "the hold that blocked the eclipse persists across the boundary",
  );
  assertEqual(
    looseMotes(after).length,
    2,
    "the two motes that went into the boundary are the two that came out",
  );
});
