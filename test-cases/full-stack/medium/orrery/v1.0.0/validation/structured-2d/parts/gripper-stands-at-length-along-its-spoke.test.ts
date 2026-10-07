// parts/gripper-stands-at-length-along-its-spoke — a gripper stands `length` hexes
// out along its spoke, not on the adjacent hex.
//
// THE RULE. "a base fixed on the anchor hex, a length, and one gripper per spoke
// at `base + length * DIRS[d]` for each spoke direction `d`" (`specs/parts.md`,
// Arms). The length is a whole multiplier on the direction offset, not a step:
// "Length is a whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`),
// chosen in the editor." So an arm at length `2` grips the hex two out, an arm at
// `ARM_MAX_LEN` grips the hex three out, and neither grips the hex next door.
//
// HOW A GRIPPER'S HEX IS OBSERVED. `grab` closes every gripper, and "A gripper
// over a mote takes hold of that mote's constellation"
// (`specs/instructions.md`); `sim.grips` then reports which mote each gripper
// took (`specs/instrumentation.md`). So each arm below is given a mote on the hex
// `base + length * DIRS[0]` — the one it should take — AND a mote on every hex
// between the base and that one, which it must leave alone. A build that treats
// length as anything but a multiplier grips a decoy instead.
//
// THE CONFIGURATION. Three arms, all at rotation `0`, tape `["grab"]`, one at each
// of the three legal lengths, standing far enough apart on the field that no
// arm's motes are within reach of another's: length `1` at `(-3, -2)`, length `2`
// at `(-5, 0)`, and length `ARM_MAX_LEN` (`3`) at `(-5, 2)`. Nothing moves during
// the cycle — "`grab`, `drop`, blank — None" (`specs/simulation.md`, Motion and
// carrying) — and no two posed motes are closer than one hex, `HEX_PITCH` (`48`)
// units, so `2 * MOTE_COLLIDE_R` (`38`) is never reached.
//
// THE VERDICT. The cycle reaches its boundary with no fault; each arm holds
// exactly one mote, the one on `base + length * DIRS[0]`; and every decoy between
// a base and its gripper is held by nothing at all, which the total grip count of
// three settles.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { at, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex } from "../parts";
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

/** One arm per length, each on its own row of the field, all at rotation `0`. */
const ARMS: readonly { base: Hex; length: number }[] = [
  { base: at(-3, -2), length: 1 },
  { base: at(-5, 0), length: 2 },
  { base: at(-5, 2), length: ARM_MAX_LEN },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("grips the hex length out along its spoke and leaves the hexes between alone", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ARMS.map((arm) =>
        armPart("arm", arm.base.q, arm.base.r, 0, arm.length, ["grab"]),
      ),
    ),
  });
  const ids = await partIds(h);

  // Each arm gets a mote on the hex its gripper should stand on, and one on every
  // hex between its base and that hex, which it must not take.
  const target: number[] = [];
  const decoys: number[][] = [];
  for (const arm of ARMS) {
    target.push(
      await spawnMote(h, gripperHex(arm.base, 0, arm.length), "dust"),
    );
    const near: number[] = [];
    for (let step = 1; step < arm.length; step += 1) {
      near.push(await spawnMote(h, gripperHex(arm.base, 0, step), "dust"));
    }
    decoys.push(near);
  }

  await advanceCycles(h, 1);
  const snapshot = await h.snapshot();
  await captureStill(h, "lengths");

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that grabbed");
  assertEqual(sim?.status, "running", "the grab cycle reaches its boundary");
  assertNull(sim?.fault ?? null, "no fault was raised by the grab");
  assertEqual(
    sim?.cycle,
    1,
    "the cycle ran to its boundary rather than freezing",
  );

  for (const [index, arm] of ARMS.entries()) {
    const part = ids[index] ?? -1;
    const reach = gripperHex(arm.base, 0, arm.length);
    assertEqual(
      poseOf(snapshot, part)?.length,
      arm.length,
      `the arm at (${arm.base.q}, ${arm.base.r}) runs the cycle at its chosen length ${arm.length}`,
    );
    assertLength(
      gripsOf(snapshot, part),
      1,
      `the arm at length ${arm.length} holds exactly one mote`,
    );
    assertEqual(
      heldBy(snapshot, part, 0),
      target[index] ?? -1,
      `the arm at length ${arm.length} grips the mote on (${reach.q}, ${reach.r}) = base + ${arm.length} * DIRS[0]`,
    );
    for (const decoy of decoys[index] ?? []) {
      assertEqual(
        (sim?.grips ?? []).some((grip) => grip.mote === decoy),
        false,
        `the arm at length ${arm.length} leaves the mote between its base and its gripper alone`,
      );
    }
  }
  assertLength(
    sim?.grips ?? [],
    ARMS.length,
    "three arms, one gripper each: no decoy anywhere on the field is held",
  );
});
