// instrumentation/new-mote-id-is-the-last-entry — a spawned mote arrives as the
// last entry of `sim.motes`, and that entry's `id` is the id the other operations
// name it by.
//
// THE RULE, closing the run group of `specs/instrumentation.md`: "A new mote's
// `id` is the `id` of the last entry of `sim.motes` in the next snapshot." That is
// the whole of a mote's identity: `spawnMote` "adds one unbonded, unheld mote of
// `type` ... resting on `(q, r)` with a fresh `id`" and answers nothing, so the
// only way a caller learns which mote it just made is by reading the end of the
// list.
//
// THE POSE IS TWO MOTES AND ONE ARM. A bare run on `BARE` clears the field, so
// what is on it afterwards is exactly what this check spawns. One arm at the
// origin, at rest length `ARM_MIN_LEN`, puts a gripper on `(1, 0)`
// (`specs/parts.md`: "one gripper per spoke at `base + length * DIRS[d]`"), which
// is where the first mote is spawned so that `setGrip` has a mote resting on that
// gripper's hex to take hold of. The second is spawned on `(1, -1)`, adjacent to
// the first, so that `linkMotes` has an adjacent pair to join. Both tapes are
// empty, so nothing moves and nothing but the calls under test touches the field.
//
// THE VERDICT HAS TWO HALVES, WHICH ARE THE ITEM'S TWO CLAUSES.
//
//   1. THE LAST ENTRY IS THE NEW MOTE. After the first spawn `sim.motes` holds one
//      entry, and it is the mote resting on the hex that spawn named. After the
//      second it holds two, and the LAST of them — not the first — is the mote
//      resting on the hex the second spawn named, while the first still rests
//      where it was put. Nothing here reads an id VALUE: the specification fixes
//      the POSITION a new mote takes, never the number it is given.
//
//   2. THAT ID IS THE HANDLE. The id read off the last entry is handed straight to
//      `linkMotes`, `setGrip` and `removeMote`, and each does what its row says to
//      the mote this check spawned. Each is decisive on its own: `linkMotes`
//      refuses "motes on hexes that are not adjacent", and `setGrip` refuses "a
//      mote resting anywhere but that gripper's hex", so an id naming the wrong
//      mote fails the call rather than passing quietly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertNotEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { gripperHex } from "../parts";
import {
  captureStill,
  createHarness,
  filamentBetween,
  gripsOf,
  moteAt,
  openBareRun,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a spawned mote at the end of sim.motes and names it by that entry's id", async () => {
  await openBareRun(h, { challenge: BARE });
  const arm = await placePart(h, "arm", ORIGIN, 0);
  const held = gripperHex(ORIGIN, 0, ARM_MIN_LEN);
  const beside = at(held.q, held.r - 1);

  // The first spawn: one mote, and the list's last entry is it.
  await h.debug.spawnMote(held.q, held.r, "dust");
  const first = await h.snapshot();
  const motesAfterFirst = first.sim?.motes ?? [];
  assertLength(
    motesAfterFirst,
    1,
    "the bare run emptied the field, so the first spawn leaves one mote on it",
  );
  const a = motesAfterFirst[motesAfterFirst.length - 1]?.id;
  assertDefined(a, "sim.motes reports the mote that was just spawned");
  assertEqual(
    moteAt(first, held)?.id,
    a,
    "the last entry of sim.motes is the mote the spawn just put on that hex",
  );

  // The second spawn: two motes, and the LAST is the new one.
  await h.debug.spawnMote(beside.q, beside.r, "luna");
  const second = await h.snapshot();
  const motesAfterSecond = second.sim?.motes ?? [];
  assertLength(motesAfterSecond, 2, "the second spawn leaves two motes");
  const b = motesAfterSecond[motesAfterSecond.length - 1]?.id;
  assertDefined(b, "sim.motes reports the second mote too");
  assertEqual(
    moteAt(second, beside)?.id,
    b,
    "the new mote's id is the id of the LAST entry of sim.motes in the next snapshot",
  );
  assertNotEqual(b, a, "a spawned mote is given a fresh id");
  assertEqual(
    moteAt(second, held)?.id,
    a,
    "and the mote spawned before it still rests where it was put, ahead of it in the list",
  );

  // That id is what the other operations name the mote by.
  await h.debug.linkMotes(a as number, b as number, 1);
  const linked = await h.snapshot();
  assertNotNull(
    filamentBetween(linked, a as number, b as number),
    "linkMotes joins the two motes those ids name",
  );
  assertEqual(
    filamentBetween(linked, a as number, b as number)?.weight,
    1,
    "with the filament weight the call asked for",
  );

  await h.debug.setGrip(arm, 0, a as number);
  const gripped = await h.snapshot();
  assertLength(
    gripsOf(gripped, arm),
    1,
    "setGrip takes hold through the id of the mote resting on that gripper's hex",
  );
  assertEqual(
    gripsOf(gripped, arm)[0]?.spoke,
    0,
    "on the spoke the call named",
  );

  await h.advance(1);
  await captureStill(h, "identified");

  await h.debug.removeMote(b as number);
  const removed = await h.snapshot();
  assertLength(
    removed.sim?.motes ?? [],
    1,
    "removeMote takes off the one mote its id names",
  );
  assertNull(
    moteAt(removed, beside),
    "the mote the second spawn put on that hex is the one that went",
  );
  assertEqual(
    moteAt(removed, held)?.id,
    a,
    "and the mote the first spawn put on its hex is the one that stayed",
  );
  assertNull(
    filamentBetween(removed, a as number, b as number),
    "with the filament that touched it",
  );
});
