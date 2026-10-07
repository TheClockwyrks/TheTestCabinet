// sigils/conjoin-requires-same-planet — two DIFFERENT planets on the founts are
// left as they are.
//
// THE RULE. "When both founts hold unbonded, unheld motes of the same planet
// below `sol` and the crown is vacant, both are consumed and one mote of the
// next rung appears on the crown" (`specs/sigils.md`, `conjoin`). "The same
// planet" is one of the conditions, and "A sigil whose condition does not hold
// at a boundary waits."
//
// THE CONFIGURATION. One `conjoin` anchored on the middle of the field at
// rotation `0`, its founts on `(0, 0)` and `(1, 0)` and its crown on `(0, 1)`. A
// `saturn` rests on one fount and a `jupiter` on the other: both are planets,
// both are below `sol` in the ladder `PLANETS` fixes (`specs/field.md`), both
// arrive unbonded and unheld from `spawnMote`, and the crown is vacant. So every
// other condition of the rule holds and the pair differs in exactly the one
// thing this point is about. Nothing else is on the field.
//
// THE VERDICT, read at the boundary of one cycle. Neither mote is consumed, each
// is still the type it was and still on the fount it was posed on, the crown is
// still vacant, and the field still holds two motes — so nothing was fused and
// nothing appeared.

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

it("waits on a saturn beside a jupiter", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const crown = place(at(0, 1), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("conjoin", anchor.q, anchor.r, rotation)]),
  });
  const saturn = await spawnMote(h, first, "saturn");
  const jupiter = await spawnMote(h, second, "jupiter");

  const posed = await h.snapshot();
  assertEqual(moteAt(posed, first)?.id, saturn, "the saturn is on one fount");
  assertEqual(
    moteAt(posed, second)?.id,
    jupiter,
    "the jupiter is on the other",
  );
  assertNull(
    moteAt(posed, crown),
    "the crown is vacant, so only the pair differs",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "mismatched");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  assertEqual(
    moteAt(after, first)?.id,
    saturn,
    "the saturn is left where it was, unconsumed",
  );
  assertEqual(
    moteAt(after, first)?.type,
    "saturn",
    "the saturn is left as it was, unrisen",
  );
  assertEqual(
    moteAt(after, second)?.id,
    jupiter,
    "the jupiter is left where it was, unconsumed",
  );
  assertEqual(
    moteAt(after, second)?.type,
    "jupiter",
    "the jupiter is left as it was, unrisen",
  );
  assertNull(moteAt(after, crown), "nothing appears on the crown");
  assertEqual(
    looseMotes(after).length,
    2,
    "the two motes that went into the boundary are the two that came out",
  );
});
