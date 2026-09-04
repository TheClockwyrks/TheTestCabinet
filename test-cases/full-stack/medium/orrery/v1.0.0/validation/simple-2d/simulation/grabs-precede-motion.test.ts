// simulation/grabs-precede-motion — a grab taken this cycle rides this cycle's
// motion.
//
// THE RULE, from the cycle order of `specs/simulation.md` (Cycles and the clock):
//
//   3. Grabs. "Every gripper of every part whose instruction is `grab` closes; a
//      gripper over a mote that is not a fixture takes hold of that mote's
//      constellation."
//   4. Motion. "The moving parts sweep across the cycle... with the torn check at
//      its start."
//
// So a hold taken at step 3 is already a hold when step 4 begins, and it counts in
// the agreement test the motion step opens with: "At the start of the motion step,
// every held constellation's imposed motions must agree: each holding gripper
// imposes the motion of its own part's instruction, and unless every imposed
// motion is the same one, the run faults as `torn`" (Held more than once).
//
// THE CONFIGURATION. One mote on `(1, 0)`, and two arms whose grippers both stand
// on that hex ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`, with the offsets of `specs/field.md`):
//
//   * an arm on `(0, 0)` at rotation `0` — `DIRS[0]` is `(+1, 0)` — with
//     `rotate-cw` on its tape, ALREADY holding the mote;
//   * an arm on `(2, 0)` at rotation `3` — `DIRS[3]` is `(-1, 0)` — with `grab` on
//     its tape, holding nothing when the cycle begins.
//
// The first arm's hold is given with `setGrip`, "which takes hold with no `grab`
// ever running" (`specs/instrumentation.md`), so the only grab in the scenario is
// the one on the tape, and the cycle under test is cycle `0`.
//
// The two motions do not agree: the rotating arm imposes "The part's direction
// turns 60 degrees about its base", and the grabbing arm imposes the `grab` row of
// the motion table, which is "None". So a grab that landed before the motion tears
// the constellation THIS cycle.
//
// THE VERDICT. `sim.status` is `faulted` as `torn` at `sim.cycle` `0`, and
// `sim.fault.parts` names BOTH arms in placement order — the grabbing arm among
// them, which is what says its grab had taken hold by the time the agreement was
// tested. A build that grabbed after the motion would carry the mote round
// unopposed and reach the boundary with no fault at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
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

it("tears in the cycle whose grab took the second hold, not the cycle after", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 2, 0, 3, 1, ["grab"]),
    ]),
  });
  const placed = await partIds(h);
  const turner = placed[0] ?? -1;
  const grabber = placed[1] ?? -1;
  const mote = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, turner, 0, mote);

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "torn");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the tear");
  assertEqual(
    sim?.status,
    "faulted",
    "a rotation and the grab's rest do not agree, so the cycle faults rather than completing",
  );
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "a held constellation whose imposed motions disagree is torn",
  );
  assertEqual(
    sim?.cycle,
    0,
    "the tear is raised in the cycle the grab was fetched in, not the one after",
  );
  assertDeepEqual(
    sim?.fault?.parts,
    [turner, grabber],
    "the tear names every part holding the constellation, the grabbing arm included: its grab had taken hold before the agreement was tested",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [mote],
    "the tear names every mote of the torn constellation",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "every fault but a collision leaves the fraction at 0, the tear being raised at the start of the motion step",
  );
});
