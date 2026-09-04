// sigils/conjoin-requires-below-sol — two `sol` on the founts are left as they
// are.
//
// THE RULE. "When both founts hold unbonded, unheld motes of the same planet
// below `sol` ... both are consumed and one mote of the next rung appears on the
// crown" (`specs/sigils.md`, `conjoin`). `sol` is not below `sol`, and there is
// no rung above it: `PLANETS` holds "`saturn`, `jupiter`, `mars`, `venus`,
// `luna`, `sol` in that order ... `sol`, which is the top rung"
// (`specs/field.md`). So the condition fails, and "A sigil whose condition does
// not hold at a boundary waits."
//
// THE CONFIGURATION. One `conjoin` anchored on the middle of the field at
// rotation `0`. A `sol` rests on each fount, so the pair is of the SAME planet
// and every other condition holds — both arrive unbonded and unheld from
// `spawnMote`, and the crown at `(0, 1)` is vacant. The one thing that fails is
// the rung: the check reads `sol` off the last entry of `PLANETS` rather than
// writing it down, so what it poses is whatever the specification's top rung is.
// Nothing else is on the field.
//
// THE VERDICT, read at the boundary of one cycle. Neither `sol` is consumed,
// both are still `sol`, the crown is still vacant, and the field still holds
// two motes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { PLANETS } from "../constants";
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

it("waits on two motes of the top rung", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const crown = place(at(0, 1), anchor, rotation);
  // The top rung, read off the ladder specs/field.md fixes.
  const top = PLANETS[PLANETS.length - 1];

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("conjoin", anchor.q, anchor.r, rotation)]),
  });
  const west = await spawnMote(h, first, top);
  const east = await spawnMote(h, second, top);

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, first)?.type,
    "sol",
    "one sol is on the first fount",
  );
  assertEqual(
    moteAt(posed, second)?.type,
    "sol",
    "the other sol is on the second fount, so the pair is of one planet",
  );
  assertNull(
    moteAt(posed, crown),
    "the crown is vacant, so only the rung fails",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "sol-founts");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  assertEqual(
    moteAt(after, first)?.id,
    west,
    "the sol on the first fount is left where it was",
  );
  assertEqual(moteAt(after, first)?.type, "sol", "and is still sol");
  assertEqual(
    moteAt(after, second)?.id,
    east,
    "the sol on the second fount is left where it was",
  );
  assertEqual(moteAt(after, second)?.type, "sol", "and is still sol");
  assertNull(moteAt(after, crown), "nothing appears on the crown");
  assertEqual(
    looseMotes(after).length,
    2,
    "the two motes that went into the boundary are the two that came out",
  );
});
