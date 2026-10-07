// sigils/confluence-requires-every-fount — an empty fount blocks the confluence.
//
// THE RULE. "When THE FOUR FOUNTS HOLD unbonded, unheld motes comprising one of
// each essence, in any arrangement, and the crown is vacant, all four are
// consumed and one `aether` appears on the crown" (`specs/sigils.md`,
// `confluence`). Three motes over four founts are not four founts holding motes,
// and "A sigil whose condition does not hold at a boundary waits" — so the three
// essences that ARE there are left as they are rather than partly consumed.
//
// THE CONFIGURATION. One `confluence` anchored on the middle of the field at
// rotation `0`. Three of the four founts hold the first three of `ESSENCES`,
// each unbonded and unheld, and the fourth fount holds nothing at all. The crown
// is vacant, so every other condition of the rule holds and the world is one
// mote short of a fusing one. Nothing else is on the field, so nothing off the
// footprint could stand in for the missing essence.
//
// THE VERDICT, read at the boundary of one cycle. All three essences are still
// on their founts and still their types, the empty fount is still empty, the
// crown is still vacant, and the field still holds three motes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
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

it("waits while one fount holds no mote", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const crown = place(at(0, 0), anchor, rotation);
  const founts = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].map((hex) =>
    place(hex, anchor, rotation),
  );
  const empty = founts[founts.length - 1];

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("confluence", anchor.q, anchor.r, rotation)]),
  });
  const spawned: number[] = [];
  for (let index = 0; index < founts.length - 1; index += 1) {
    spawned.push(await spawnMote(h, founts[index], ESSENCES[index]));
  }

  const posed = await h.snapshot();
  assertNull(moteAt(posed, empty), "the fourth fount holds no mote");
  assertNull(
    moteAt(posed, crown),
    "the crown is vacant, so only the fount fails",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "empty-fount");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  for (let index = 0; index < spawned.length; index += 1) {
    const hex = founts[index];
    assertEqual(
      moteAt(after, hex)?.id,
      spawned[index],
      `the essence on the fount at (${hex.q}, ${hex.r}) was not consumed`,
    );
    assertEqual(
      moteAt(after, hex)?.type,
      ESSENCES[index],
      `and is still the essence it was posed with`,
    );
  }
  assertNull(moteAt(after, empty), "the empty fount is still empty");
  assertNull(moteAt(after, crown), "nothing appears on the crown");
  assertEqual(
    looseMotes(after).length,
    3,
    "three motes went into the boundary and three came out",
  );
});
