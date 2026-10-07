// sigils/confluence-any-arrangement — which fount holds which essence does not
// matter.
//
// THE RULE. "When the four founts hold unbonded, unheld motes comprising one of
// each essence, IN ANY ARRANGEMENT, and the crown is vacant, all four are
// consumed and one `aether` appears on the crown, unbonded and unheld"
// (`specs/sigils.md`, `confluence`). The condition is on the multiset the four
// founts hold — one of each of `ESSENCES` — and not on which fount holds which,
// so a permutation of the same four essences over the same four founts is the
// same condition.
//
// THE CONFIGURATION, twice, on one `confluence` anchored on the middle of the
// field at rotation `0`, with the crown vacant both times and nothing else on
// the field.
//
//   * First, `ESSENCES` laid over the founts in the order the footprint tables
//     them: `(1, 0)`, `(0, 1)`, `(-1, 0)`, `(0, -1)`.
//   * Then the same four essences over the same four founts, rotated one place
//     along, so no fount holds the essence it held before. `clearMotes` empties
//     the field between them, leaving the sigil placed, so the two placements
//     differ in the arrangement and in nothing else.
//
// THE VERDICT. Both boundaries consume all four founts and leave one `aether` on
// the crown. The check reads that no fount holds the essence it held in the
// first arrangement before driving the second, so a permutation that quietly was
// not one cannot pass.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNotEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { ESSENCES } from "../constants";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
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

it("fuses the four essences however they are arranged over the founts", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const crown = place(at(0, 0), anchor, rotation);
  const founts = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].map((hex) =>
    place(hex, anchor, rotation),
  );
  // The same four essences, rotated one place along the founts.
  const shifted = ESSENCES.map(
    (_, index) => ESSENCES[(index + 1) % ESSENCES.length],
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("confluence", anchor.q, anchor.r, rotation)]),
  });

  // Arrangement one.
  const first: number[] = [];
  for (const [index, hex] of founts.entries()) {
    first.push(await spawnMote(h, hex, ESSENCES[index]));
  }
  await advanceCycles(h, 1);
  await captureStill(h, "arrangements");

  const once = await h.snapshot();
  assertEqual(
    once.sim?.status,
    "running",
    "a confluence is not a fault: the cycle reached its boundary",
  );
  for (const id of first) {
    assertNull(moteById(once, id), `the essence ${id} was consumed`);
  }
  assertNotNull(moteAt(once, crown), "an aether appears on the crown");
  assertEqual(
    moteAt(once, crown)?.type,
    "aether",
    "the first arrangement leaves an aether on the crown",
  );
  assertEqual(looseMotes(once).length, 1, "four went in and one came out");

  // Arrangement two: the same essences, none on the fount it was on before.
  await h.debug.clearMotes();
  for (const [index] of founts.entries()) {
    assertNotEqual(
      shifted[index],
      ESSENCES[index],
      `fount ${index} holds a different essence than it did`,
    );
  }
  const second: number[] = [];
  for (const [index, hex] of founts.entries()) {
    second.push(await spawnMote(h, hex, shifted[index]));
  }
  await advanceCycles(h, 1);

  const twice = await h.snapshot();
  assertEqual(
    twice.sim?.status,
    "running",
    "the second boundary is not a fault either",
  );
  for (const id of second) {
    assertNull(moteById(twice, id), `the essence ${id} was consumed as well`);
  }
  assertNotNull(
    moteAt(twice, crown),
    "an aether appears on the crown for the second arrangement too",
  );
  assertEqual(
    moteAt(twice, crown)?.type,
    "aether",
    "the rearranged founts fuse exactly as the first arrangement did",
  );
  assertEqual(
    looseMotes(twice).length,
    1,
    "four went in and one came out the second time as well",
  );
});
