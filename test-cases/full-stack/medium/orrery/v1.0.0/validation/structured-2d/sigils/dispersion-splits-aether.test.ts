// sigils/dispersion-splits-aether — one aether becomes the four essences.
//
// THE RULE. "`dispersion` ... When the fount holds an unbonded, unheld `aether`
// and all four crowns are vacant, the `aether` is consumed and the four essences
// appear, each on its named crown, unbonded and unheld" (`specs/sigils.md`,
// Transmuting sigils). `ESSENCES` "holds `nebula`, `comet`, `nova`, `meteor` in
// that order" (`specs/field.md`), so "the four essences" is one of each of those
// and nothing else.
//
// WHICH CROWN CARRIES WHICH ESSENCE is the neighbouring item's point; this one
// decides that the aether goes and that the four essences arrive, each of them
// carrying no filament and held by nothing.
//
// THE CONFIGURATION. One `dispersion` on the middle of the field, one `aether` on
// its fount, and nothing else at all: the bare opener leaves an empty field, so
// the four crowns are vacant by construction, no filament exists to bond the
// aether, and no part exists to hold it.
//
// THE VERDICT. At the boundary the aether's id is gone from `sim.motes`; the field
// then carries exactly four motes and their types are the four essences, compared
// as sorted lists because `specs/` fixes no order for `sim.motes`. "each unbonded
// and unheld" is read as the run carrying no filament and no grip at all, which is
// the strongest reading available in a world holding nothing else.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ESSENCES, type SigilName } from "../constants";
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

it("consumes an unbonded, unheld aether and leaves the four essences unbonded and unheld", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "dispersion", ORIGIN, 0);
  const fount = roleHex("dispersion", "fount", ORIGIN, 0);
  const aether = await spawnMote(h, fount, "aether");

  const posed = await h.snapshot();
  assertNotNull(
    moteById(posed, aether),
    "the aether rests on the fount before the boundary that reads it",
  );
  assertLength(
    posed.sim?.motes ?? [],
    1,
    "the aether is the whole of the field, so all four crowns are vacant",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "dispersed");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a sigil that acts raises no fault, so the run is still live",
  );
  assertNull(
    moteById(after, aether),
    "the aether is consumed at the boundary the dispersion acts on",
  );
  assertNull(
    moteAt(after, fount),
    "the fount is bare once the aether it held is consumed",
  );
  assertLength(
    after.sim?.motes ?? [],
    ESSENCES.length,
    "one mote per essence appears and nothing further",
  );
  assertDeepEqual(
    (after.sim?.motes ?? []).map((mote) => mote.type).sort(),
    [...ESSENCES].sort(),
    "the four motes are one of each essence of specs/field.md",
  );
  assertLength(
    after.sim?.filaments ?? [],
    0,
    "each essence appears unbonded, and they are the only motes there are",
  );
  assertLength(
    after.sim?.grips ?? [],
    0,
    "each essence appears unheld, and they are the only motes there are",
  );
});
