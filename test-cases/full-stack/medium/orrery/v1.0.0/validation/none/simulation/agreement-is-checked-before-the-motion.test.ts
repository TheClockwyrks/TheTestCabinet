// simulation/agreement-is-checked-before-the-motion — a tear freezes the run with
// nothing moved.
//
// THE RULE. "AT THE START OF THE MOTION STEP, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`" (`specs/simulation.md`, Held more than once). The cycle order says the
// same of where the check sits: "4. Motion. The moving parts sweep across the
// cycle, as the next section defines, WITH THE TORN CHECK AT ITS START and the
// collision check at each sample."
//
// WHAT THE FREEZE LEAVES BEHIND. "A `collision` leaves the fraction at that
// sample's `k / 8`; EVERY OTHER FAULT and completion leaves it at `0`" (Cycles and
// the clock), and "A fault freezes the run where it stood: the status becomes
// `faulted` and nothing advances further" (Faults). At fraction `0` nothing has
// swept, so every mote is still where the boundary left it — and `specs/field.md`
// puts a mote at rest "exactly on a hex center", by
// `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)` and
// `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`.
//
// THE CONFIGURATION. A constellation of two motes on `(1, 0)` and `(1, -1)`,
// joined by a filament (`DIRS[4]` is `(0, -1)`, so they are adjacent), held by two
// grippers that impose different motions ("one gripper per spoke at
// `base + length * DIRS[d]`", `specs/parts.md`):
//
//   * an arm on `(0, 0)` at rotation `0`, gripper `(1, 0)`, with `rotate-cw` — a
//     rotation about `(0, 0)`;
//   * an arm on `(2, 0)` at rotation `3`, gripper `(1, 0)`, with a BLANK tape —
//     "A blank cell is a rest", which imposes no motion.
//
// A rotation and no motion are not the same motion, so the constellation is torn.
// Both holds are given with `setGrip`, "which takes hold with no `grab` ever
// running" (`specs/instrumentation.md`), so the cycle under test is the first one
// and no earlier motion has moved anything. The two motes are the whole of the
// field.
//
// THE VERDICT. `sim.status` is `faulted` with `sim.fault.kind` `torn`;
// `sim.fraction` is `0`, read through `assertNear` because that figure is a
// running sum of the frames' own delta times; and EVERY mote the run reports
// stands exactly on the center of the hex it stood on at the boundary. A build
// that sweeps the cycle and only then discovers the disagreement leaves its motes
// part way round.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The torn constellation's two hexes, and the spokes that reach the first. */
const HELD: readonly Hex[] = [at(1, 0), at(1, -1)];
const TURNER_SPOKE = 0;
const RESTER_SPOKE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("freezes a torn run at fraction 0 with every mote still on its hex center", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, TURNER_SPOKE, 1, ["rotate-cw"]),
      armPart("arm", 2, 0, RESTER_SPOKE, 1, []),
    ]),
  });
  const placed = await partIds(h);
  const ids = await spawnConstellation(
    h,
    HELD.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, placed[0] ?? -1, TURNER_SPOKE, ids[0] ?? -1);
  await takeGrip(h, placed[1] ?? -1, RESTER_SPOKE, ids[0] ?? -1);

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "frozen");

  const frozen = await h.snapshot();
  const sim = frozen.sim;
  assertNotNull(sim, "the run is still live after the tear");
  assertEqual(
    sim?.status,
    "faulted",
    "a rotation and no motion do not agree, so the held constellation is torn",
  );
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "a held constellation's imposed motions disagreeing faults as torn",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the check runs at the START of the motion step, and every fault but a collision leaves the fraction at 0",
  );

  assertLength(
    sim?.motes ?? [],
    HELD.length,
    "the torn constellation is the whole of the field",
  );
  for (const [index, hex] of HELD.entries()) {
    const mote = moteById(frozen, ids[index] ?? -1);
    assertNotNull(mote, `the run still reports mote ${index} of the torn body`);
    assertEqual(
      `${mote?.q},${mote?.r}`,
      `${hex.q},${hex.r}`,
      `mote ${index} is still on the hex it stood on at the boundary`,
    );
    assertNear(
      mote?.x ?? Number.NaN,
      hexCenter(hex).x,
      DRAWN_TOLERANCE,
      `nothing moved before the tear, so mote ${index} reports the x of the hex it stood on`,
    );
    assertNear(
      mote?.y ?? Number.NaN,
      hexCenter(hex).y,
      DRAWN_TOLERANCE,
      `nothing moved before the tear, so mote ${index} reports the y of the hex it stood on`,
    );
  }
});
