// simulation/a-mote-rests-off-the-field — a mote let go outside the rim stays
// there.
//
// THE RULE. "A mote may be carried over, dropped on, and REST ON a hex off the
// field. Off the field it collides, is grabbed, and is banked exactly as on it,
// and no sigil acts on it" (`specs/simulation.md`, Motion and carrying). What
// resting means is the rule right above it: "A mote held by nothing rests on its
// hex for the whole cycle", with `specs/field.md`'s "At rest a mote sits exactly on
// a hex center". And the release itself moves nothing: the motion table's last row
// gives `drop` "None" of motion for the part and "None" imposed on what it lets
// go.
//
// WHERE THE FIELD ENDS. "hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`" (`specs/field.md`), `FIELD_R` `5`, read
// here out of `field.ts`'s `onField`.
//
// THE CONFIGURATION. An arm anchored on the rim hex `(5, 0)` at rotation `4`,
// length `1`, so its gripper starts on `(5, -1)`, holding one mote. Its tape is
// two cells, `rotate-cw` then `drop`, which by `specs/instructions.md` makes the
// machine's period `2` and runs them alternately:
//
//   cycle 0  `rotate-cw`  carries the held mote to `(5, 0) + DIRS[5]` = `(6, -1)`,
//                         which `onField` puts outside the field;
//   cycle 1  `drop`       releases it there, imposing no motion;
//   cycles 2 to 5         the arm keeps turning, EMPTY, past the mote it left.
//
// The mote is the whole of the field, so no pair exists for the collision rule;
// and an empty gripper sweeping past it is no reason to move, since "Only motes
// collide, so a gripper and the drawn arm between base and gripper pass over any
// hex, on or off the field" (`specs/parts.md`).
//
// THE ARM REALLY KEEPS MOVING, which is what separates this from a build that
// stops after the drop: its live rotation is read at each of the following
// boundaries and has taken the step its cell named.
//
// THE VERDICT. From the boundary of the dropping cycle onward, and through four
// more cycles, the mote reports `(6, -1)` with its `x` and `y` exactly on that
// hex's center, and no grip anywhere names it. A mote released off the field rests
// exactly as one released on it does.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertTrue,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter, onField, turnDirection } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
  type OrrerySnapshot,
  spawnMote,
  takeGrip,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The arm's anchor, its starting spoke, and the off-field hex it parks on. */
const RIM = at(5, 0);
const ROTATION = 4;
const INSIDE = at(5, -1);
const PARKED = at(6, -1);

/** How many cycles run after the drop, with the arm turning and the mote resting. */
const AFTER = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a mote dropped outside the rim resting there for every later cycle", async () => {
  assertTrue(
    !onField(PARKED),
    "the hex the mote is dropped on is outside the field of radius FIELD_R (5)",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", RIM.q, RIM.r, ROTATION, 1, ["rotate-cw", "drop"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, INSIDE, "dust");
  await takeGrip(h, arm, ROTATION, mote);

  const readings = await captureReplay(h, "parked", async () => {
    const taken: OrrerySnapshot[] = [];
    for (let cycle = 0; cycle < 2 + AFTER; cycle += 1) {
      await advanceCycles(h, 1);
      taken.push(await h.snapshot());
    }
    return taken;
  });

  const carried = readings[0] as OrrerySnapshot;
  assertEqual(
    `${moteById(carried, mote)?.q},${moteById(carried, mote)?.r}`,
    `${PARKED.q},${PARKED.r}`,
    "the first cycle carried the held mote out past the rim, which is where the drop happens",
  );

  // From the dropping cycle onward the mote is loose, and it does not move.
  for (let cycle = 1; cycle < readings.length; cycle += 1) {
    const reading = readings[cycle] as OrrerySnapshot;
    const where = `at the boundary of cycle ${cycle}`;
    assertEqual(
      reading.sim?.status,
      "running",
      `one mote alone on the field cannot collide, so the run is still live ${where}`,
    );
    assertLength(
      reading.sim?.grips ?? [],
      0,
      `the drop released the mote and no later cell grabs, so nothing holds it ${where}`,
    );
    const resting = moteById(reading, mote);
    assertNotNull(resting, `the run still reports the dropped mote ${where}`);
    assertEqual(
      `${resting?.q},${resting?.r}`,
      `${PARKED.q},${PARKED.r}`,
      `a mote dropped off the field stays on that hex ${where}`,
    );
    assertNear(
      resting?.x ?? Number.NaN,
      hexCenter(PARKED).x,
      DRAWN_TOLERANCE,
      `a mote resting off the field sits exactly on its hex center ${where}`,
    );
    assertNear(
      resting?.y ?? Number.NaN,
      hexCenter(PARKED).y,
      DRAWN_TOLERANCE,
      `a mote resting off the field sits exactly on its hex center ${where}`,
    );
  }

  // The arm kept turning past it: the world around the parked mote is moving.
  for (const cycle of [2, 4]) {
    const reading = readings[cycle] as OrrerySnapshot;
    assertNotNull(
      poseOf(reading, arm),
      `the run reports the arm's live pose at the boundary of cycle ${cycle}`,
    );
    assertEqual(
      poseOf(reading, arm)?.rotation,
      turnDirection(ROTATION, 1 + cycle / 2),
      `the arm took another clockwise step in cycle ${cycle}, so the mote rested while the world moved`,
    );
  }
});
