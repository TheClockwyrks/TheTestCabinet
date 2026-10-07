// instructions/blank-holds-the-pose — a blank cell holds the part exactly where
// it stood.
//
// THE RULE. "A blank cell is a rest: the part holds its pose for the cycle,
// keeping whatever grip it has" (`specs/instructions.md`, The instruction set),
// and the motion table of `specs/simulation.md` gives a blank the same row as
// `grab` and `drop`: "Motion of the part — None. Motion imposed on each held
// constellation — None." A pose is its "live rotation, length, and base cell"
// (`specs/state.md`, `poses`).
//
// THE CONFIGURATION, posed so that all three parts of a pose are somewhere they
// could visibly move FROM. A three-cell open track along `(-1, 0)`, `(0, 0)`,
// `(1, 0)`, with one piston anchored on its first cell — "An arm or wheel whose
// anchor hex is a cell of a track is mounted on that track" (`specs/parts.md`) —
// whose tape holds a blank at column `0` and `rotate-cw` at column `1`, so the
// tape's length is `2`, the machine's period is `2`, and cycle `0` fetches a
// WRITTEN blank rather than a cell past the tape's end.
//
// The live pose is then moved off the rest pose through the gate
// `specs/instrumentation.md` names for it — "`setPoseRotation`, `setPoseLength`,
// and `setPoseCell`, which move it with no tape running" — to rotation `2`,
// length `2`, base cell `(0, 0)`. A piston's gripper sits at
// `base + length * DIRS[d]` (`specs/parts.md`), which is `(-2, 2)`, and one mote
// is spawned there and given to that gripper with `setGrip`, "which takes hold
// with no `grab` ever running". It is the only mote on the field.
//
// THE VERDICT. The cycle reaches its boundary with no fault, and the piston ends
// it at exactly the rotation, length and base cell it began it with — each read
// from the BEFORE snapshot only after that reading has been shown to be there —
// while the mote it holds is still resting on `(-2, 2)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  posePart,
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

/** The base cell the live pose is moved to: the track's middle cell. */
const BASE = at(0, 0);

/** The spoke the posed rotation puts the piston's one gripper on. */
const SPOKE = 2;

/** `base + length * DIRS[2]` at length 2: where the gripper, and its mote, sit. */
const GRIPPER = at(-2, 2);

it("ends a blank cycle at the rotation, length and base cell it began with", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(-1, 0), at(0, 0), at(1, 0)]),
      armPart("piston", -1, 0, 0, 1, [null, "rotate-cw"]),
    ]),
  });
  const piston = (await partIds(h))[1] ?? -1;
  await posePart(h, piston, { rotation: SPOKE, length: 2, cell: BASE });
  const mote = await spawnMote(h, GRIPPER, "dust");
  await takeGrip(h, piston, SPOKE, mote);

  const before = await h.snapshot();
  const was = poseOf(before, piston);
  assertNotNull(
    was,
    "the run carries a live pose for the piston before the cycle",
  );
  assertEqual(was?.rotation, SPOKE, "the pose was moved to rotation 2");
  assertEqual(was?.length, 2, "the pose was moved to length 2");
  assertEqual(
    `${was?.cell.q},${was?.cell.r}`,
    `${BASE.q},${BASE.r}`,
    "the pose was moved to the track's middle cell",
  );
  assertEqual(
    heldBy(before, piston, SPOKE),
    mote,
    "the gripper holds the mote before the cycle runs",
  );

  await captureReplay(h, "rest", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a blank cell is a rest and never faults, so the cycle runs to its boundary",
  );
  assertNull(after.sim?.fault ?? null, "a rest raises no fault");
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  const now = poseOf(after, piston);
  assertNotNull(now, "the run still carries a live pose for the piston");
  assertEqual(
    now?.rotation,
    was?.rotation,
    "a blank cell holds the part's rotation for the cycle",
  );
  assertEqual(
    now?.length,
    was?.length,
    "a blank cell holds the part's length for the cycle",
  );
  assertEqual(
    `${now?.cell.q},${now?.cell.r}`,
    `${was?.cell.q},${was?.cell.r}`,
    "a blank cell holds the part's base cell for the cycle",
  );
  assertEqual(
    `${moteById(after, mote)?.q},${moteById(after, mote)?.r}`,
    `${GRIPPER.q},${GRIPPER.r}`,
    "a blank cell imposes no motion on what the part holds, so the carried mote is still on its hex",
  );
});
