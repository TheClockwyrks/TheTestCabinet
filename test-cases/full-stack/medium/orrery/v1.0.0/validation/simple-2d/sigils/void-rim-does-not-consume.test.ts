// sigils/void-rim-does-not-consume — only the maw eats.
//
// THE RULE. `specs/sigils.md` gives `void` a footprint of seven hexes — "`(0, 0)`
// | maw" and "all six neighbors of `(0, 0)` | rim" — and one sentence about them:
// "An unbonded, unheld mote on the maw is consumed. The maw is the only hex that
// consumes; the rim takes part in the placement rules of `specs/parts.md` alone."
// So a mote that WOULD have been consumed on the maw — unbonded, unheld — survives
// the boundary on any of the six rim hexes.
//
// THE CONFIGURATION. One `void` on the middle of the field with all six rim hexes
// occupied at once, each by an unbonded, unheld `dust`, and the maw left bare. The
// six are the neighbours of the anchor, computed from `specs/field.md`'s `DIRS`
// through `field.ts`, so which hexes the rim is comes from the specification rather
// than from the build. Nothing moves — the machine holds one sigil and no arm — so
// nothing can carry a mote off its hex, and two motes at rest on adjacent hexes
// stand `HEX_PITCH` (`48`) apart, which is never within the collision threshold of
// `38` (`specs/simulation.md`).
//
// THE VERDICT, IN BOTH DIRECTIONS. At the first boundary all six rim motes are
// still on their own hexes. Then a seventh `dust` is put on the MAW and one further
// boundary runs: that one is consumed and the six are still there. Without the
// second reading a build with no `void` at all would pass the first.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import type { SigilName } from "../constants";
import { neighbors, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { sigilRoleHex } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  spawnMote,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds an unbonded, unheld mote on every one of the six rim hexes", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "void", ORIGIN, 0);
  const maw = roleHex("void", "maw", ORIGIN, 0);
  const rim = neighbors(maw);

  const resting: number[] = [];
  for (const hex of rim) resting.push(await spawnMote(h, hex, "dust"));

  await advanceCycles(h, 1);
  await captureStill(h, "rim");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "six motes at rest on adjacent hexes hold 48, which is not within 38",
  );
  for (const [index, hex] of rim.entries()) {
    assertEqual(
      moteAt(after, hex)?.id,
      resting[index],
      `the mote on the rim hex (${hex.q}, ${hex.r}) survives the boundary`,
    );
  }
  assertLength(
    after.sim?.motes ?? [],
    rim.length,
    "the rim consumed nothing: all six motes are still on the field",
  );
  assertNull(moteAt(after, maw), "nothing was resting on the maw to consume");

  // The same mote, on the maw instead: the sigil really is a void.
  const onTheMaw = await spawnMote(h, maw, "dust");
  await advanceCycles(h, 1);

  const consumed = await h.snapshot();
  assertNull(
    moteById(consumed, onTheMaw),
    "an unbonded, unheld mote on the maw is consumed, so the void really acts",
  );
  assertLength(
    consumed.sim?.motes ?? [],
    rim.length,
    "the six rim motes are still there after the maw has eaten",
  );
});
