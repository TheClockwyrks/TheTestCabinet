// simulation/rotate-cw-turns-the-part — `rotate-cw` turns the part one step
// clockwise about its base.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`rotate-cw`, `rotate-ccw` — The part's direction turns 60 degrees about its
// base, clockwise or counterclockwise, sweeping `60 * t` degrees." The base is not
// among the things that move: the row moves the part's DIRECTION, and neither the
// anchor nor the length appears in it. `specs/field.md` fixes the step in index
// terms — "Rotating a direction index clockwise adds `1` modulo `6`" — and
// `specs/instructions.md` restates it: "`rotate-cw` — The part turns one 60 degree
// step clockwise about its base."
//
// THE GRIPPERS FOLLOW FROM THE POSE. `specs/parts.md` fixes an arm's anatomy as "a
// base fixed on the anchor hex, a length, and one gripper per spoke at
// `base + length * DIRS[d]` for each spoke direction `d`", where "The part's
// rotation names its first spoke, and the variant names the rest" — a `biarm`
// carrying "`rotation`, `rotation + 3`". So a rotation, a length and a base state
// where every gripper is, and the check reads that back directly: after the cycle
// a mote is spawned on each hex the anatomy puts a gripper on and `setGrip` is
// asked for it, which "throws" for "a mote resting anywhere but that gripper's
// hex" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. One `biarm` on `(0, 0)` at rest rotation `5` and length `2`,
// with `rotate-cw` in cell `0`, and NOTHING else on the field. Rotation `5` is
// chosen so the step wraps: `5 + 1` modulo `6` is `0`, which a build that merely
// increments fails. Length `2` is chosen so "its length unchanged" is a reading
// rather than a tautology, and the two spokes so "each gripper" is more than one.
//
// THE VERDICT. The pose the run reports for the part ends the cycle at rotation
// `0`, length `2`, base cell `(0, 0)` — and its two grippers stand on `(2, 0)` and
// `(-2, 0)`, which is `base + 2 * DIRS[d]` for the spokes `0` and `3` of its new
// rotation.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex, spokesOf } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  heldBy,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Read back that `part` really carries a gripper on `spoke`, standing on `hex`.
 *
 * `setGrip` "throws" for "a part with no gripper on that spoke" and for "a mote
 * resting anywhere but that gripper's hex" (`specs/instrumentation.md`), so a mote
 * spawned on the hex the anatomy of `specs/parts.md` names and offered to that
 * spoke is a direct reading of where the gripper is. The refusal is caught and
 * reported as the verdict rather than left to escape as the build's own error.
 */
async function gripperStandsOn(
  part: number,
  spoke: number,
  hex: Hex,
  why: string,
): Promise<void> {
  const mote = await spawnMote(h, hex, "dust");
  let refusal: string | null = null;
  try {
    await takeGrip(h, part, spoke, mote);
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  assertNull(refusal, why);
  assertEqual(heldBy(await h.snapshot(), part, spoke), mote, why);
}

it("ends the cycle one direction index higher, its base and length untouched", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("biarm", 0, 0, 5, 2, ["rotate-cw"])]),
  });
  const biarm = (await partIds(h))[0] ?? -1;

  const before = poseOf(await h.snapshot(), biarm);
  assertNotNull(before, "the run reports a live pose for the placed part");
  assertEqual(
    before?.rotation,
    5,
    "each run starts every arm at its rest pose, which was placed at rotation 5",
  );

  await captureReplay(h, "turn", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "one arm turning over an empty field faults at nothing",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  const pose = poseOf(after, biarm);
  assertNotNull(
    pose,
    "the run reports a live pose for the part after the cycle",
  );
  assertEqual(
    pose?.rotation,
    0,
    "rotate-cw turns the direction one step clockwise, which adds 1 modulo 6 to the index",
  );
  assertEqual(
    pose?.length,
    2,
    "a rotation changes the part's direction alone, so its length is unchanged",
  );
  assertEqual(
    `${pose?.cell.q},${pose?.cell.r}`,
    "0,0",
    "the part turns about its base, so its base is unmoved",
  );

  const spokes = spokesOf("biarm", 0);
  for (const spoke of spokes) {
    await gripperStandsOn(
      biarm,
      spoke,
      gripperHex(at(0, 0), spoke, 2),
      `spoke ${spoke} of the turned biarm stands on base plus length times DIRS of its new spoke`,
    );
  }
});
