// sigils/dispersion-requires-every-crown-vacant — one occupied crown stops it.
//
// THE RULE. "When the fount holds an unbonded, unheld `aether` and ALL FOUR CROWNS
// ARE VACANT, the `aether` is consumed and the four essences appear"
// (`specs/sigils.md`, `dispersion`); "vacant: the hex holds neither a mote nor a
// fixture"; and "A sigil whose condition does not hold at a boundary waits". So a
// mote on any one crown, and a fixture on any one crown, each block the whole
// effect — the aether included, because a sigil that waits consumes nothing.
//
// THE CONFIGURATION. One `dispersion` on the middle of the field with an `aether`
// on its fount, and one blocker at a time. Each of the four crowns is blocked in
// turn by a `dust`, and then the nebula crown is blocked by a FIXTURE: "A `wheel`
// is a hub on its anchor hex carrying six fixture motes, one on each adjacent hex"
// (`specs/parts.md`), so a wheel anchored one hex east of that crown puts a fixture
// on it. The wheel's tape is empty, "which every part rests on"
// (`specs/instrumentation.md`), so the ring stands still.
//
// THE VERDICT, IN BOTH DIRECTIONS. At each blocked boundary the aether is still on
// the fount and the three unblocked crowns are still bare, so nothing was consumed
// and nothing was half created. Then the last blocker is removed and one further
// boundary runs: the aether goes and the four crowns fill.

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

it("waits while a mote or a fixture rests on any one of its four crowns", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "dispersion", ORIGIN, 0);
  const fount = roleHex("dispersion", "fount", ORIGIN, 0);
  const crowns = ESSENCES.map((essence) => ({
    essence,
    hex: roleHex("dispersion", `${essence} crown`, ORIGIN, 0),
  }));
  const aether = await spawnMote(h, fount, "aether");

  // Each crown in turn, blocked by a loose mote.
  for (const blocked of crowns) {
    const blocker = await spawnMote(h, blocked.hex, "dust");

    await advanceCycles(h, 1);
    if (blocked.essence === ESSENCES[0]) await captureStill(h, "blocked-crown");

    const after = await h.snapshot();
    assertEqual(
      after.sim?.status,
      "running",
      "a sigil whose condition does not hold waits: nothing faults",
    );
    assertEqual(
      moteAt(after, fount)?.id,
      aether,
      `a mote on the ${blocked.essence} crown blocks the dispersion, and the aether is not consumed`,
    );
    assertEqual(
      moteAt(after, blocked.hex)?.id,
      blocker,
      `the mote resting on the ${blocked.essence} crown is untouched`,
    );
    for (const crown of crowns) {
      if (crown.essence === blocked.essence) continue;
      assertNull(
        moteAt(after, crown.hex),
        `the ${crown.essence} crown is still empty: no essence appeared`,
      );
    }
    assertLength(
      after.sim?.motes ?? [],
      2,
      "the aether and the one blocker are still the whole of the field",
    );

    await h.debug.removeMote(blocker);
  }

  // The first crown again, blocked by a wheel's fixture instead of a mote.
  const nebulaCrown = crowns[0] as { essence: string; hex: Hex };
  const wheel = await placePart(
    h,
    "wheel",
    at(nebulaCrown.hex.q + 1, nebulaCrown.hex.r),
    0,
  );
  const posed = await h.snapshot();
  const fixture = moteAt(posed, nebulaCrown.hex);
  assertNotNull(
    fixture,
    "a wheel placed into a live run puts a fixture on each of its six spoke hexes",
  );
  assertEqual(
    fixture?.wheel,
    wheel,
    "the mote on the nebula crown is that wheel's fixture rather than a loose mote",
  );

  await advanceCycles(h, 1);

  const withFixture = await h.snapshot();
  assertEqual(
    withFixture.sim?.status,
    "running",
    "a wheel resting on its blank tape faults at nothing",
  );
  assertEqual(
    moteAt(withFixture, fount)?.id,
    aether,
    "a fixture makes a crown not vacant, so the aether is not consumed",
  );
  for (const crown of crowns.slice(1)) {
    assertNull(
      moteAt(withFixture, crown.hex),
      `the ${crown.essence} crown is still empty with a fixture on the nebula crown`,
    );
  }

  // Take the wheel off, and the same aether on the same fount disperses.
  await h.debug.removePart(wheel);
  await advanceCycles(h, 1);

  const dispersed = await h.snapshot();
  assertNull(
    moteById(dispersed, aether),
    "the aether is consumed once every crown is vacant, so the sigil really acts",
  );
  for (const crown of crowns) {
    assertNotNull(
      moteAt(dispersed, crown.hex),
      `the ${crown.essence} crown fills once every crown is vacant`,
    );
  }
});
