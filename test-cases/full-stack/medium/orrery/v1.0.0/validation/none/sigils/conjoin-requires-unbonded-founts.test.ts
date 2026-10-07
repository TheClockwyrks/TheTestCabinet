// sigils/conjoin-requires-unbonded-founts — a fount mote carrying a filament
// blocks the conjoin.
//
// THE RULE. "When both founts hold UNBONDED, unheld motes of the same planet
// below `sol` and the crown is vacant, both are consumed and one mote of the
// next rung appears on the crown" (`specs/sigils.md`, `conjoin`), where the term
// is defined at the top of the same page: "unbonded: the mote carries no
// filament." One bonded fount is enough to fail the condition, and "A sigil
// whose condition does not hold at a boundary waits" — so NEITHER fount is
// consumed, not merely the bonded one.
//
// THE CONFIGURATION. One `conjoin` anchored on the middle of the field at
// rotation `0`, with a `mars` on each fount: the same planet, below `sol`, both
// unheld, and a vacant crown. Every condition holds but one.
//
// The bond is a filament from the fount at `(0, 0)` to a `dust` on `(-1, 0)`, a
// hex adjacent to that fount and OFF the sigil's footprint — "A filament is a
// rigid link between two motes on adjacent hexes" (`specs/field.md`), so the
// partner has to be a neighbor, and putting it off the footprint keeps it out of
// every role the sigil reads. The `dust` is inert to the one sigil on the field.
//
// THE VERDICT, read at the boundary of one cycle. Both `mars` are still on their
// founts and still `mars`, the filament still joins the bonded one to its
// partner, the crown is still vacant, and the field still holds three motes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
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

it("waits while one fount mote carries a filament", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const crown = place(at(0, 1), anchor, rotation);
  // A neighbor of the first fount that is no hex of the footprint, so the
  // partner takes no role in the sigil.
  const beside = place(at(-1, 0), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("conjoin", anchor.q, anchor.r, rotation)]),
  });
  const west = await spawnMote(h, first, "mars");
  const east = await spawnMote(h, second, "mars");
  const partner = await spawnMote(h, beside, "dust");
  await h.debug.linkMotes(west, partner, 1);

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
  assertNotNull(
    filamentBetween(posed, west, partner),
    "the fount mote carries a filament, so it is not unbonded",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "bonded-fount");

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
    "the bonded mars was not consumed",
  );
  assertEqual(moteAt(after, first)?.type, "mars", "and is still mars");
  assertEqual(
    moteAt(after, second)?.id,
    east,
    "the unbonded mars on the other fount was not consumed either",
  );
  assertEqual(moteAt(after, second)?.type, "mars", "and is still mars");
  assertNull(moteAt(after, crown), "nothing appears on the crown");
  assertNotNull(
    filamentBetween(after, west, partner),
    "the filament that blocked the conjoin still joins the pair",
  );
  assertEqual(
    looseMotes(after).length,
    3,
    "three motes went into the boundary and three came out",
  );
});
