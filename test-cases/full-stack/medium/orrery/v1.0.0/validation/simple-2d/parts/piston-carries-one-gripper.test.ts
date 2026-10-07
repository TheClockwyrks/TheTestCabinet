// parts/piston-carries-one-gripper — a `piston` carries exactly one gripper, on
// its rotation spoke, at whatever length it stands at.
//
// THE RULE. "`arm`, `biarm`, `triarm`, `hexarm`, and `piston` share one anatomy: a
// base fixed on the anchor hex, a length, and one gripper per spoke at
// `base + length * DIRS[d]` for each spoke direction `d`" (`specs/parts.md`,
// Arms), and the variant table's first row carries the piston beside the arm:
// "`arm`, `piston` — `rotation`". So a piston's spoke set is the single direction
// `rotation`, exactly as an arm's is. Length is the one thing that separates them:
// "For a `piston` the chosen length is its rest length, and the `extend` and
// `retract` instructions change it at run time", and "Length is a whole number
// from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)". So the one gripper stands at
// `base + length * DIRS[rotation]` for whichever of those lengths the piston is
// at.
//
// HOW A GRIPPER IS OBSERVED. `grab` is what makes a gripper visible: "Every
// gripper closes. A gripper over a mote takes hold of that mote's constellation"
// (`specs/instructions.md`), and `sim.grips` reports one entry per holding
// gripper as `{ part, spoke, mote }` (`specs/instrumentation.md`). So a mote is
// laid on every one of the six hexes a gripper could stand on at the length under
// test, and the cycle's one instruction is `grab`.
//
// THE CONFIGURATION, twice over. One `piston` at `(0, 0)`, rotation `3`, tape
// `["grab"]`, on an emptied field — first at rest length `ARM_MIN_LEN` (`1`), then
// on a second posed run at rest length `ARM_MAX_LEN` (`3`), because the rule holds
// "whatever its length stands at". The rotation is deliberately not `0`. Nothing
// moves during either cycle — "`grab`, `drop`, blank — None"
// (`specs/simulation.md`, Motion and carrying) — and the six motes of a ring sit
// one hex apart, `HEX_PITCH` (`48`) units, clear of `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT, at each length. The cycle reaches its boundary with no fault,
// `sim.grips` holds exactly one entry for the piston, that entry is on spoke `3`,
// and the mote it holds is the one resting on `base + length * DIRS[3]`. Every
// other spoke holds nothing, though a mote was waiting on each of them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
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

/** The piston's rotation: deliberately not `0`. */
const ROTATION = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose a run holding one piston at `length` with `grab` on its tape, ring every
 * hex a gripper could stand on with a mote, and run the cycle. Answers the
 * piston's id beside the six waiting motes, indexed by spoke direction.
 */
async function grabAtLength(
  length: number,
): Promise<{ piston: number; waiting: number[] }> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, ROTATION, length, ["grab"]),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;
  const waiting: number[] = [];
  for (const d of [0, 1, 2, 3, 4, 5]) {
    waiting.push(await spawnMote(h, gripperHex(ORIGIN, d, length), "dust"));
  }
  await advanceCycles(h, 1);
  return { piston, waiting };
}

it("closes one gripper on the rotation spoke at ARM_MIN_LEN and again at ARM_MAX_LEN", async () => {
  assertEqual(
    spokesOf("piston", ROTATION).join(","),
    String(ROTATION),
    "a piston's spoke set is its rotation alone, exactly as an arm's is",
  );

  for (const length of [ARM_MIN_LEN, ARM_MAX_LEN]) {
    const { piston, waiting } = await grabAtLength(length);
    await captureStill(h, "piston");

    const snapshot = await h.snapshot();
    const sim = snapshot.sim;
    assertNotNull(sim, `the run is live through the grab at length ${length}`);
    assertEqual(
      sim?.status,
      "running",
      `length ${length}: the grab cycle reaches its boundary`,
    );
    assertNull(sim?.fault ?? null, `length ${length}: no fault was raised`);
    assertEqual(
      sim?.cycle,
      1,
      `length ${length}: the cycle ran to its boundary rather than freezing`,
    );
    assertEqual(
      poseOf(snapshot, piston)?.length,
      length,
      `length ${length}: the run started the piston at its chosen rest length`,
    );
    assertLength(
      gripsOf(snapshot, piston),
      1,
      `length ${length}: a piston carries exactly one gripper, so one of six waiting motes is held`,
    );
    for (const d of [0, 1, 2, 3, 4, 5]) {
      assertEqual(
        heldBy(snapshot, piston, d),
        d === ROTATION ? (waiting[d] ?? -1) : null,
        d === ROTATION
          ? `length ${length}, spoke ${d}: the one gripper holds the mote on base + ${length} * DIRS[${d}]`
          : `length ${length}, spoke ${d}: no gripper stands here, so the waiting mote is untouched`,
      );
    }
  }
});
