// presentation/swing-drawn-true — the drawn load follows the bob the pendulum
// computes.
//
// specs/overview.md § Visual design: "An attached load visibly hangs from the
// hook on its cable, and ITS SWING IS DRAWN TRUE TO THE SIMULATION."
// specs/rigging.md § The pivot and the bob fixes what "true" means: "The hook
// point and the attached load's lift point are both the bob's position", and
// § The pendulum tick gives the bob a position updated every tick. So the
// requirement is that at every tick of a swing the load is drawn where the
// pendulum has put the bob — not near it, not lagging behind it on an animation
// of the build's own.
//
// FOUR SAMPLES THROUGH ONE SWING, spread far enough apart that the bob has
// travelled a long way in the yard between them: a load painted at one place
// cannot answer for four of them, and one that lagged a tick behind is drawn
// where the bob WAS rather than where it is.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw. specs/assets.md commits one produced model per load class and has the
// game draw "each load at its pose, waiting, hanging, or placed", so
// `drawnFromModel` answers where the crate's own file is placed and
// `drawnModelBox` answers the box that placement fills. The bob is read off the
// run itself, so what the drawing is held to is the build's own pendulum rather
// than one this file worked out.
//
// AND THE POSE IS READ ON THE SAME FRAME IT IS DRAWN ON. `refreshViews` and every
// equivalent runs inside the frame, so the reading is taken after the tick and
// before anything else is posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  DESIGNS,
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  drawnFromModel,
  drawnModelBox,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  runUntil,
  startRun,
  type Harness,
  type LoadPose,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** Over the Wall, whose crane carries its track at `y = 12`: room to swing. */
const SITE = 2;

/** The one load, and the file specs/assets.md names for its class. */
const CLASS = "crate" as const;
const MODEL = "models/crate.glb";
const MASS = 10;
const START: LoadPose = { x: -6, y: 2, z: 6, yaw: 0 };

/** Where the trolley is run out to, and the cable the load swings on. */
const TROLLEY = 8;
const HOIST = 6;

/** How far off the vertical the bob is released, in degrees. */
const RELEASE = 45;

/** The samples: four of them, this many ticks apart. */
const SAMPLES = 4;
const STRIDE = 25;

/** How far the bob has to travel between samples, in world units. */
const SEPARATION = 0.5;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "trolley", target: TROLLEY, rate: 4 }] },
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

/** Ticks driven in one span before the sweep that waits for the trolley. */
const RUN_OUT = 120;

/** How far outside the box a model fills the point it is drawn at may stand. */
const SLACK = 0.25;

/** The middle of a load's class box, hanging under its lift point. */
function middleOf(pose: { x: number; y: number; z: number }): Vec3 {
  return {
    x: pose.x,
    y: pose.y - LOAD_CLASS_DIMENSIONS[CLASS].y / 2,
    z: pose.z,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the load at the bob at every tick of a swing", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, DESIGNS[SITE]!);
  await addOneLoad(h, CLASS, MASS, START, START);
  await poseTape(h, TAPE);
  await startRun(h);

  await runTicks(h, RUN_OUT);
  const out = await runUntil(
    h,
    (s) => s.run.axes.trolley.value >= TROLLEY - 1e-9,
    300,
    `the trolley to run out to ${TROLLEY}`,
  );
  const pivot = out.run.pivot;
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setLoadPhase(0, "attached");
  // Released from rest, `RELEASE` degrees off the vertical, on a cable of the
  // length the hoist axis is holding: a bob the constraint can keep.
  const radians = (RELEASE * Math.PI) / 180;
  await h.debug.setBob(
    pivot.x + HOIST * Math.sin(radians),
    pivot.y - HOIST * Math.cos(radians),
    pivot.z,
  );
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).run.loads[0]?.phase,
    "attached",
    "the load's phase in the run this reading is of " +
      "(specs/instrumentation.md)",
  );

  let previous: Vec3 | null = null;
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const swung = await runTicks(h, STRIDE);
    assertEqual(
      swung.run.phase,
      "running",
      `the run at sample ${sample + 1}, ${swung.run.tick} ticks in, which ` +
        "this reading needs still under way",
    );

    const bob = swung.run.bob.pos;
    if (previous !== null) {
      assertGreaterThan(
        distance3(bob, previous),
        SEPARATION,
        `the world units the bob travelled between sample ${sample} and ` +
          `sample ${sample + 1}, which this reading needs so that a load ` +
          "drawn at one place cannot answer for two of them",
      );
    }
    previous = bob;

    const at = middleOf(bob);
    const boxes = (await drawnFromModel(h, MODEL)).map((one) =>
      drawnModelBox(one),
    );
    assertTrue(
      boxes.some(
        (box) =>
          box !== null &&
          at.x >= box.min.x - SLACK &&
          at.x <= box.max.x + SLACK &&
          at.y >= box.min.y - SLACK &&
          at.y <= box.max.y + SLACK &&
          at.z >= box.min.z - SLACK &&
          at.z <= box.max.z + SLACK,
      ),
      `the load drawn at the bob at sample ${sample + 1}, ` +
        `(${bob.x.toFixed(2)}, ${bob.y.toFixed(2)}, ${bob.z.toFixed(2)}): ` +
        'its swing is "drawn true to the simulation" (specs/overview.md) and ' +
        "the attached load's lift point IS the bob's position " +
        `(specs/rigging.md). It is drawn at ${JSON.stringify(
          boxes.map((box) => box?.centre),
        )}`,
    );
  }

  await h.capture("swing", "The load at the bob through a swing");
});
