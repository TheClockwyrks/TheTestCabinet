// sigils/confluence-requires-unbonded-founts — a fount essence carrying a
// filament blocks the confluence.
//
// THE RULE. "When the four founts hold UNBONDED, unheld motes comprising one of
// each essence, in any arrangement, and the crown is vacant, all four are
// consumed and one `aether` appears on the crown" (`specs/sigils.md`,
// `confluence`), where the term is defined at the top of the same page:
// "unbonded: the mote carries no filament." One bonded fount fails the
// condition, and "A sigil whose condition does not hold at a boundary waits" —
// so NONE of the four is consumed, not merely the bonded one.
//
// THE CONFIGURATION. One `confluence` anchored on the middle of the field at
// rotation `0`, with one of each essence on the four founts, all unheld, and a
// vacant crown. Every condition holds but one.
//
// The bond is a filament from the fount at `(1, 0)` to a `dust` on `(2, 0)`, a
// hex adjacent to that fount and OFF the sigil's five footprint hexes — "A
// filament is a rigid link between two motes on adjacent hexes"
// (`specs/field.md`), so the partner has to be a neighbor, and putting it off
// the footprint keeps it out of every role the sigil reads.
//
// THE VERDICT, read at the boundary of one cycle. Every fount still holds the
// essence it was posed with, by id and by type, the filament still joins the
// bonded one to its partner, the crown is still vacant, and the field still
// holds five motes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { ESSENCES } from "../constants";
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

it("waits while one fount essence carries a filament", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const crown = place(at(0, 0), anchor, rotation);
  const founts = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].map((hex) =>
    place(hex, anchor, rotation),
  );
  // A neighbor of the first fount that is no hex of the footprint.
  const beside = place(at(2, 0), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("confluence", anchor.q, anchor.r, rotation)]),
  });
  const spawned: number[] = [];
  for (const [index, hex] of founts.entries()) {
    spawned.push(await spawnMote(h, hex, ESSENCES[index]));
  }
  const partner = await spawnMote(h, beside, "dust");
  await h.debug.linkMotes(spawned[0], partner, 1);

  const posed = await h.snapshot();
  assertNull(
    moteAt(posed, crown),
    "the crown is vacant, so only the bond fails",
  );
  assertNotNull(
    filamentBetween(posed, spawned[0], partner),
    "the essence on the first fount carries a filament, so it is not unbonded",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "bonded-essence");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  for (const [index, hex] of founts.entries()) {
    assertEqual(
      moteAt(after, hex)?.id,
      spawned[index],
      `the essence on the fount at (${hex.q}, ${hex.r}) was not consumed`,
    );
    assertEqual(
      moteAt(after, hex)?.type,
      ESSENCES[index],
      "and is still the essence it was posed with",
    );
  }
  assertNull(moteAt(after, crown), "nothing appears on the crown");
  assertNotNull(
    filamentBetween(after, spawned[0], partner),
    "the filament that blocked the confluence still joins the pair",
  );
  assertEqual(
    looseMotes(after).length,
    5,
    "five motes went into the boundary and five came out",
  );
});
