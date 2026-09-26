// sigils/confluence-fuses-four-essences — one of each essence on the four founts
// becomes one `aether` on the crown.
//
// THE RULE. `confluence`'s table gives its five hexes — `(0, 0)` crown, and
// founts on `(1, 0)`, `(0, 1)`, `(-1, 0)` and `(0, -1)` — and its sentence fixes
// the whole effect: "When the four founts hold unbonded, unheld motes comprising
// one of each essence, in any arrangement, and the crown is vacant, all four are
// consumed and one `aether` appears on the crown, unbonded and unheld"
// (`specs/sigils.md`). The essences are `ESSENCES`, "`nebula`, `comet`, `nova`,
// `meteor` in that order" (`specs/field.md`).
//
// THE CONFIGURATION. One `confluence` anchored on the middle of the field at
// rotation `0`, and one mote of each essence on the four founts, taken from
// `ESSENCES` rather than written down so the check poses whatever the four
// essences are. Each arrives through `spawnMote`, which "adds one unbonded,
// unheld mote", which is what the founts must hold; the crown is left empty, and
// the opener cleared the field, so it is vacant in the sense `specs/sigils.md`
// defines. Nothing else is on the field.
//
// THE VERDICT, read at the boundary of one cycle, where the transmuting wave
// runs (`specs/simulation.md`, The sigil phase). All four founts are empty and
// all four motes are gone by id, the crown holds one `aether` joined to nothing
// and held by nothing, and it is the only mote on the field — so four were
// consumed and exactly one was made.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { ESSENCES } from "../constants";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  looseMotes,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes one of each essence and leaves an aether on the crown", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const crown = place(at(0, 0), anchor, rotation);
  const founts = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].map((hex) =>
    place(hex, anchor, rotation),
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("confluence", anchor.q, anchor.r, rotation)]),
  });
  const spawned: number[] = [];
  for (const [index, hex] of founts.entries()) {
    spawned.push(await spawnMote(h, hex, ESSENCES[index]));
  }

  const posed = await h.snapshot();
  for (const [index, hex] of founts.entries()) {
    assertEqual(
      moteAt(posed, hex)?.type,
      ESSENCES[index],
      `the fount at (${hex.q}, ${hex.r}) holds one essence`,
    );
  }
  assertNull(moteAt(posed, crown), "the crown is vacant before the boundary");

  await advanceCycles(h, 1);
  await captureStill(h, "aether");

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live at the boundary");
  assertEqual(
    after.sim?.status,
    "running",
    "a confluence is not a fault: the cycle reached its boundary",
  );
  for (const id of spawned) {
    assertNull(
      moteById(after, id),
      `the essence ${id} on its fount was consumed`,
    );
  }

  const born = moteAt(after, crown);
  assertNotNull(born, "one mote appears on the crown");
  assertEqual(born?.type, "aether", "the mote on the crown is an aether");
  assertEqual(
    constellationOf(after, born?.id ?? -1).length,
    1,
    "the aether is unbonded: its constellation is itself alone",
  );
  assertEqual(
    (after.sim?.grips ?? []).length,
    0,
    "the aether is unheld: no gripper holds anything at all",
  );
  assertEqual(
    looseMotes(after).length,
    1,
    "four motes went in and one came out, so all four were consumed",
  );
});
