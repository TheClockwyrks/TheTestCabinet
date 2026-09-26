// simulation/fixtures-rest-when-the-wheel-rests — a wheel on a blank cell holds
// its ring exactly where it stands.
//
// THE RULE. "Fixtures are carried by their wheel's rotation and REST OTHERWISE"
// (`specs/simulation.md`, Motion and carrying). What a blank cell is, is fixed
// twice over: "A blank cell is a rest on every part, a wheel included, and never
// faults" (the cycle's fetch step), and "A blank cell is a rest: the part holds
// its pose for the cycle" (`specs/instructions.md`). The motion table's last row
// gives a blank "None" of motion for the part and "None" imposed on what it
// carries. And `specs/field.md`: "At rest a mote sits exactly on a hex center."
//
// WHERE THE RING IS. "A `wheel` is a hub on its anchor hex carrying six fixture
// motes, one on each adjacent hex", and "the fixture on spoke `d` is the entry
// above for `d - rotation` modulo `6`" (`specs/parts.md`), read here out of
// `parts.ts`'s `wheelFixture`.
//
// THE CONFIGURATION. A wheel on `(0, 0)` at rotation `2`, placed INTO the live run
// so its six fixtures appear on its spoke hexes ("a part one of them adds enters
// the run at its rest pose holding nothing, with a wheel's six fixtures on its
// spoke hexes", `specs/instrumentation.md`), with the empty tape a fresh placement
// carries — so every cycle's cell is blank. The ring is the whole of the world.
//
// THE ROTATION IS `2` RATHER THAN `0` ON PURPOSE: the ring the wheel holds through
// the cycle is one that had to be turned to be built, so a build that ignores a
// wheel's rotation when raising its fixtures is caught by the types the six hexes
// carry, and a build that quietly re-derives the ring each cycle from rotation `0`
// is caught by them changing.
//
// THE VERDICT. At every one of the cycle's eight sample fractions `k / 8`, and at
// the boundary, the wheel still reports rotation `2`, and each of the six fixtures
// — by ID — is still on its own hex, still drawn exactly on that hex's center by
// the formulas of `specs/field.md`, and still carrying the type the rotation gives
// its spoke.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { COLLISION_SAMPLES, FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter, neighbor } from "../field";
import { BARE } from "../fixtures";
import { wheelFixture } from "../parts";
import {
  advanceFraction,
  captureStill,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  poseOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The wheel's anchor and its rest rotation. */
const HUB = at(0, 0);
const ROTATION = 2;

/** The six spoke directions, in order. */
const SPOKES = [0, 1, 2, 3, 4, 5] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a resting wheel's rotation and all six of its fixtures for the cycle", async () => {
  await openBareRun(h, { challenge: BARE });

  // Placed into the live run, so its six fixtures appear on its spoke hexes.
  const wheel = await placePart(h, "wheel", HUB, ROTATION);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.motes ?? [],
    SPOKES.length,
    "the wheel's six fixtures are the whole of the field",
  );
  const ring = new Map<number, number>();
  for (const spoke of SPOKES) {
    const fixture = moteAt(posed, neighbor(HUB, spoke));
    assertNotNull(fixture, `a fixture stands on the wheel's spoke ${spoke}`);
    assertEqual(
      fixture?.type,
      wheelFixture(ROTATION, spoke),
      `the fixture on spoke ${spoke} is the WHEEL_MOTES entry for spoke minus the wheel's rotation, modulo 6`,
    );
    ring.set(spoke, fixture?.id ?? -1);
  }

  const readings: OrrerySnapshot[] = [];
  for (let k = 1; k <= COLLISION_SAMPLES; k += 1) {
    await advanceFraction(h, 1 / COLLISION_SAMPLES);
    readings.push(await h.snapshot());
  }
  await captureStill(h, "still");

  for (const [index, reading] of readings.entries()) {
    const where = `at sample ${index + 1} / ${COLLISION_SAMPLES} of the resting cycle`;
    assertNotNull(
      poseOf(reading, wheel),
      `the run reports the wheel's live pose ${where}`,
    );
    assertEqual(
      poseOf(reading, wheel)?.rotation,
      ROTATION,
      `a blank cell is a rest on a wheel, so it holds its rotation ${where}`,
    );
    for (const spoke of SPOKES) {
      const hex = neighbor(HUB, spoke);
      const fixture = moteById(reading, ring.get(spoke) ?? -1);
      assertNotNull(
        fixture,
        `the fixture from spoke ${spoke} is reported ${where}`,
      );
      assertEqual(
        `${fixture?.q},${fixture?.r}`,
        `${hex.q},${hex.r}`,
        `a resting wheel's fixture keeps its hex ${where}`,
      );
      assertNear(
        fixture?.x ?? Number.NaN,
        hexCenter(hex).x,
        DRAWN_TOLERANCE,
        `a resting wheel's fixture keeps its x, exactly on its hex center ${where}`,
      );
      assertNear(
        fixture?.y ?? Number.NaN,
        hexCenter(hex).y,
        DRAWN_TOLERANCE,
        `a resting wheel's fixture keeps its y, exactly on its hex center ${where}`,
      );
      assertEqual(
        fixture?.type,
        wheelFixture(ROTATION, spoke),
        `a resting wheel's fixture keeps the type its spoke carries ${where}`,
      );
    }
  }

  const boundary = readings[readings.length - 1] as OrrerySnapshot;
  assertEqual(
    boundary.sim?.status,
    "running",
    "a blank cell never faults, and a resting ring holds every distance in it",
  );
  assertEqual(
    boundary.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered, so the run really ran",
  );
});
