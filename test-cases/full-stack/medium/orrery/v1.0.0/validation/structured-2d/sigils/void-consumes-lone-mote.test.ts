// sigils/void-consumes-lone-mote — the maw eats an unbonded, unheld mote,
// whatever its type.
//
// THE RULE. "`void` ... `(0, 0)` | maw ... An unbonded, unheld mote on the maw is
// consumed" (`specs/sigils.md`, The void). The two adjectives are that file's own
// terms for a mote at rest on a sigil hex: "unbonded: the mote carries no
// filament" and "unheld: no gripper holds any mote of the mote's constellation".
// Nothing in the sentence names a type, and `MOTES` names fifteen
// (`specs/field.md`), so all fifteen are posed.
//
// WHEN IT ACTS. "A sigil is engraved on the field at a fixed pose and acts at each
// boundary, the settle included, in the sigil phase `specs/simulation.md` defines"
// (`specs/sigils.md`), and the sigil phase is step 5 of a cycle, "Boundary"
// (`specs/simulation.md`, Cycles and the clock). So one whole cycle of game time
// is what carries a spawned mote to the moment the void reads it.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener leaves an empty field, and the
// one part placed back is the `void` itself: no arm, no wheel, no other sigil, and
// exactly one mote at a time. Nothing but the maw can have removed it, and nothing
// can have put anything back.
//
// THE VERDICT. After the boundary the mote the check spawned is gone from
// `sim.motes` and the maw is bare, and the field holds nothing at all — read as a
// length, so a build that consumed the mote and left something else behind fails
// here rather than passing on the one reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { MOTES, type SigilName } from "../constants";
import type { Hex } from "../field";
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

it("consumes an unbonded, unheld mote of every type resting on the maw", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "void", ORIGIN, 0);
  const maw = roleHex("void", "maw", ORIGIN, 0);

  for (const type of MOTES) {
    const mote = await spawnMote(h, maw, type);
    assertNotNull(
      moteById(await h.snapshot(), mote),
      `the ${type} rests on the maw before the boundary that reads it`,
    );

    await advanceCycles(h, 1);
    if (type === MOTES[0]) await captureStill(h, "consumed");

    const after = await h.snapshot();
    assertEqual(
      after.sim?.status,
      "running",
      "a sigil that acts raises no fault, so the run is still live",
    );
    assertNull(
      moteById(after, mote),
      `an unbonded, unheld ${type} on the maw is consumed at the boundary`,
    );
    assertNull(
      moteAt(after, maw),
      "the maw is bare once the mote resting on it is consumed",
    );
    assertLength(
      after.sim?.motes ?? [],
      0,
      "the world held one mote and the void consumed it, so the field is empty",
    );
  }
});
