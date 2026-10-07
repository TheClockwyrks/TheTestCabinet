// sigils/dispersion-requires-aether-fount — only an `aether` disperses.
//
// THE RULE. "When the fount holds an unbonded, unheld `AETHER` and all four crowns
// are vacant, the `aether` is consumed and the four essences appear"
// (`specs/sigils.md`, `dispersion`), and "A sigil whose condition does not hold at
// a boundary waits". `MOTES` names fifteen types (`specs/field.md`) and the
// condition names one of them, so a fount holding any of the other fourteen leaves
// the four crowns empty.
//
// THE CONFIGURATION. One `dispersion` on the middle of the field with all four
// crowns vacant — the bare opener leaves an empty field — and one mote at a time on
// its fount. Two of the fourteen are posed: `dust`, the base type, and `nova`, one
// of the four essences the sigil itself produces, which is the type a build that
// read the condition off its OUTPUT rather than off its INPUT would accept.
//
// THE VERDICT, IN BOTH DIRECTIONS. With a non-aether on the fount every crown is
// still bare at the boundary and the mote is still where it was spawned. Then an
// `aether` is posed in the same fount, on the same sigil, and one further boundary
// runs: the four crowns fill. Without that second reading a build with no
// `dispersion` at all would pass the first.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ESSENCES, type MoteName, type SigilName } from "../constants";
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

/** Two of the fourteen types the condition does not name. */
const NOT_AETHER: readonly MoteName[] = ["dust", "nova"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the four crowns empty while the fount holds anything but an aether", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "dispersion", ORIGIN, 0);
  const fount = roleHex("dispersion", "fount", ORIGIN, 0);
  const crowns = ESSENCES.map((essence) => ({
    essence,
    hex: roleHex("dispersion", `${essence} crown`, ORIGIN, 0),
  }));

  for (const type of NOT_AETHER) {
    const mote = await spawnMote(h, fount, type);

    await advanceCycles(h, 1);
    if (type === NOT_AETHER[0]) await captureStill(h, "wrong-fount");

    const after = await h.snapshot();
    assertEqual(
      after.sim?.status,
      "running",
      "a sigil whose condition does not hold waits: nothing faults",
    );
    assertEqual(
      moteAt(after, fount)?.id,
      mote,
      `the ${type} on the fount is not consumed by a dispersion that waited`,
    );
    assertEqual(
      moteAt(after, fount)?.type,
      type,
      `the ${type} on the fount is untouched`,
    );
    for (const crown of crowns) {
      assertNull(
        moteAt(after, crown.hex),
        `the ${crown.essence} crown is still empty with a ${type} on the fount`,
      );
    }
    assertLength(
      after.sim?.motes ?? [],
      1,
      `the ${type} is still the whole of the field: no essence appeared`,
    );

    await h.debug.removeMote(mote);
  }

  // The one type the condition names, on the same fount of the same sigil.
  const aether = await spawnMote(h, fount, "aether");
  await advanceCycles(h, 1);

  const dispersed = await h.snapshot();
  assertNull(
    moteById(dispersed, aether),
    "an aether on the fount is consumed, so the sigil really acts",
  );
  for (const crown of crowns) {
    assertNotNull(
      moteAt(dispersed, crown.hex),
      `the ${crown.essence} crown fills once the fount holds an aether`,
    );
  }
});
