// parts/arm-carries-one-gripper — an `arm` carries exactly one gripper, and it
// stands on the rotation spoke.
//
// THE RULE. "`arm`, `biarm`, `triarm`, `hexarm`, and `piston` share one anatomy: a
// base fixed on the anchor hex, a length, and one gripper per spoke at
// `base + length * DIRS[d]` for each spoke direction `d`. The part's rotation
// names its first spoke, and the variant names the rest" (`specs/parts.md`,
// Arms), and the variant table's first row is "`arm`, `piston` — `rotation`". So
// an `arm`'s spoke set is the single direction `rotation`, and it carries one
// gripper, at `base + length * DIRS[rotation]`.
//
// HOW A GRIPPER IS OBSERVED. `grab` is what makes a gripper visible: "Every
// gripper closes. A gripper over a mote takes hold of that mote's constellation"
// (`specs/instructions.md`), and `sim.grips` reports "One holding gripper" per
// entry, as `{ part, spoke, mote }` (`specs/instrumentation.md`). So a mote is
// laid on EVERY one of the six hexes a gripper could stand on at this length —
// `base + length * DIRS[d]` for `d` from `0` to `5` — and the cycle's one
// instruction is `grab`. Every gripper the arm has is then over a mote, and
// `sim.grips` names which spokes exist and where each one stood.
//
// THE CONFIGURATION. One `arm` at `(0, 0)`, rotation `1`, length `1`, tape
// `["grab"]`, on an emptied field carrying nothing but the six posed motes. The
// rotation is deliberately not `0`, so a build that grips a fixed spoke rather
// than the rotation spoke is caught here rather than passing for the wrong
// reason. Nothing moves during the cycle — "`grab`, `drop`, blank — None"
// (`specs/simulation.md`, Motion and carrying) — and the six motes sit one hex
// apart, `HEX_PITCH` (`48`) units, well clear of `2 * MOTE_COLLIDE_R` (`38`), so
// no collision can end the cycle early.
//
// THE VERDICT. The cycle reaches its boundary with no fault, `sim.grips` holds
// exactly one entry for the arm, that entry is on spoke `1`, and the mote it
// holds is the one resting on `base + 1 * DIRS[1]`. Every other spoke holds
// nothing, though a mote was waiting on each of them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
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

/** The arm's pose: a rotation that is not `0`, and the shortest length. */
const ROTATION = 1;
const LENGTH = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes one gripper, on the rotation spoke, with a mote waiting on all six", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, ROTATION, LENGTH, ["grab"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  // One mote on every hex a gripper of this arm could possibly stand on.
  const waiting: number[] = [];
  for (const d of [0, 1, 2, 3, 4, 5]) {
    waiting.push(await spawnMote(h, gripperHex(ORIGIN, d, LENGTH), "dust"));
  }

  await advanceCycles(h, 1);
  const snapshot = await h.snapshot();
  await captureStill(h, "arm");

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that grabbed");
  assertEqual(
    sim?.status,
    "running",
    "the grab cycle reaches its boundary: nothing here can fault",
  );
  assertNull(sim?.fault ?? null, "no fault was raised by the grab");
  assertEqual(
    sim?.cycle,
    1,
    "the cycle ran to its boundary rather than freezing",
  );
  assertEqual(
    poseOf(snapshot, arm)?.rotation,
    ROTATION,
    "the arm stands at the rotation it was placed at",
  );

  assertEqual(
    spokesOf("arm", ROTATION).join(","),
    String(ROTATION),
    "an arm's spoke set is its rotation alone, as specs/parts.md's variant table gives it",
  );
  assertLength(
    gripsOf(snapshot, arm),
    1,
    "an arm carries exactly one gripper, so exactly one of the six waiting motes is held",
  );
  for (const d of [0, 1, 2, 3, 4, 5]) {
    assertEqual(
      heldBy(snapshot, arm, d),
      d === ROTATION ? (waiting[d] ?? -1) : null,
      d === ROTATION
        ? `spoke ${d}, the rotation spoke, holds the mote resting on base + ${LENGTH} * DIRS[${d}]`
        : `spoke ${d} carries no gripper, so the mote waiting on it is untouched`,
    );
  }
});
