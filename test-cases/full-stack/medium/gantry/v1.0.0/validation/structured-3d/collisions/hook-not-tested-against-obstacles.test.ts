// collisions/hook-not-tested-against-obstacles — the bare hook standing inside an
// obstacle raises nothing.
//
// `specs/statics.md` § Collisions lists what each body is tested against, and the
// hook's row names one thing: "The hook | THE GROUND, and only while no load is
// attached." The three tests above the table — a member against obstacles, an
// attached load against obstacles and the ground, the hook against the ground —
// are "the whole of it", and no obstacle test on the hook is among them.
//
// So a bare hook is free to reach into a block, which is what lets a tape lower
// the hook past an obstacle's face to reach a load standing behind it. A build
// that tested the hook against obstacles as well would end such a run, and the
// only rule it could be reading is one the specification does not state. The
// hook's ONE test — the ground — is a separate point in both directions; this one
// is about the test it does not get.
//
// THE BOX HOLDS THE HOOK AND NOTHING ELSE. The trolley is posed three units along
// the track, so the pivot stands at `(3, 4, 0)` and the bob hangs at `(3, 2, 0)`
// on the run's starting two units of cable; the obstacle is the box `x 2.2..3.8`,
// `y 1.5..2.5`, `z -0.6..0.6`, which holds that point strictly inside on all three
// axes with room around it. Every member of the crane is either a tower member at
// `x <= 2`, outside the box on `x`, or an arm member at `y >= 4`, outside it on
// `y`, so nothing that IS tested against obstacles can reach inside — and the
// check reads the hook's position back to prove it really stood in there.
//
// The yard holds no load, so nothing is attached and the hook is bare; the tape
// turns the grip at the slowest legal rate, so the arm never sweeps.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the trolley is posed, so the hook hangs clear of the tower. */
const TROLLEY = 3;

/** Where the hook then stands, under the pivot on the run's starting cable. */
const HOOK = { x: 3, y: 2, z: 0 };

/** The box `x 2.2..3.8`, `y 1.5..2.5`, `z -0.6..0.6`, holding the hook inside. */
const OBSTACLE_MIN = { x: 2.2, y: 1.5, z: -0.6 };
const OBSTACLE_SIZE = { x: 1.6, y: 1, z: 1.2 };

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

/** One second of run clock with the hook standing inside the box. */
const TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing for a bare hook standing inside an obstacle", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, HOLD_TAPE);

  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  await h.debug.setBobVelocity(0, 0, 0);

  // One tick lets the geometry take the posed trolley, which is what carries the
  // pivot over the box; the bob is then stilled under its new pivot so the hook
  // rests inside the box rather than swinging out of it.
  await runTicks(h, 1);
  await h.debug.setBobVelocity(0, 0, 0);

  const held = await runTicks(h, TICKS);

  await h.capture("inside-the-box", "The bare hook standing inside the obstacle");

  const inside = (v: number, min: number, size: number): boolean =>
    v > min && v < min + size;
  assertNull(
    held.run.attached,
    "the attachment, so the body inside the box is the bare hook " +
      "(specs/statics.md)",
  );
  assertTrue(
    inside(held.run.bob.pos.x, OBSTACLE_MIN.x, OBSTACLE_SIZE.x) &&
      inside(held.run.bob.pos.y, OBSTACLE_MIN.y, OBSTACLE_SIZE.y) &&
      inside(held.run.bob.pos.z, OBSTACLE_MIN.z, OBSTACLE_SIZE.z),
    "the hook point standing strictly inside the box on all three axes, which " +
      "is the scenario this point is about (specs/world.md)",
  );
  assertEqual(
    held.run.phase,
    "running",
    `the run after ${TICKS} ticks with the bare hook standing inside an ` +
      "obstacle: the hook is tested against the ground alone " +
      "(specs/statics.md)",
  );
  assertNull(held.run.cause, "the cause of a run nothing tested raised");
});
