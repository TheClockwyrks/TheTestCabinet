// sigils/dispersion-requires-unbonded-aether — a filament on the aether stops it.
//
// THE RULE. "When the fount holds an UNBONDED, unheld `aether` and all four crowns
// are vacant, the `aether` is consumed and the four essences appear"
// (`specs/sigils.md`, `dispersion`). "unbonded: the mote carries no filament", and
// "A sigil whose condition does not hold at a boundary waits" — so an aether
// carrying one is not consumed and no essence appears.
//
// THE CONFIGURATION. One `dispersion` on the middle of the field, an `aether` on
// its fount, and one `dust` joined to it by a filament. "A filament is a rigid link
// between two motes on ADJACENT hexes" (`specs/field.md`), so the partner must
// stand on a neighbour of the fount — and it is put on the one neighbour of the
// anchor the footprint table does NOT name, `(1, -1)`, so the four crowns stay
// vacant and the bond is the only clause of the condition that fails.
//
// THE VERDICT, IN BOTH DIRECTIONS. At the bonded boundary the aether is still on
// the fount, the filament still joins the pair, and every crown is bare. Then the
// filament alone is removed and one further boundary runs: the aether goes and the
// four crowns fill. Without that second reading a build with no `dispersion` at all
// would pass the first.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ESSENCES, type SigilName } from "../constants";
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

it("waits while the aether on its fount carries a filament", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "dispersion", ORIGIN, 0);
  const fount = roleHex("dispersion", "fount", ORIGIN, 0);
  const crowns = ESSENCES.map((essence) => ({
    essence,
    hex: roleHex("dispersion", `${essence} crown`, ORIGIN, 0),
  }));

  const aether = await spawnMote(h, fount, "aether");
  // The northeast neighbour of the anchor: adjacent to the fount, and the one
  // neighbour dispersion's footprint gives no role to.
  const partnerHex = at(fount.q + 1, fount.r - 1);
  const partner = await spawnMote(h, partnerHex, "dust");
  await h.debug.linkMotes(aether, partner, 1);
  assertNotNull(
    filamentBetween(await h.snapshot(), aether, partner),
    "the aether carries a filament before the boundary that reads it",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "bonded-aether");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a sigil whose condition does not hold waits: nothing faults",
  );
  assertEqual(
    moteAt(after, fount)?.id,
    aether,
    "a bonded aether is not consumed",
  );
  assertEqual(
    moteAt(after, partnerHex)?.id,
    partner,
    "the mote at the other end of the filament is untouched too",
  );
  assertNotNull(
    filamentBetween(after, aether, partner),
    "the filament that blocked the dispersion still joins the pair",
  );
  for (const crown of crowns) {
    assertNull(
      moteAt(after, crown.hex),
      `the ${crown.essence} crown is still empty: no essence appeared`,
    );
  }
  assertLength(
    after.sim?.motes ?? [],
    2,
    "the aether and its partner are still the whole of the field",
  );

  // The bond is the only thing that changes, and the dispersion then fires.
  await h.debug.unlinkMotes(aether, partner);
  await advanceCycles(h, 1);

  const dispersed = await h.snapshot();
  assertNull(
    moteById(dispersed, aether),
    "the aether is consumed once it carries no filament",
  );
  for (const crown of crowns) {
    assertNotNull(
      moteAt(dispersed, crown.hex),
      `the ${crown.essence} crown fills once the aether is unbonded`,
    );
  }
});
