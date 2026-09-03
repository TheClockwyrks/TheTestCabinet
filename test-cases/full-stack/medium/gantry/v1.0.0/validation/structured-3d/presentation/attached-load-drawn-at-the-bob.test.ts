// presentation/attached-load-drawn-at-the-bob — an attached load is drawn hanging
// at the bob.
//
// specs/rigging.md § The pivot and the bob: "What hangs at its end is the bob:
// the hook alone, of mass `HOOK_MASS`, or the hook with the attached load...
// THE HOOK POINT AND THE ATTACHED LOAD'S LIFT POINT ARE BOTH THE BOB'S POSITION."
// specs/overview.md § Visual design says what that has to look like: "An attached
// load VISIBLY HANGS FROM THE HOOK on its cable, and its swing is drawn true to
// the simulation."
//
// So the one requirement here is that attaching MOVES the drawn load: it is drawn
// at the bob, and it is no longer standing at the pose it started from. Both
// halves are read, because a build that drew the load twice — once on the hook
// and once where it stood — reads as wrongly as one that left it behind.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills, every one of its vertices, and the base colour
// of the material it is drawn with, in world units. `engine/rendering.md` fixes
// that the pipeline collects every enabled, visible render component on every
// live actor and draws it, so any build of this case that puts something on
// screen puts it there.
//
// NOTHING IS FOUND BY NAME. What a build calls an object and which component it
// reaches for are the build's; what a check finds one by is WHERE IT IS.
//
// AND THE LOAD IS FOUND BY ITS OWN MODEL. specs/assets.md commits one produced
// model per load class and has the game draw "each load at its pose, waiting,
// hanging, or placed", so `drawnFromModel` answers where the crate's own file is
// placed — which is what makes "the load" a thing this check can point at rather
// than a guess about which object in the yard is which.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  DESIGNS,
  addOneLoad,
  clearAll,
  createHarness,
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

/** Over the Wall, whose crane carries its track high: room to hang a load. */
const SITE = 2;

/** The one load, and the file specs/assets.md names for its class. */
const CLASS = "crate" as const;
const MODEL = "models/crate.glb";
const MASS = 10;
const START: LoadPose = { x: -6, y: 2, z: 6, yaw: 0 };

/** Where the trolley is run out to, and the cable the hook hangs on. */
const TROLLEY = 8;
const HOIST = 6;

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

/** Whether any placement of the load's model covers `at`. */
async function drawnAt(at: Vec3): Promise<boolean> {
  const boxes = (await drawnFromModel(h, MODEL)).map((one) =>
    drawnModelBox(one),
  );
  return boxes.some(
    (box) =>
      box !== null &&
      at.x >= box.min.x - SLACK &&
      at.x <= box.max.x + SLACK &&
      at.y >= box.min.y - SLACK &&
      at.y <= box.max.y + SLACK &&
      at.z >= box.min.z - SLACK &&
      at.z <= box.max.z + SLACK,
  );
}

it("draws the attached load at the bob and not where it stood", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, DESIGNS[SITE]!);
  await addOneLoad(h, CLASS, MASS, START, START);
  await poseTape(h, TAPE);
  await startRun(h);

  // Driven in one span and then a tick at a time: the move is `TROLLEY` units
  // at rate 4 with an acceleration of 4 (specs/program.md), which cannot be
  // over inside two seconds however a build ramps it, and the sweep that
  // follows fails the item if it never arrives.
  await runTicks(h, RUN_OUT);
  const out = await runUntil(
    h,
    (s) => s.run.axes.trolley.value >= TROLLEY - 1e-9,
    300,
    `the trolley to run out to ${TROLLEY}`,
  );
  const pivot = out.run.pivot;
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setBob(pivot.x, pivot.y - HOIST, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(2);

  const hanging = await h.snapshot();
  assertEqual(
    hanging.run.phase,
    "running",
    "the run this reading is taken during (specs/program.md)",
  );
  assertEqual(
    hanging.run.loads[0]?.phase,
    "waiting",
    "the load's phase before this point attaches it (specs/world.md)",
  );
  assertTrue(
    await drawnAt(middleOf(START)),
    "the load drawn at the pose it starts from before it is attached, which " +
      "is what the second half of this reading is measured against " +
      "(specs/assets.md)",
  );

  await h.debug.setLoadPhase(0, "attached");
  await h.advance(1);
  await h.capture("hanging", "The load hanging at the bob");

  const attached = await h.snapshot();
  assertEqual(
    attached.run.loads[0]?.phase,
    "attached",
    "the load's phase once this point attaches it " +
      "(specs/instrumentation.md)",
  );
  const bob = attached.run.bob.pos;

  assertTrue(
    await drawnAt(middleOf(bob)),
    `the load drawn at the bob, (${bob.x.toFixed(2)}, ${bob.y.toFixed(2)}, ` +
      `${bob.z.toFixed(2)}), once it is on the hook: "the hook point and the ` +
      "attached load's lift point are both the bob's position\" " +
      '(specs/rigging.md) and "an attached load visibly hangs from the hook ' +
      'on its cable" (specs/overview.md)',
  );
  assertTrue(
    !(await drawnAt(middleOf(START))),
    `no load left drawn at the pose it stood in, (${START.x}, ${START.y}, ` +
      `${START.z}), once it hangs at the bob: it is drawn at its pose, and an ` +
      "attached load's pose is the bob's (specs/rigging.md, specs/assets.md)",
  );
});
