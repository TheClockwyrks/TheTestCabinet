// sigils/confluence-requires-unheld-founts — a gripper on one fount's
// constellation blocks the confluence.
//
// THE RULE. "`confluence` ... When the four founts hold unbonded, UNHELD motes
// comprising one of each essence, in any arrangement, and the crown is vacant, all
// four are consumed and one `aether` appears on the crown" (`specs/sigils.md`,
// Transmuting sigils). "unheld: no gripper holds any mote of the mote's
// constellation", and "A sigil whose condition does not hold at a boundary waits"
// — so the boundary passes with nothing consumed and nothing created.
//
// THE CONFIGURATION. One `confluence` on the middle of the field: the crown on the
// anchor and the four founts on `(1, 0)`, `(0, 1)`, `(-1, 0)` and `(0, -1)` of the
// footprint table. One essence rests on each fount, so every other clause of the
// condition holds — one of each essence, each unbonded, the crown vacant — and the
// hold is the only thing standing in the way. The gripper is a length 1 `arm`
// anchored east of the nebula fount at rotation `3`, whose one spoke is its
// rotation and whose gripper sits at "`base + length * DIRS[d]`"
// (`specs/parts.md`), which is that fount. Its tape is empty, "which every part
// rests on" (`specs/instrumentation.md`), so the arm never moves and the hold is
// given with `setGrip`, "which takes hold with no `grab` ever running".
//
// THE VERDICT, IN BOTH DIRECTIONS. At the blocked boundary all four essences are
// still on their founts, the crown is still vacant, and no `aether` exists. Then
// the gripper alone is opened and one further boundary runs: the four are consumed
// and the `aether` appears. Without that second reading a build with no
// `confluence` at all would pass the first, and the point would be decided by
// accident rather than by the hold.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ESSENCES, type SigilName } from "../constants";
import { at, place, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { SIGIL_FOOTPRINTS, sigilRoleHex } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  heldBy,
  holdGrip,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** One named hex of a placed sigil, from the footprint tables of `specs/sigils.md`. */
function roleHex(
  kind: SigilName,
  role: string,
  anchor: Hex,
  rotation: number,
): Hex {
  const hex = sigilRoleHex(kind, role, anchor, rotation);
  if (hex === null) {
    throw new Error(`Orrery: specs/sigils.md gives ${kind} no ${role} hex`);
  }
  return hex;
}

/** Every hex of a placed sigil carrying one role, in the table's own order. */
function roleHexes(
  kind: SigilName,
  role: string,
  anchor: Hex,
  rotation: number,
): Hex[] {
  return SIGIL_FOOTPRINTS[kind]
    .filter((entry) => entry.role === role)
    .map((entry) => place(entry.hex, anchor, rotation));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("waits while a gripper holds one of the four fount essences", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "confluence", ORIGIN, 0);
  const crown = roleHex("confluence", "crown", ORIGIN, 0);
  const founts = roleHexes("confluence", "fount", ORIGIN, 0);
  assertLength(
    founts,
    ESSENCES.length,
    "specs/sigils.md gives confluence four fount hexes, one per essence",
  );

  // One of each essence, in the order the founts are tabulated: "in any
  // arrangement" is what the rule permits, and this is one arrangement.
  const motes: number[] = [];
  for (const [index, essence] of ESSENCES.entries()) {
    motes.push(await spawnMote(h, founts[index] as Hex, essence));
  }

  // The gripper: an arm east of the first fount, reaching back onto it.
  const held = founts[0] as Hex;
  const arm = await placePart(h, "arm", at(held.q + 1, held.r), 3);
  await takeGrip(h, arm, 3, motes[0] as number);
  assertEqual(
    heldBy(await h.snapshot(), arm, 3),
    motes[0],
    "the arm's one gripper holds the essence on the first fount",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "held-essence");

  const blocked = await h.snapshot();
  assertEqual(
    blocked.sim?.status,
    "running",
    "a sigil whose condition does not hold waits: nothing faults",
  );
  for (const [index, essence] of ESSENCES.entries()) {
    const fount = founts[index] as Hex;
    assertEqual(
      moteAt(blocked, fount)?.id,
      motes[index],
      `the ${essence} is still resting on its fount: none of the four is consumed`,
    );
    assertEqual(
      moteAt(blocked, fount)?.type,
      essence,
      `the ${essence} is untouched by a confluence that waited`,
    );
  }
  assertNull(
    moteAt(blocked, crown),
    "no aether appears on the crown while a fount essence is held",
  );
  assertLength(
    blocked.sim?.motes ?? [],
    ESSENCES.length,
    "the four essences are still the whole of the field",
  );

  // The hold is the only thing that changes, and the confluence then fires.
  await holdGrip(h, arm, 3);
  await advanceCycles(h, 1);

  const freed = await h.snapshot();
  for (const [index, essence] of ESSENCES.entries()) {
    assertNull(
      moteById(freed, motes[index] as number),
      `the ${essence} is consumed once no gripper holds it`,
    );
  }
  assertNotNull(
    moteAt(freed, crown),
    "the crown fills once the four founts are unheld, so the sigil really acts",
  );
});
