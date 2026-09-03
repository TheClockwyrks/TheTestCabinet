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
// THE SCENARIO IS POSED, NOT PLAYED TO. The smallest crane that stands is stood
// up on the shortest site with the yard emptied of everything but one load, so
// nothing but the crane, the ground and that load is in the yard, and the tape is
// a single slew so slow that nothing moves measurably while the readings are
// taken — which is what keeps the run running rather than ending on an exhausted
// tape.
//
// NOTHING IS DRIVEN TO GET THE HOOK CLEAR OF THE TOWER. An earlier form of this
// point ran the trolley out along the track first, which cost two hundred ticks
// of simulation and made this reading depend on the trolley controller, an axis
// this point has nothing to say about. The cable is posed instead: `setAxis` sets
// the hoist to the length the cable is to hold, and `setBob` "puts the bob where
// it is asked for", so the hook is hung LEANING — `HOIST` units from the pivot,
// out over the empty quarter of the yard — and the crate that hangs on it stands
// clear of the tower, of the ground, and of the pose it starts from. A cable at
// an angle is a precondition like any other; what happens next still comes from
// advancing the real simulation.
//
// `setLoadPhase(0, "attached")` then "hangs that load on the hook exactly as a
// successful `attach` leaves it". A frame is advanced before the second reading,
// because a pose "establishes a precondition and never an outcome".
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
  addOneLoad,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type LoadPose,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** Site 1, First Lift: the shortest site, and the minimal crane stands on it. */
const SITE = 0;

/** The one load, and the file specs/assets.md names for its class. */
const CLASS = "crate" as const;
const MODEL = "models/crate.glb";
const MASS = 10;
/** Where it stands: clear of the crane, and a long way from the hook. */
const START: LoadPose = { x: -6, y: 2, z: 6, yaw: 0 };

/** The minimal crane's pivot at the run-start posture: its track origin. */
const PIVOT = { x: 0, y: 4, z: 0 } as const;

/**
 * Where the hook is hung, and the cable length that reaches it.
 *
 * `BOB` is a point of the open yard: the crate that hangs there — two units on a
 * side, its box extending half its width and half its depth horizontally from the
 * lift point and its full height below it (specs/world.md § Loads) — spans `x`
 * from `3` to `5`, `z` from `-5` to `-3` and `y` from `0.5` to `2.5`, so it stands
 * clear of the tower, clear of the track, half a unit clear of the ground, and a
 * long way from the pose the load starts from. `HOIST` is exactly the distance
 * from the pivot to it, because "a caller that wants a bob the cable can hold sets
 * the hoist axis to the distance it left between the pivot and the bob"
 * (specs/instrumentation.md).
 */
const BOB = { x: 4, y: 2.5, z: -4 } as const;
const HOIST = Math.hypot(BOB.x - PIVOT.x, PIVOT.y - BOB.y, BOB.z - PIVOT.z);

/** The tape: one slew too slow to move anything, so the run keeps running. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

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
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, CLASS, MASS, START, START);
  await poseTape(h, TAPE);
  await startRun(h);

  // The cable is posed rather than driven to: the hoist is set to the length the
  // cable holds and the bob is put at that distance from the pivot, leaning out
  // over the empty quarter of the yard, at rest. Two frames run before anything
  // is read, because a pose is a precondition and the constraint, the tension and
  // the solves are the simulation's own answer to it.
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
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
