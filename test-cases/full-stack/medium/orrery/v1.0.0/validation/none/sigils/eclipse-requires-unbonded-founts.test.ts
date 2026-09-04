// sigils/eclipse-requires-unbonded-founts — a fount `dust` carrying a filament
// blocks the eclipse.
//
// THE RULE. "When both founts hold UNBONDED, unheld `dust` and both crowns are
// vacant, both `dust` are consumed, an `umbra` appears on the umbral crown, and
// a `lumen` appears on the lumen crown" (`specs/sigils.md`, `eclipse`), where
// the term is defined at the top of the same page: "unbonded: the mote carries
// no filament." One bonded fount fails the condition, and "A sigil whose
// condition does not hold at a boundary waits" — so NEITHER `dust` is consumed.
//
// THE CONFIGURATION. One `eclipse` anchored on the middle of the field at
// rotation `0`, with a `dust` on each fount, both unheld, and both crowns
// vacant. Every condition holds but one.
//
// The bond is a filament from the fount at `(0, 0)` to a `dust` on `(-1, 0)`, a
// hex adjacent to that fount and OFF the sigil's four footprint hexes — "A
// filament is a rigid link between two motes on adjacent hexes"
// (`specs/field.md`), so the partner has to be a neighbor, and putting it off
// the footprint keeps it out of every role the sigil reads.
//
// THE VERDICT, read at the boundary of one cycle. Both fount `dust` are still
// where they were and still `dust`, the filament still joins the bonded one to
// its partner, both crowns are still vacant, and the field still holds three
// motes.

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

it("waits while one fount dust carries a filament", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const umbral = place(at(0, 1), anchor, rotation);
  const lumenal = place(at(1, -1), anchor, rotation);
  // A neighbor of the first fount that is no hex of the footprint.
  const beside = place(at(-1, 0), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("eclipse", anchor.q, anchor.r, rotation)]),
  });
  const west = await spawnMote(h, first, "dust");
  const east = await spawnMote(h, second, "dust");
  const partner = await spawnMote(h, beside, "dust");
  await h.debug.linkMotes(west, partner, 1);

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
  assertNotNull(
    filamentBetween(posed, west, partner),
    "the fount dust carries a filament, so it is not unbonded",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "bonded-dust");

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
    "the bonded dust was not consumed",
  );
  assertEqual(moteAt(after, first)?.type, "dust", "and is still dust");
  assertEqual(
    moteAt(after, second)?.id,
    east,
    "the unbonded dust on the other fount was not consumed either",
  );
  assertEqual(moteAt(after, second)?.type, "dust", "and is still dust");
  assertNull(moteAt(after, umbral), "no umbra appears on the umbral crown");
  assertNull(moteAt(after, lumenal), "no lumen appears on the lumen crown");
  assertNotNull(
    filamentBetween(after, west, partner),
    "the filament that blocked the eclipse still joins the pair",
  );
  assertEqual(
    looseMotes(after).length,
    3,
    "three motes went into the boundary and three came out",
  );
});
