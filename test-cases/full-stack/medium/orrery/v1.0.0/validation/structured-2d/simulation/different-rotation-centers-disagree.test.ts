// simulation/different-rotation-centers-disagree — two rotations turning the SAME
// way about DIFFERENT hexes are not the same motion, so the constellation tears.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). The agreeing clause for rotations
// requires BOTH the center and the direction; sharing the direction alone is not
// enough. `FAULTS` names the outcome: "`torn` — A held constellation's imposed
// motions disagree."
//
// WHERE EACH ROTATION'S CENTER COMES FROM. "`rotate-cw`, `rotate-ccw` — The part's
// direction turns 60 degrees about its base, clockwise or counterclockwise ...
// Motion imposed on each held constellation: The same rotation about the base"
// (`specs/simulation.md`, Motion and carrying). So two arms with different anchor
// hexes impose rotations about different centers, however alike their tapes are.
//
// THE CONFIGURATION. One `dust` mote on `(1, 0)` — "A lone mote with no filaments
// is a constellation of one" (`specs/field.md`) — held by two arms whose grippers
// both stand on it and whose bases are two hexes apart. "Only motes collide, so a
// gripper and the drawn arm between base and gripper pass over any hex"
// (`specs/parts.md`), which is what lets two grippers share one hex:
//
//   * an `arm` on `(0, 0)` at rotation `0`, length `1`, gripper at
//     `base + length * DIRS[0]` = `(1, 0)`, with `rotate-cw` — rotation about
//     `(0, 0)`.
//   * an `arm` on `(2, 0)` at rotation `3`, length `1`, gripper at
//     `(2, 0) + DIRS[3]` = `(1, 0)` (`specs/field.md`), with `rotate-cw` —
//     rotation about `(2, 0)`.
//
// Both tapes carry the SAME instruction, so nothing but the center separates the
// two imposed motions. Each hold is given with `setGrip`, "which takes hold with
// no `grab` ever running" (`specs/instrumentation.md`), so no earlier cycle has
// moved either arm. Only one mote is on the field, so no pair exists for the
// collision rule to sample and the tear is the only fault available.
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

/** The first arm: based west of the mote, gripping east. */
const WEST_ROTATION = 0;

/** The second arm: based east of the mote, gripping west. */
const EAST_BASE = at(2, 0);
const EAST_ROTATION = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tears a constellation turned clockwise about two different bases", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, WEST_ROTATION, 1, ["rotate-cw"]),
      armPart("arm", EAST_BASE.q, EAST_BASE.r, EAST_ROTATION, 1, ["rotate-cw"]),
    ]),
  });
  const [west, east] = await partIds(h);
  const mote = await spawnMote(h, HELD, "dust");
  await takeGrip(h, west ?? -1, WEST_ROTATION, mote);
  await takeGrip(h, east ?? -1, EAST_ROTATION, mote);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.grips ?? [],
    2,
    "both arms hold the one mote before the cycle begins",
  );

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "torn");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle");
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "rotations agree only about the same center, so two clockwise rotations about (0, 0) and (2, 0) disagree",
  );
  assertEqual(
    sim?.status,
    "faulted",
    "a fault freezes the run where it stood and the status becomes faulted",
  );
});
