// sigils/dispersion-crowns-named — each essence lands on the crown named for it.
//
// THE RULE. `specs/sigils.md` tabulates `dispersion`'s footprint by role —
// `(0, 0)` fount, `(1, 0)` nebula crown, `(0, 1)` comet crown, `(-1, 0)` nova
// crown, `(0, -1)` meteor crown — and its sentence is "the `aether` is consumed
// and the four essences appear, each on its named crown, unbonded and unheld".
// "Footprints are written as relative hexes at rotation `0`; a placed sigil's
// hexes are its footprint rotated and translated as `specs/field.md` describes",
// and a pattern hex is placed by "each pattern coordinate ... rotated about
// `(0, 0)` by the rotation ... then translated by the anchor".
//
// THE CONFIGURATION IS PLACED OFF THE ORIGIN so the translation is exercised: the
// sigil is anchored on the field's west side at rotation `0`, where its four
// crowns are the anchor plus `(1, 0)`, `(0, 1)`, `(-1, 0)` and `(0, -1)`. Each
// crown hex is computed from the specification's own table through `parts.ts`,
// never from where the build happened to put something.
//
// THE WORLD IS THE SIGIL AND ONE AETHER. The bare opener leaves an empty field, so
// every crown is vacant and no other sigil can move a mote between crowns after
// the dispersion has laid it down.
//
// THE VERDICT. `nebula` rests on the nebula crown, `comet` on the comet crown,
// `nova` on the nova crown and `meteor` on the meteor crown, and the fount is bare.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ESSENCES, type SigilName } from "../constants";
import type { Hex } from "../field";
import { BARE, WEST } from "../fixtures";
import { sigilRoleHex } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
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

it("lays nebula, comet, nova and meteor each on the crown its footprint names", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "dispersion", WEST, 0);
  const fount = roleHex("dispersion", "fount", WEST, 0);
  await spawnMote(h, fount, "aether");

  await advanceCycles(h, 1);
  await captureStill(h, "crowns");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a sigil that acts raises no fault, so the run is still live",
  );
  assertLength(
    after.sim?.motes ?? [],
    ESSENCES.length,
    "the four essences are the whole of the field after the aether went",
  );
  assertNull(
    moteAt(after, fount),
    "the fount is bare once the aether it held is consumed",
  );
  for (const essence of ESSENCES) {
    const crown = roleHex("dispersion", `${essence} crown`, WEST, 0);
    const landed = moteAt(after, crown);
    assertNotNull(
      landed,
      `a mote rests on the ${essence} crown at (${crown.q}, ${crown.r})`,
    );
    assertEqual(
      landed?.type,
      essence,
      `the mote on the ${essence} crown is the ${essence}`,
    );
  }
});
