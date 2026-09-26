// simulation/agreement-is-by-center-and-direction — two rotations agree when they
// share a center and a direction, whichever instruction produced each.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). Two rotations are the same motion
// exactly when the center and the direction match; the third clause names nothing
// else.
//
// Where each rotation's center comes from: "`rotate-cw`, `rotate-ccw` — The part's
// direction turns 60 degrees about its base ... Motion imposed on each held
// constellation: The same rotation about the base"; "`pivot-cw`, `pivot-ccw` — The
// part does not move. Motion imposed on each held constellation: Rotation about
// the holding gripper's hex" (`specs/simulation.md`, Motion and carrying). So a
// rotation's center is the rotating part's BASE and a pivot's is the HOLDING
// GRIPPER's hex, and the two coincide when the pivoting part's gripper stands on
// the other's base.
//
// THE CONFIGURATION. The shared center is `H = (0, 0)`.
//
//   * an `arm` on `H` at rotation `0`, length `1`, whose one gripper stands at
//     `base + length * DIRS[0]` = `(1, 0)` (`specs/parts.md`, `specs/field.md`),
//     with `rotate-cw` on its tape — rotation about `H`, clockwise.
//   * an `arm` on `(-1, 0)` at rotation `0`, length `1`, whose one gripper stands
//     at `(-1, 0) + DIRS[0]` = `H`, with `pivot-cw` on its tape — rotation about
//     its holding gripper's hex, which is `H`, clockwise.
//
// Two `dust` motes on `H` and `(1, 0)`, joined by one plain filament: they are
// adjacent, so they are ONE constellation (`specs/field.md`), and each arm holds
// it through the mote under its own gripper. Each hold is given with `setGrip`,
// "which takes hold with no `grab` ever running" (`specs/instrumentation.md`).
//
// Nothing else is on the field, and a rigid rotation about `H` keeps the two motes
// `HEX_PITCH` (`48`) apart at every sample, which never reaches
// `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. No fault: the cycle reaches its boundary with `sim.status` still
// `running` and `sim.cycle` at `1`. And the configuration really TURNED rather
// than clearing by standing still: the mote on `(1, 0)` has swung one clockwise
// step about `H` to `(0, 1)` by the formula of `specs/field.md`, and the mote on
// `H` has stayed on the center it turns about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at, rotateAbout } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** The one hex both imposed rotations turn about. */
const CENTER = ORIGIN;

/** The turner's pose: based on the center, gripping one hex east of it. */
const TURNER_ROTATION = 0;

/** The pivoter's pose: based one hex west, so its gripper stands on the center. */
const PIVOTER_BASE = at(-1, 0);
const PIVOTER_ROTATION = 0;

/** The two hexes the constellation rests on, one under each gripper. */
const HELD = [CENTER, at(1, 0)] as const;

/** One clockwise step, the direction both instructions turn. */
const STEPS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("agrees a pivot with a rotation that turn about one hex in one direction", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", CENTER.q, CENTER.r, TURNER_ROTATION, 1, ["rotate-cw"]),
      armPart("arm", PIVOTER_BASE.q, PIVOTER_BASE.r, PIVOTER_ROTATION, 1, [
        "pivot-cw",
      ]),
    ]),
  });
  const [turner, pivoter] = await partIds(h);
  const motes = await spawnConstellation(
    h,
    HELD.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, pivoter ?? -1, PIVOTER_ROTATION, motes[0] ?? -1);
  await takeGrip(h, turner ?? -1, TURNER_ROTATION, motes[1] ?? -1);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.grips ?? [],
    2,
    "the turning arm and the pivoting arm both hold the one constellation before the cycle begins",
  );

  await captureReplay(h, "agreed", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertNull(
    sim?.fault ?? null,
    "a rotation about H and a pivot about H, both clockwise, are the same motion, so nothing tears",
  );
  assertEqual(
    sim?.status,
    "running",
    "a cycle that raises no fault leaves the run running",
  );
  assertEqual(
    sim?.cycle,
    1,
    "the cycle ran to its boundary rather than freezing",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );

  for (const [index, from] of HELD.entries()) {
    const landed = rotateAbout(from, CENTER, STEPS);
    const mote = moteById(snapshot, motes[index] ?? -1);
    assertEqual(
      `${mote?.q},${mote?.r}`,
      `${landed.q},${landed.r}`,
      `the mote from (${from.q}, ${from.r}) rode the one agreed rotation about (${CENTER.q}, ${CENTER.r})`,
    );
  }
});
