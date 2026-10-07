// sigils/eclipse-crowns-named — the umbra lands on the umbral crown and the
// lumen on the lumen crown, at the sigil's placed pose.
//
// THE RULE. `eclipse`'s table names its two crowns apart — `(0, 1)` umbral
// crown, `(1, -1)` lumen crown — and its sentence sends one polarity to each:
// "an `umbra` appears on the umbral crown, and a `lumen` appears on the lumen
// crown" (`specs/sigils.md`). Where those hexes lie on the field is fixed by the
// pose: "Footprints are written as relative hexes at rotation `0`; a placed
// sigil's hexes are its footprint rotated and translated as `specs/field.md`
// describes" — that is, "rotated about `(0, 0)` by the rotation, then translated
// by the anchor".
//
// THE CONFIGURATION. One `eclipse` anchored on `(1, 1)` at rotation `2`, so that
// neither the anchor nor the rotation is the identity and the two crowns land on
// hexes that the footprint at rotation `0` would not put them on. Each hex the
// check reads is computed by placing the footprint's own relative hex at that
// pose, so what is compared is the specification's geometry against the build's.
// One `dust` rests on each fount and both crowns are left vacant, which is the
// whole of the condition; the field holds nothing else.
//
// THE VERDICT, read at the boundary of one cycle. The mote on the placed umbral
// crown is an `umbra` and the mote on the placed lumen crown is a `lumen`. Read
// as a pair, the two assertions also decide "never the other way round": a build
// that swapped them would put a `lumen` where the check demands an `umbra`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
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

it("puts each polarity on its own crown at the placed pose", async () => {
  // Neither the identity anchor nor the identity rotation, so the crowns cannot
  // be right by accident.
  const anchor = at(1, 1);
  const rotation = 2;
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
  assertNull(moteAt(posed, umbral), "the placed umbral crown is vacant");
  assertNull(moteAt(posed, lumenal), "the placed lumen crown is vacant");

  await advanceCycles(h, 1);
  await captureStill(h, "crowns");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "an eclipse is not a fault: the cycle reached its boundary",
  );
  assertNotNull(
    moteAt(after, umbral),
    "a mote appears on the umbral crown at the placed pose",
  );
  assertEqual(
    moteAt(after, umbral)?.type,
    "umbra",
    "the umbra appears on the umbral crown, the footprint's (0, 1) placed",
  );
  assertNotNull(
    moteAt(after, lumenal),
    "a mote appears on the lumen crown at the placed pose",
  );
  assertEqual(
    moteAt(after, lumenal)?.type,
    "lumen",
    "the lumen appears on the lumen crown, the footprint's (1, -1) placed",
  );
  assertEqual(
    looseMotes(after).length,
    2,
    "the two crowns hold the whole of the field: nothing landed elsewhere",
  );
});
