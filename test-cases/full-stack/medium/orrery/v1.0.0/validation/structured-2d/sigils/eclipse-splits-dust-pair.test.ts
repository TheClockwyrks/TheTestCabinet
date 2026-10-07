// sigils/eclipse-splits-dust-pair — two `dust` on the founts become one `umbra`
// and one `lumen`.
//
// THE RULE. `eclipse`'s table gives its four hexes — `(0, 0)` fount, `(1, 0)`
// fount, `(0, 1)` umbral crown, `(1, -1)` lumen crown — and its sentence fixes
// the whole effect: "When both founts hold unbonded, unheld `dust` and both
// crowns are vacant, both `dust` are consumed, an `umbra` appears on the umbral
// crown, and a `lumen` appears on the lumen crown, each unbonded and unheld"
// (`specs/sigils.md`).
//
// THE CONFIGURATION. One `eclipse` anchored on the middle of the field at
// rotation `0`, and one `dust` on each fount. Both motes arrive through
// `spawnMote`, which "adds one unbonded, unheld mote", which is what the founts
// must hold; the two crowns are left empty, and the opener cleared the field, so
// each is vacant in the sense `specs/sigils.md` defines — "the hex holds neither
// a mote nor a fixture". Nothing else is on the field.
//
// THE VERDICT, read at the boundary of one cycle, where the transmuting wave
// runs (`specs/simulation.md`, The sigil phase). Both `dust` are gone by id, an
// `umbra` and a `lumen` are on the field, each joined to nothing and held by
// nothing, and the field holds exactly two motes — so the pair was consumed
// rather than moved, and nothing further was spawned.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  looseMotes,
  moteAt,
  moteById,
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

it("consumes both dust and leaves an umbra and a lumen", async () => {
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
  const west = await spawnMote(h, first, "dust");
  const east = await spawnMote(h, second, "dust");

  const posed = await h.snapshot();
  assertEqual(moteAt(posed, first)?.id, west, "one dust is on the first fount");
  assertEqual(moteAt(posed, second)?.id, east, "the other is on the second");
  assertNull(moteAt(posed, umbral), "the umbral crown is vacant");
  assertNull(moteAt(posed, lumenal), "the lumen crown is vacant");

  await advanceCycles(h, 1);
  await captureStill(h, "eclipsed");

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live at the boundary");
  assertEqual(
    after.sim?.status,
    "running",
    "an eclipse is not a fault: the cycle reached its boundary",
  );
  assertNull(moteById(after, west), "the first fount's dust was consumed");
  assertNull(moteById(after, east), "the second fount's dust was consumed");

  const umbra = moteAt(after, umbral);
  const lumen = moteAt(after, lumenal);
  assertNotNull(umbra, "a mote appears on the umbral crown");
  assertEqual(umbra?.type, "umbra", "the mote on the umbral crown is an umbra");
  assertNotNull(lumen, "a mote appears on the lumen crown");
  assertEqual(lumen?.type, "lumen", "the mote on the lumen crown is a lumen");
  assertEqual(
    constellationOf(after, umbra?.id ?? -1).length,
    1,
    "the umbra is unbonded: its constellation is itself alone",
  );
  assertEqual(
    constellationOf(after, lumen?.id ?? -1).length,
    1,
    "the lumen is unbonded: its constellation is itself alone",
  );
  assertEqual(
    (after.sim?.grips ?? []).length,
    0,
    "both new motes are unheld: no gripper holds anything at all",
  );
  assertEqual(
    looseMotes(after).length,
    2,
    "two motes went in and two came out, so the dust pair was consumed",
  );
});
