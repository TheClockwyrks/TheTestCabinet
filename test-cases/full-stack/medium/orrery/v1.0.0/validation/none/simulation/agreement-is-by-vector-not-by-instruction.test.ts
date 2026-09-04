// simulation/agreement-is-by-vector-not-by-instruction — agreement compares the
// imposed MOTION, so two different instructions that impose one translation agree.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). The test is over the imposed
// motions and the agreeing case is "all the same translation vector" — the
// instruction's NAME is nowhere in it.
//
// The two names here impose one vector. "`extend`, `retract` — The piston's length
// changes by one, its gripper translating one hex along its spoke. Motion imposed
// on each held constellation: Translation by the same vector, linearly in `t`";
// "`advance`, `recede` — The base translates to the adjacent track cell ...
// Translation by the same vector, linearly in `t`" (`specs/simulation.md`, Motion
// and carrying).
//
// THE CONFIGURATION. One `dust` mote on `(1, 0)` — "A lone mote with no filaments
// is a constellation of one" (`specs/field.md`) — held by two grippers at once:
//
//   * a `piston` on `(0, 0)` at rotation `0`, length `1`, whose one gripper stands
//     at `base + length * DIRS[0]` = `(1, 0)` (`specs/parts.md`,
//     `specs/field.md`), with `extend` on its tape. Its gripper translates one hex
//     along its spoke, the vector `DIRS[0]` = `(+1, 0)`.
//   * an `arm` on `(1, 1)` at rotation `4`, length `1`, whose one gripper stands at
//     `(1, 1) + DIRS[4]` = `(1, 0)`, mounted on an open track through `(0, 1)`,
//     `(1, 1)`, `(2, 1)` — "An arm or wheel whose anchor hex is a cell of a track
//     is mounted on that track" (`specs/parts.md`) — with `advance` on its tape.
//     Its base moves to the next cell, `(2, 1)`, which is the vector `(+1, 0)`.
//
// One vector, two names. Each hold is given with `setGrip`, "which takes hold with
// no `grab` ever running" (`specs/instrumentation.md`). One mote is on the field,
// so no pair exists for the collision rule to sample.
//
// THE VERDICT. No fault: the cycle reaches its boundary with `sim.status` still
// `running` and `sim.cycle` at `1`. And the configuration really RAN rather than
// clearing by standing still: the mote has landed one hex east, on `(2, 0)`, which
// is the vector both instructions imposed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at, translate } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The hex the one held mote rests on: both grippers stand there. */
const HELD = at(1, 0);

/** The piston's rotation, which is also the one spoke it carries a gripper on. */
const PISTON_ROTATION = 0;

/** The track the mounted arm rides, and the arm's own cell and rotation. */
const TRACK = [at(0, 1), at(1, 1), at(2, 1)] as const;
const ARM_BASE = TRACK[1];
const ARM_ROTATION = 4;

/** The one vector `extend` and `advance` both impose here. */
const STEP = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("agrees an extend with an advance that impose the same one-hex vector", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, PISTON_ROTATION, 1, ["extend"]),
      trackPart([...TRACK]),
      armPart("arm", ARM_BASE.q, ARM_BASE.r, ARM_ROTATION, 1, ["advance"]),
    ]),
  });
  const [piston, , mounted] = await partIds(h);
  const mote = await spawnMote(h, HELD, "dust");
  await takeGrip(h, piston ?? -1, PISTON_ROTATION, mote);
  await takeGrip(h, mounted ?? -1, ARM_ROTATION, mote);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.grips ?? [],
    2,
    "the piston and the mounted arm both hold the one mote before the cycle begins",
  );

  await captureReplay(h, "agreed", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertNull(
    sim?.fault ?? null,
    "an extend and an advance imposing one translation vector agree, whatever the two instructions are called",
  );
  assertEqual(
    sim?.status,
    "running",
    "a cycle that raises no fault leaves the run running",
  );
  assertEqual(sim?.cycle, 1, "the cycle ran to its boundary rather than freezing");
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );

  const landed = translate(HELD, STEP);
  const carried = moteById(snapshot, mote);
  assertEqual(
    `${carried?.q},${carried?.r}`,
    `${landed.q},${landed.r}`,
    "the constellation was translated by the one vector both holders imposed",
  );
});
