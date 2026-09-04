// sigils/void-requires-unbonded — a filament saves a mote from the maw.
//
// THE RULE. "An UNBONDED, unheld mote on the maw is consumed" (`specs/sigils.md`,
// The void), where "unbonded: the mote carries no filament", and "A sigil whose
// condition does not hold at a boundary waits". So a mote on the maw carrying a
// filament survives the boundary.
//
// THE CONFIGURATION. One `void` on the middle of the field, one `dust` on its maw,
// and one `dust` joined to it by a filament. "A filament is a rigid link between
// two motes on ADJACENT hexes" (`specs/field.md`), so the partner stands on a
// neighbour of the maw — which is a rim hex, and "The maw is the only hex that
// consumes", so the partner's own survival is not what is being read here. Nothing
// else is on the field and nothing moves, so nothing can carry either mote away.
//
// THE VERDICT, IN BOTH DIRECTIONS. At the bonded boundary the mote is still on the
// maw and the filament still joins the pair. Then the filament alone is removed and
// one further boundary runs: the same mote on the same maw is consumed. Without
// that second reading a build with no `void` at all would pass the first.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import type { SigilName } from "../constants";
import { at, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { sigilRoleHex } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
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

it("leaves a mote on the maw alone while it carries a filament", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "void", ORIGIN, 0);
  const maw = roleHex("void", "maw", ORIGIN, 0);
  const partnerHex = at(maw.q + 1, maw.r);

  const bonded = await spawnMote(h, maw, "dust");
  const partner = await spawnMote(h, partnerHex, "dust");
  await h.debug.linkMotes(bonded, partner, 1);
  assertNotNull(
    filamentBetween(await h.snapshot(), bonded, partner),
    "the mote on the maw carries a filament before the boundary that reads it",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "bonded");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a sigil whose condition does not hold waits: nothing faults",
  );
  assertEqual(
    moteAt(after, maw)?.id,
    bonded,
    "a mote resting on the maw that carries a filament is not consumed",
  );
  assertEqual(
    moteAt(after, partnerHex)?.id,
    partner,
    "the mote at the other end of the filament is untouched too",
  );
  assertNotNull(
    filamentBetween(after, bonded, partner),
    "the filament that saved the mote still joins the pair",
  );
  assertLength(
    after.sim?.motes ?? [],
    2,
    "the bonded pair is still the whole of the field",
  );

  // The bond is the only thing that changes, and the maw then consumes.
  await h.debug.unlinkMotes(bonded, partner);
  await advanceCycles(h, 1);

  const unbonded = await h.snapshot();
  assertNull(
    moteById(unbonded, bonded),
    "the same mote on the same maw is consumed once it carries no filament",
  );
});
