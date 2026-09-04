// sigils/confluence-requires-one-of-each — four essences that are not one of
// each are left as they are.
//
// THE RULE. "When the four founts hold unbonded, unheld motes comprising ONE OF
// EACH essence, in any arrangement, and the crown is vacant, all four are
// consumed and one `aether` appears on the crown" (`specs/sigils.md`,
// `confluence`). Four essences that double one and omit another are not one of
// each, and "A sigil whose condition does not hold at a boundary waits."
//
// THE CONFIGURATION. One `confluence` anchored on the middle of the field at
// rotation `0`, with an essence on every fount, all unbonded and unheld, and a
// vacant crown. Every condition holds but the composition: the fount that would
// have held the last of `ESSENCES` holds a second copy of the third instead —
// two `nova` and no `meteor` — so four essences are present and four founts are
// filled while the set is short one. The essences are read off `ESSENCES` rather
// than written down. Nothing else is on the field.
//
// THE VERDICT, read at the boundary of one cycle. Every fount still holds the
// mote it was posed with, by id and by type, the crown is still vacant, and the
// field still holds four motes — so no `aether` was made and nothing was
// consumed.

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

it("waits on four essences that double one and omit another", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const crown = place(at(0, 0), anchor, rotation);
  const founts = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].map((hex) =>
    place(hex, anchor, rotation),
  );
  // One of each, with the last essence replaced by a second copy of the third:
  // two nova and no meteor.
  const doubled = ESSENCES.map((essence, index) =>
    index === ESSENCES.length - 1 ? ESSENCES[ESSENCES.length - 2] : essence,
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("confluence", anchor.q, anchor.r, rotation)]),
  });
  const spawned: number[] = [];
  for (const [index, hex] of founts.entries()) {
    spawned.push(await spawnMote(h, hex, doubled[index]));
  }

  const posed = await h.snapshot();
  assertEqual(
    doubled.filter((type) => type === "nova").length,
    2,
    "two founts hold nova",
  );
  assertEqual(
    doubled.filter((type) => type === "meteor").length,
    0,
    "and no fount holds meteor, so the four are not one of each",
  );
  assertNull(
    moteAt(posed, crown),
    "the crown is vacant, so only the set fails",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "duplicate");

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
      `the mote on the fount at (${hex.q}, ${hex.r}) was not consumed`,
    );
    assertEqual(
      moteAt(after, hex)?.type,
      doubled[index],
      `and is still the essence it was posed with`,
    );
  }
  assertNull(moteAt(after, crown), "nothing appears on the crown");
  assertEqual(
    looseMotes(after).length,
    4,
    "four motes went into the boundary and four came out",
  );
});
