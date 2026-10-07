// simulation/fixtures-ride-their-wheel — a turning wheel carries its whole ring
// one spoke round.
//
// THE RULE. "Fixtures are carried by their wheel's rotation and rest otherwise"
// (`specs/simulation.md`, Motion and carrying), and the rotation itself is the
// motion table's first row: "`rotate-cw`, `rotate-ccw` — The part's direction
// turns 60 degrees about its base, clockwise or counterclockwise." A wheel takes
// only those two: "A wheel executes only `rotate-cw` and `rotate-ccw`"
// (`specs/instructions.md`).
//
// WHERE THE RING IS AND WHAT IS ON IT. "A `wheel` is a hub on its anchor hex
// carrying six fixture motes, one on each adjacent hex", and "`WHEEL_MOTES` holds
// the ring at rotation `0`, by spoke" — `nebula`, `comet`, `nova`, `meteor`,
// `dust`, `dust`. "The wheel's rotation turns the whole ring, so the fixture on
// spoke `d` is the entry above for `d - rotation` modulo `6`" (`specs/parts.md`).
// The suite reads that formula out of `parts.ts`'s `wheelFixture`, which carries
// it verbatim.
//
// WHERE ONE STEP SENDS A HEX. `specs/field.md` fixes both directions —
// "Clockwise: `(q, r) -> (-r, q + r)`; Counterclockwise: `(q, r) -> (q + r, -q)`",
// applied to the offset from the center — and the index arithmetic that matches:
// "Rotating a direction index clockwise adds `1` modulo `6`; counterclockwise
// subtracts `1`." So the fixture on the hex adjacent in direction `d` lands on the
// hex adjacent in direction `d + 1` under `rotate-cw`, and `d - 1` under
// `rotate-ccw`.
//
// THE CONFIGURATION. A wheel on `(0, 0)` at rotation `0`, placed INTO the live run
// so its six fixtures appear on its spoke hexes ("a part one of them adds enters
// the run at its rest pose holding nothing, with a wheel's six fixtures on its
// spoke hexes", `specs/instrumentation.md`), on an otherwise empty field. The ring
// is the whole of the world, and a rigid rotation holds every distance in it, so
// no pair comes within the `38` the collision rule watches. The scenario is posed
// twice, once for each direction, so both rows of the rule are decided.
//
// THE VERDICT. Each of the six fixtures — by ID, so a build that rewrote the ring
// rather than moving it is caught — stands on the adjacent hex of the new spoke;
// the wheel's live rotation has taken its one step; and the fixture now on spoke
// `d` is the `WHEEL_MOTES` entry for `d` minus that new rotation, modulo six.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at, neighbor, turnDirection } from "../field";
import { BARE } from "../fixtures";
import { wheelFixture } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  poseOf,
  writeTape,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The wheel's anchor: the hub its ring turns about. */
const HUB = at(0, 0);

/** The six spoke directions, in order. */
const SPOKES = [0, 1, 2, 3, 4, 5] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose a wheel alone on the field at rotation `0` and turn it one step, answering
 * the fixture ids by spoke before the turn and the snapshot after it.
 *
 * Asserts nothing: the caller reads the verdict.
 */
async function turnOneStep(
  instruction: "rotate-cw" | "rotate-ccw",
  outputId: string | null,
): Promise<{
  wheel: number;
  before: Map<number, number>;
  after: OrrerySnapshot;
}> {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", HUB, 0);
  await writeTape(h, wheel, [instruction]);

  const posed = await h.snapshot();
  const before = new Map<number, number>();
  for (const spoke of SPOKES) {
    const fixture = moteAt(posed, neighbor(HUB, spoke));
    if (fixture !== null) before.set(spoke, fixture.id);
  }

  const drive = async (): Promise<void> => {
    await advanceCycles(h, 1);
  };
  if (outputId === null) await drive();
  else await captureReplay(h, outputId, drive);

  return { wheel, before, after: await h.snapshot() };
}

it("carries all six fixtures one 60 degree step in the direction the cell names", async () => {
  for (const [instruction, step, outputId] of [
    ["rotate-cw", 1, "turned"],
    ["rotate-ccw", -1, null],
  ] as const) {
    const turned = await turnOneStep(instruction, outputId);

    assertLength(
      [...turned.before.keys()],
      SPOKES.length,
      `a wheel carries six fixture motes, one on each adjacent hex, before ${instruction}`,
    );
    assertEqual(
      turned.after.sim?.status,
      "running",
      `a rigid rotation holds every distance in the ring, so ${instruction} faults nothing`,
    );
    assertEqual(
      turned.after.sim?.cycle,
      1,
      `the ${instruction} cycle reached its boundary`,
    );
    assertNotNull(
      poseOf(turned.after, turned.wheel),
      "the run reports the wheel's live pose",
    );
    assertEqual(
      poseOf(turned.after, turned.wheel)?.rotation,
      turnDirection(0, step),
      `${instruction} turns the wheel's direction one step, so its live rotation is one step round`,
    );

    for (const spoke of SPOKES) {
      const rode = moteById(turned.after, turned.before.get(spoke) ?? -1);
      const landed = neighbor(HUB, turnDirection(spoke, step));
      assertNotNull(
        rode,
        `the fixture that stood on spoke ${spoke} is still one of the wheel's motes after ${instruction}`,
      );
      assertEqual(
        `${rode?.q},${rode?.r}`,
        `${landed.q},${landed.r}`,
        `the fixture from spoke ${spoke} rode the wheel onto the adjacent hex of the new spoke, under ${instruction}`,
      );
      assertEqual(
        rode?.wheel,
        turned.wheel,
        `the fixture from spoke ${spoke} is still that wheel's, after ${instruction}`,
      );

      const standing = moteAt(turned.after, neighbor(HUB, spoke));
      assertNotNull(
        standing,
        `a fixture stands on spoke ${spoke} after ${instruction}`,
      );
      assertEqual(
        standing?.type,
        wheelFixture(turnDirection(0, step), spoke),
        `the fixture on spoke ${spoke} is the WHEEL_MOTES entry for spoke minus the wheel's new rotation, modulo 6`,
      );
    }
  }
});
