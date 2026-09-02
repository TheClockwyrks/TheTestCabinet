// simulation/an-unheld-mote-rests — a mote no gripper holds is never dragged.
//
// THE RULE. "A mote held by nothing rests on its hex for the whole cycle"
// (`specs/simulation.md`, Motion and carrying). What a motion reaches is fixed the
// other way round too: an instruction "imposes a rigid motion over the cycle" on
// the part and "on each held constellation", and on nothing else. `specs/field.md`
// adds where a resting mote stands: "At rest a mote sits exactly on a hex center."
//
// AND A SWEEPING PART IS NOT A REASON TO MOVE. "Only motes collide, so a gripper
// and the drawn arm between base and gripper pass over any hex, on or off the
// field, and over any part" (`specs/parts.md`), so an arm passing over a resting
// mote's hex neither faults the run nor touches the mote.
//
// THE CONFIGURATION. An arm on `(0, 0)` at rotation `0` and length `2`, holding
// NOTHING, with `rotate-cw` on its tape: its gripper sweeps from `(2, 0)` around
// toward `(0, 2)`, "sweeping `60 * t` degrees" about the base. A single mote rests
// on `(1, 1)`, held by nothing. `(1, 1)` stands `HEX_PITCH * sqrt(3)` (`83.14`)
// from `(0, 0)` at exactly `30` degrees clockwise of due east, by the formulas of
// `specs/field.md` — which is the bearing the arm points along at `t = 1/2`. So
// the drawn arm passes directly over the resting mote's hex, midway through the
// cycle, and the mote must not care.
//
// THE MOTE IS THE WHOLE OF THE FIELD, so no pair of motes exists for the collision
// rule to find and nothing but the specification's own rule can hold it still. The
// arm holds nothing, so no constellation is carried and no tear is possible.
//
// THE SWEEP REALLY RAN, which is what separates this from a build whose parts
// never move: at the boundary the arm's live rotation has taken its one clockwise
// step, from `0` to `1` ("Rotating a direction index clockwise adds `1` modulo
// `6`", `specs/field.md`).
//
// THE VERDICT. At every one of the cycle's eight sample fractions `k / 8`, and at
// the boundary, the mote still reports `(1, 1)` and is still drawn exactly on that
// hex's center.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { COLLISION_SAMPLES, FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The hex the arm sweeps over, where the unheld mote rests. */
const RESTING: Hex = at(1, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves an unheld mote on its hex while an arm sweeps over it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 2, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const resting = await spawnMote(h, RESTING, "dust");

  const readings = await captureReplay(h, "resting", async () => {
    const taken: OrrerySnapshot[] = [];
    for (let k = 1; k <= COLLISION_SAMPLES; k += 1) {
      await advanceFraction(h, 1 / COLLISION_SAMPLES);
      taken.push(await h.snapshot());
    }
    return taken;
  });

  for (const [index, reading] of readings.entries()) {
    const where = `at sample ${index + 1} / ${COLLISION_SAMPLES} of the sweeping cycle`;
    const seen = moteById(reading, resting);
    assertNotNull(seen, `the run reports the unheld mote ${where}`);
    assertEqual(
      `${seen?.q},${seen?.r}`,
      `${RESTING.q},${RESTING.r}`,
      `a mote held by nothing rests on its hex for the whole cycle ${where}`,
    );
    assertNear(
      seen?.x ?? Number.NaN,
      hexCenter(RESTING).x,
      DRAWN_TOLERANCE,
      `an unheld mote sits exactly on its hex center, undragged by the arm ${where}`,
    );
    assertNear(
      seen?.y ?? Number.NaN,
      hexCenter(RESTING).y,
      DRAWN_TOLERANCE,
      `an unheld mote sits exactly on its hex center, undragged by the arm ${where}`,
    );
    assertLength(
      reading.sim?.grips ?? [],
      0,
      `the arm holds nothing, so nothing imposes a motion on the mote ${where}`,
    );
  }

  const boundary = readings[readings.length - 1] as OrrerySnapshot;
  assertEqual(
    boundary.sim?.status,
    "running",
    "one mote alone on the field gives the collision rule no pair, so nothing faults",
  );
  assertEqual(
    boundary.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertNotNull(
    poseOf(boundary, arm),
    "the run reports the sweeping arm's live pose",
  );
  assertEqual(
    poseOf(boundary, arm)?.rotation,
    1,
    "the arm really took its clockwise step, so the mote held still through a sweep rather than through a still world",
  );
});
