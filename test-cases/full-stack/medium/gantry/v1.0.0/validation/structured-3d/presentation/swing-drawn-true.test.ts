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
// FOUR PLACES ALONG THE ARC, each posed and then earned by a real tick. Where on
// its cable the bob hangs is a precondition — the pendulum takes the pose and the
// tick that follows is what puts the load's lift point on it — so the bob is put
// at each in turn rather than watched through a free swing. That is also what
// makes the reading sharp: consecutive places stand a long way apart in the yard,
// so a load drawn at one fixed place, animated on its own clock, or drawn where
// the bob WAS a tick ago cannot answer for all four.
//
// The trolley is run out and the cable let down by POSE, with the bob put straight
// back under where that leaves the pivot in the same breath, so the pendulum's
// pivot-velocity step (specs/rigging.md, step 5) takes the jump as the still hang
// it is rather than as a jolt.
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

/**
 * Where the trolley is run out to, the cable the load swings on, and the node the
 * pair leaves the pivot on.
 *
 * The crane's track runs from `(0, 12, 0)` out along `+x` to `(10, 12, 0)`, so the
 * track's origin is `(0, 12, 0)` and the trolley's distance along it is its `x`.
 */
const TROLLEY = 8;
const HOIST = 6;
const NODE: Vec3 = { x: 8, y: 12, z: 0 };

/**
 * The places along the arc the load is read at, in degrees off the vertical.
 *
 * Four, spread wide enough that the bob travels a long way through the yard
 * between them, and all on the same side of the tower so the crate hangs in open
 * air at every one of them.
 */
const ARC = [-45, -15, 15, 45] as const;

/** How far the bob has to travel between samples, in world units. */
const SEPARATION = 0.5;

/** The tape: a slew slow enough that nothing moves while the readings are taken. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

/** How far outside the box a model fills the point it is drawn at may stand. */
const SLACK = 0.25;

/** Where the bob hangs `degrees` off the vertical on a cable from `pivot`. */
function onArc(pivot: Vec3, degrees: number): Vec3 {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: pivot.x + HOIST * Math.sin(radians),
    y: pivot.y - HOIST * Math.cos(radians),
    z: pivot.z,
  };
}

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

  // The trolley out along the track and the cable let down, with the bob put back
  // under where that leaves the pivot so the pendulum takes no jolt from the jump.
  await h.debug.setAxis("trolley", TROLLEY);
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setBob(NODE.x, NODE.y - HOIST, NODE.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setLoadPhase(0, "attached");
  let state = await runTicks(h, 1);
  assertEqual(
    state.run.phase,
    "running",
    "the run this reading is taken in, once the arm stands where the readings " +
      "are taken from",
  );
  assertEqual(
    state.run.loads[0]?.phase,
    "attached",
    "the load's phase in the run this reading is of " +
      "(specs/instrumentation.md)",
  );

  let previous: Vec3 | null = null;
  for (const [sample, degrees] of ARC.entries()) {
    // The pose puts the bob on its cable; the tick that follows is what carries
    // the load's lift point onto it.
    const to = onArc(state.run.pivot, degrees);
    await h.debug.setBob(to.x, to.y, to.z);
    await h.debug.setBobVelocity(0, 0, 0);
    const swung = await runTicks(h, 1);
    state = swung;
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
