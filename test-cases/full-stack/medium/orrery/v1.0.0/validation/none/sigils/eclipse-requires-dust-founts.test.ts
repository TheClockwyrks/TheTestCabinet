// sigils/eclipse-requires-dust-founts — a fount holding anything but `dust`
// leaves both founts as they are.
//
// THE RULE. "When both founts hold unbonded, unheld `dust` and both crowns are
// vacant, both `dust` are consumed, an `umbra` appears on the umbral crown, and
// a `lumen` appears on the lumen crown" (`specs/sigils.md`, `eclipse`). The type
// is part of the condition, and "A sigil whose condition does not hold at a
// boundary waits" — so a single wrong fount leaves the OTHER fount's `dust`
// alone as well.
//
// THE CONFIGURATION. One `eclipse` anchored on the middle of the field at
// rotation `0`. A `dust` rests on the fount at `(0, 0)` and a `nebula` on the
// fount at `(1, 0)`. Both arrive unbonded and unheld from `spawnMote` and both
// crowns are left vacant, so every other condition of the rule holds and the
// pair differs from a firing one in exactly the one type. The field holds
// nothing else, and no sigil that would transmute the `nebula` is placed.
//
// THE VERDICT, read at the boundary of one cycle. Both motes are still on their
// founts and still the types they were, both crowns are still vacant, and the
// field still holds two motes — so no `dust` was consumed and no polarity was
// spawned.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("waits while one fount holds something other than dust", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const umbral = place(at(0, 1), anchor, rotation);
  const lumenal = place(at(1, -1), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("eclipse", anchor.q, anchor.r, rotation)]),
  });
  const speck = await spawnMote(h, first, "dust");
  const other = await spawnMote(h, second, "nebula");

  const posed = await h.snapshot();
  assertEqual(moteAt(posed, first)?.type, "dust", "one fount holds dust");
  assertEqual(
    moteAt(posed, second)?.type,
    "nebula",
    "the other holds a nebula, which is not dust",
  );
  assertNull(moteAt(posed, umbral), "the umbral crown is vacant");
  assertNull(moteAt(posed, lumenal), "the lumen crown is vacant");

  await advanceCycles(h, 1);
  await captureStill(h, "wrong-founts");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  assertEqual(moteAt(after, first)?.id, speck, "the dust was not consumed");
  assertEqual(moteAt(after, first)?.type, "dust", "and is still dust");
  assertEqual(moteAt(after, second)?.id, other, "the nebula was not consumed");
  assertEqual(moteAt(after, second)?.type, "nebula", "and is still a nebula");
  assertNull(moteAt(after, umbral), "no umbra appears on the umbral crown");
  assertNull(moteAt(after, lumenal), "no lumen appears on the lumen crown");
  assertEqual(
    looseMotes(after).length,
    2,
    "the two motes that went into the boundary are the two that came out",
  );
});
