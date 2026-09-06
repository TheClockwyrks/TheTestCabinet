// parts/hexarm-carries-six-spokes — a `hexarm` carries a gripper on every one of
// the six spokes.
//
// THE RULE. "one gripper per spoke at `base + length * DIRS[d]` for each spoke
// direction `d`" (`specs/parts.md`, Arms), and the variant table's row for the
// hexarm is "`hexarm` — all six". So its spoke set is every direction `DIRS`
// holds, `0` to `5`, and it carries six grippers, one at
// `base + length * DIRS[d]` for each.
//
// HOW A GRIPPER IS OBSERVED. `grab` makes every gripper visible at once: "Every
// gripper closes. A gripper over a mote takes hold of that mote's constellation"
// (`specs/instructions.md`), and `sim.grips` reports one entry per holding
// gripper as `{ part, spoke, mote }` (`specs/instrumentation.md`). So a mote is
// laid on every one of the six hexes a gripper could stand on at this length, and
// the cycle's one instruction is `grab`. Six lone motes are six constellations —
// "A lone mote with no filaments is a constellation of one" (`specs/field.md`) —
// so each gripper takes a body of its own and nothing is held twice.
//
// THE CONFIGURATION. One `hexarm` at `(0, 0)`, rotation `0`, length `1`, tape
// `["grab"]`, on an emptied field carrying nothing but the six posed motes.
// Nothing moves during the cycle — "`grab`, `drop`, blank — None"
// (`specs/simulation.md`) — and the six motes sit `HEX_PITCH` (`48`) apart, clear
// of `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. The cycle reaches its boundary with no fault, `sim.grips` holds
// exactly six entries for the hexarm, and each spoke `d` holds the mote resting
// on `base + 1 * DIRS[d]`: no spoke is missing and none holds a neighbor's mote.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { DIRS } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { gripperHex, spokesOf } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  type Harness,
} from "../harness";

/** The hexarm's pose. Its spoke set is all six whatever the rotation is. */
const ROTATION = 0;
const LENGTH = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes a gripper on each of the six spokes, one per DIRS entry", async () => {
  assertEqual(
    spokesOf("hexarm", ROTATION).join(","),
    "0,1,2,3,4,5",
    "a hexarm's spoke set is all six directions DIRS holds",
  );
  assertLength(DIRS, 6, "DIRS holds the six neighbor offsets, indexed 0 to 5");

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("hexarm", ORIGIN.q, ORIGIN.r, ROTATION, LENGTH, ["grab"]),
    ]),
  });
  const hexarm = (await partIds(h))[0] ?? -1;

  const waiting: number[] = [];
  for (const d of [0, 1, 2, 3, 4, 5]) {
    waiting.push(await spawnMote(h, gripperHex(ORIGIN, d, LENGTH), "dust"));
  }

  await advanceCycles(h, 1);
  const snapshot = await h.snapshot();
  await captureStill(h, "hexarm");

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that grabbed");
  assertEqual(sim?.status, "running", "the grab cycle reaches its boundary");
  assertNull(sim?.fault ?? null, "no fault was raised by the grab");
  assertEqual(
    sim?.cycle,
    1,
    "the cycle ran to its boundary rather than freezing",
  );
  assertEqual(
    poseOf(snapshot, hexarm)?.rotation,
    ROTATION,
    "the hexarm stands at the rotation it was placed at",
  );

  assertLength(
    gripsOf(snapshot, hexarm),
    6,
    "a hexarm carries six grippers, so all six waiting motes are held",
  );
  for (const d of [0, 1, 2, 3, 4, 5]) {
    assertEqual(
      heldBy(snapshot, hexarm, d),
      waiting[d] ?? -1,
      `spoke ${d} holds the mote resting on base + ${LENGTH} * DIRS[${d}]`,
    );
  }
});
