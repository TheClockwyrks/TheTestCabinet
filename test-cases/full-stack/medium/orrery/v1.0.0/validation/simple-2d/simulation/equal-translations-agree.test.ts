// simulation/equal-translations-agree — two holders imposing the SAME translation
// agree, and the constellation slides by that one vector.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). This check is the second clause:
// all the same translation vector.
//
// What `advance` imposes: "`advance`, `recede` — The base translates to the
// adjacent track cell, wrapping on a closed track. Motion imposed on each held
// constellation: Translation by the same vector, linearly in `t`"
// (`specs/simulation.md`, Motion and carrying). Two arms one cell apart on one
// straight track both step to their own next cell, and the two steps are the one
// vector.
//
// THE CONFIGURATION. An open track through `(0, 1)`, `(1, 1)`, `(2, 1)`, `(3, 1)`,
// and two arms anchored on its first two cells — "An arm or wheel whose anchor hex
// is a cell of a track is mounted on that track" (`specs/parts.md`). Each is at
// rotation `4`, length `1`; `DIRS[4]` is `(0, -1)` (`specs/field.md`), so their
// grippers stand one hex north of their bases, on `(0, 0)` and `(1, 0)`.
//
// Two `dust` motes on those two hexes, joined by one plain filament — they are
// adjacent, `(1, 0) - (0, 0)` being `DIRS[0]` — so they are ONE constellation
// (`specs/field.md`), held by both arms at once. Each hold is given with `setGrip`,
// "which takes hold with no `grab` ever running" (`specs/instrumentation.md`).
// Both tapes carry `advance`, so each arm's base moves to the next cell of the
// path: `(0, 1)` to `(1, 1)` and `(1, 1)` to `(2, 1)`, both the vector `(+1, 0)`.
//
// Nothing else is on the field. The rigid body keeps `HEX_PITCH` (`48`) between
// the two motes at every sample, which never reaches `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. No fault: the cycle reaches its boundary with `sim.status` still
// `running` and `sim.cycle` at `1`. And it really TRANSLATED rather than clearing
// by standing still: both motes have landed one hex east, the whole body carried
// by that one vector.

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
import { BARE } from "../fixtures";
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

/** The track the two arms ride, in the order its cells were laid. */
const TRACK = [at(0, 1), at(1, 1), at(2, 1), at(3, 1)] as const;

/**
 * The rotation both arms are placed at. An `arm`'s spokes are "`rotation`"
 * (`specs/parts.md`), so this is also the one spoke each carries its gripper on,
 * and `DIRS[4]` is `(0, -1)` (`specs/field.md`).
 */
const ROTATION = 4;

/** The one vector both `advance` instructions impose: one cell east. */
const STEP = at(1, 0);

/** Where the two motes of the one constellation start. */
const CARRIED = [at(0, 0), at(1, 0)] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries one constellation on two track arms imposing the same vector", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([...TRACK]),
      armPart("arm", TRACK[0].q, TRACK[0].r, ROTATION, 1, ["advance"]),
      armPart("arm", TRACK[1].q, TRACK[1].r, ROTATION, 1, ["advance"]),
    ]),
  });
  const [, leader, follower] = await partIds(h);
  const arms = [leader ?? -1, follower ?? -1];
  const motes = await spawnConstellation(
    h,
    CARRIED.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  for (const [index, arm] of arms.entries()) {
    await takeGrip(h, arm, ROTATION, motes[index] ?? -1);
  }

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.grips ?? [],
    2,
    "both track arms hold the one constellation before the cycle begins",
  );

  await captureReplay(h, "convoy", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertNull(
    sim?.fault ?? null,
    "two holders imposing the same translation vector agree, so nothing tears",
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

  for (const [index, from] of CARRIED.entries()) {
    const landed = translate(from, STEP);
    const mote = moteById(snapshot, motes[index] ?? -1);
    assertEqual(
      `${mote?.q},${mote?.r}`,
      `${landed.q},${landed.r}`,
      `the mote from (${from.q}, ${from.r}) was translated by the one vector both holders imposed`,
    );
  }
});
