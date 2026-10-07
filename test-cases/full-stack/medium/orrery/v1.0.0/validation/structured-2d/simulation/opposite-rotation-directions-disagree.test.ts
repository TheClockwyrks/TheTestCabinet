// simulation/opposite-rotation-directions-disagree — two rotations about ONE hex
// that turn opposite ways are not the same motion, so the constellation tears.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). The agreeing clause for rotations
// requires BOTH the center and the direction; sharing the center alone is not
// enough. `FAULTS` names the outcome: "`torn` — A held constellation's imposed
// motions disagree."
//
// WHERE EACH ROTATION'S CENTER COMES FROM. "`rotate-cw`, `rotate-ccw` — The part's
// direction turns 60 degrees about its base ... Motion imposed on each held
// constellation: The same rotation about the base"; "`pivot-cw`, `pivot-ccw` — The
// part does not move. Motion imposed on each held constellation: Rotation about
// the holding gripper's hex" (`specs/simulation.md`, Motion and carrying). So a
// rotating part's center is its base and a pivoting part's is its holding
// gripper's hex, and the two coincide when the pivoter's gripper stands on the
// rotator's base.
//
// THE CONFIGURATION. The shared center is `H = (0, 0)`, and the two holders differ
// only in which way they turn about it:
//
//   * an `arm` on `H` at rotation `0`, length `1`, whose one gripper stands at
//     `base + length * DIRS[0]` = `(1, 0)` (`specs/parts.md`, `specs/field.md`),
//     with `rotate-cw` on its tape — rotation about `H`, CLOCKWISE.
//   * an `arm` on `(-1, 0)` at rotation `0`, length `1`, whose one gripper stands
//     at `(-1, 0) + DIRS[0]` = `H`, with `pivot-ccw` on its tape — rotation about
//     its holding gripper's hex, which is `H`, COUNTERCLOCKWISE.
//
// Two `dust` motes on `H` and `(1, 0)`, joined by one plain filament: they are
// adjacent, so they are ONE constellation (`specs/field.md`), and each arm holds
// it through the mote under its own gripper. Each hold is given with `setGrip`,
// "which takes hold with no `grab` ever running" (`specs/instrumentation.md`), so
// no earlier cycle has moved either arm.
//
// Nothing else is on the field. The two motes stand `HEX_PITCH` (`48`) apart, well
// clear of `2 * MOTE_COLLIDE_R` (`38`), and in any case the tear is raised at the
// START of the motion step, before any sample is taken.
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
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** The one hex both imposed rotations turn about. */
const CENTER = ORIGIN;

/** The clockwise holder: based on the center, gripping one hex east of it. */
const TURNER_ROTATION = 0;

/** The counterclockwise holder: based one hex west, gripping the center. */
const PIVOTER_BASE = at(-1, 0);
const PIVOTER_ROTATION = 0;

/** The two hexes the one constellation rests on, one under each gripper. */
const HELD = [CENTER, at(1, 0)] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tears a constellation turned clockwise and counterclockwise about one hex", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", CENTER.q, CENTER.r, TURNER_ROTATION, 1, ["rotate-cw"]),
      armPart("arm", PIVOTER_BASE.q, PIVOTER_BASE.r, PIVOTER_ROTATION, 1, [
        "pivot-ccw",
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
    "the clockwise arm and the counterclockwise arm both hold the one constellation before the cycle begins",
  );

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "torn");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle");
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "rotations about one center agree only in the same direction, so a clockwise and a counterclockwise rotation about (0, 0) disagree",
  );
  assertEqual(
    sim?.status,
    "faulted",
    "a fault freezes the run where it stood and the status becomes faulted",
  );
});
