// sigils/dispersion-requires-unheld-aether — a gripper on the aether stops it.
//
// THE RULE. "When the fount holds an unbonded, UNHELD `aether` and all four crowns
// are vacant, the `aether` is consumed and the four essences appear"
// (`specs/sigils.md`, `dispersion`). "unheld: no gripper holds any mote of the
// mote's constellation", and "A sigil whose condition does not hold at a boundary
// waits" — so a held aether is not consumed and no essence appears.
//
// THE CONFIGURATION. One `dispersion` on the middle of the field with an `aether`
// on its fount, and one length 1 `arm` reaching onto that fount. An arm carries
// "one gripper per spoke at `base + length * DIRS[d]`" and "The part's rotation
// names its first spoke" (`specs/parts.md`), so an arm anchored on the fount's
// northeast neighbour at rotation `2` — `DIRS[2]` is `(-1, +1)`, toward the
// southwest (`specs/field.md`) — grips the fount. That anchor is the one neighbour
// of the anchor dispersion's footprint gives no role to, so all four crowns stay
// vacant, and "An arm or wheel's anchor may sit on any sigil footprint hex"
// (`specs/parts.md`) would have permitted it in any case. Its tape is empty, "which
// every part rests on", and the hold is given with `setGrip`, "which takes hold
// with no `grab` ever running" (`specs/instrumentation.md`).
//
// THE VERDICT, IN BOTH DIRECTIONS. At the held boundary the aether is still on the
// fount, the gripper still holds it, and every crown is bare. Then the gripper
// alone is opened and one further boundary runs: the aether goes and the four
// crowns fill.

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("waits while a gripper holds the aether on its fount", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "dispersion", ORIGIN, 0);
  const fount = roleHex("dispersion", "fount", ORIGIN, 0);
  const crowns = ESSENCES.map((essence) => ({
    essence,
    hex: roleHex("dispersion", `${essence} crown`, ORIGIN, 0),
  }));

  const aether = await spawnMote(h, fount, "aether");
  const arm = await placePart(h, "arm", at(fount.q + 1, fount.r - 1), 2);
  await takeGrip(h, arm, 2, aether);
  assertEqual(
    heldBy(await h.snapshot(), arm, 2),
    aether,
    "the arm's one gripper holds the aether on the fount",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "held-aether");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a sigil whose condition does not hold waits: nothing faults",
  );
  assertEqual(
    moteAt(after, fount)?.id,
    aether,
    "a held aether is not consumed",
  );
  assertEqual(
    heldBy(after, arm, 2),
    aether,
    "the gripper that blocked the dispersion still holds it",
  );
  for (const crown of crowns) {
    assertNull(
      moteAt(after, crown.hex),
      `the ${crown.essence} crown is still empty: no essence appeared`,
    );
  }
  assertLength(
    after.sim?.motes ?? [],
    1,
    "the aether is still the whole of the field",
  );

  // The hold is the only thing that changes, and the dispersion then fires.
  await holdGrip(h, arm, 2);
  await advanceCycles(h, 1);

  const dispersed = await h.snapshot();
  assertNull(
    moteById(dispersed, aether),
    "the aether is consumed once no gripper holds it",
  );
  for (const crown of crowns) {
    assertNotNull(
      moteAt(dispersed, crown.hex),
      `the ${crown.essence} crown fills once the aether is unheld`,
    );
  }
});
