// simulation/different-translation-vectors-disagree — two translations along
// DIFFERENT vectors are not the same motion, so the constellation tears.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). The agreeing clause for
// translations is "the same translation vector", so two translations along
// different vectors satisfy none of the three. `FAULTS` names the outcome:
// "`torn` — A held constellation's imposed motions disagree."
//
// WHERE A PISTON'S VECTOR COMES FROM. "`extend`, `retract` — The piston's length
// changes by one, its gripper translating one hex along its spoke. Motion imposed
// on each held constellation: Translation by the same vector, linearly in `t`"
// (`specs/simulation.md`, Motion and carrying). The spoke is the piston's own:
// "`arm`, `piston` — `rotation`" and "one gripper per spoke at
// `base + length * DIRS[d]`" (`specs/parts.md`). So two pistons at different
// rotations extend along different vectors.
//
// THE CONFIGURATION. One `dust` mote on `(1, 0)` — "A lone mote with no filaments
// is a constellation of one" (`specs/field.md`) — held by two pistons whose spokes
// point different ways. "Only motes collide, so a gripper and the drawn arm
// between base and gripper pass over any hex" (`specs/parts.md`), which is what
// lets two grippers share one hex:
//
//   * a `piston` on `(0, 0)` at rotation `0`, length `1`, gripper at
//     `base + length * DIRS[0]` = `(1, 0)`, with `extend` — its gripper translates
//     along `DIRS[0]` = `(+1, 0)` (`specs/field.md`).
//   * a `piston` on `(1, 1)` at rotation `4`, length `1`, gripper at
//     `(1, 1) + DIRS[4]` = `(1, 0)`, with `extend` — its gripper translates along
//     `DIRS[4]` = `(0, -1)`.
//
// Both tapes carry the SAME instruction, so nothing but the vector separates the
// two imposed motions. Each hold is given with `setGrip`, "which takes hold with
// no `grab` ever running" (`specs/instrumentation.md`), so no earlier cycle has
// moved either piston, and each is at `ARM_MIN_LEN` (`1`) so neither `extend` can
// raise `overextended` at the fetch. Only one mote is on the field, so no pair
// exists for the collision rule to sample and the tear is the only fault
// available.
//
// THE VERDICT. The run faults, and it faults as `torn` rather than as anything
// else: `sim.fault.kind` is `torn` and "A fault freezes the run where it stood:
// the status becomes `faulted`."

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
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

/** The hex the one held mote rests on; both grippers stand there. */
const HELD = at(1, 0);

/** The piston that extends east: based west of the mote, spoke `DIRS[0]`. */
const EAST_ROTATION = 0;

/** The piston that extends northwest: based southeast of it, spoke `DIRS[4]`. */
const NORTH_BASE = at(1, 1);
const NORTH_ROTATION = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tears a constellation extended along two different spokes", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, EAST_ROTATION, 1, ["extend"]),
      armPart("piston", NORTH_BASE.q, NORTH_BASE.r, NORTH_ROTATION, 1, [
        "extend",
      ]),
    ]),
  });
  const [eastward, northward] = await partIds(h);
  const mote = await spawnMote(h, HELD, "dust");
  await takeGrip(h, eastward ?? -1, EAST_ROTATION, mote);
  await takeGrip(h, northward ?? -1, NORTH_ROTATION, mote);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.grips ?? [],
    2,
    "both pistons hold the one mote before the cycle begins",
  );

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "torn");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle");
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "translations agree only along the same vector, so an extend along (+1, 0) and one along (0, -1) disagree",
  );
  assertEqual(
    sim?.status,
    "faulted",
    "a fault freezes the run where it stood and the status becomes faulted",
  );
});
