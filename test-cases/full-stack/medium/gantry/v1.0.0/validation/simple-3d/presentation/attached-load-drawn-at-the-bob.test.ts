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
// THE SCENARIO. Over the Wall's own crane is stood up on its own site with the
// yard emptied of everything but one load, so nothing but the crane, the ground
// and that load is in frame. The trolley is run out along the track BY THE TAPE
// rather than posed: `setAxis` would move the pivot a whole eight units inside
// one tick, and the pendulum reads the pivot's velocity as `(P - P_prev) / dt`
// (specs/rigging.md § The pendulum tick), so a posed jump is a real four-hundred-
// unit-a-second pivot and snaps the cable. The last step of the tape is a slew so
// slow that nothing moves measurably while the pictures are taken, which is what
// keeps the run running rather than ending on an exhausted tape.
//
// The hook is then settled hanging still at a length that leaves the load clear
// of the ground when it hangs — `setBob` "puts the bob where it is asked for, so
// a caller that wants a bob the cable can hold sets the hoist axis to the
// distance it left between the pivot and the bob" (specs/instrumentation.md) —
// and `setLoadPhase(0, "attached")` "hangs that load on the hook exactly as a
// successful `attach` leaves it". A frame is advanced before the second picture,
// because a pose "establishes a precondition and never an outcome".
//
// THE POINTS READ ARE THE CORNERS OF THE LOAD'S OWN BOX, at the bob and at the
// starting pose, in world units. A crate is `2 x 2 x 2` and a load pose is the
// pose of its lift point, the centre of its top face, so the box "extends half
// its width and half its depth horizontally from the lift point... and its full
// height below it" (specs/world.md § Loads). Most of those corners must have
// changed at each end: what a build draws a crate as is its own, and a corner or
// two of a produced model may sit inside its class box rather than on it.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertEqual, assertGreaterThan } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  DESIGNS,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  runUntil,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Over the Wall, whose crane carries its track at `y = 12`: room to hang. */
const SITE = 2;

/** The load: light, so the swing that follows loads the crane gently. */
const CLASS = "crate";
const MASS = 10;
/** Where it stands: clear of the arm, and well away from it on the stage. */
const START = { x: -6, y: 2, z: 6, yaw: 0 } as const;

/** Where the trolley is run out to, and the cable length the hook settles at. */
const TROLLEY = 8;
const HOIST = 6;

/** The tape: run the trolley out, then a slew too slow to move anything. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "trolley", target: TROLLEY, rate: 4 }] },
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

/** Ticks driven in one span before the sweep that waits for the trolley. */
const RUN_OUT = 120;

/**
 * Slack on a corner of the load's box, in world units.
 *
 * A build models its own crate (specs/assets.md) and is free to bevel or inset
 * it, so the body it draws need not reach a mathematical corner exactly. A third
 * of a unit is that slack, and a sixth of the crate's own side.
 */
const TOLERANCE = 0.35;
/** How many of the eight box corners have to have changed at each end. */
const MOST = 6;

/* -------------------------------------------------------------------------- */
/* Reading the yard                                                           */
/* -------------------------------------------------------------------------- */
//
// THIS ENGINE'S HALF OF THIS POINT IS WHERE THE PICTURE IS READ. Under this
// engine the yard is the engine's own retained scene — "what `render` added on
// one frame is still there on the next… this is what lets a check find an object
// by name and read its world position with no pixels involved" (`rendering.ts`)
// — and this process has no GPU, so the yard has no pixels at all. An engineless
// build owns its own renderer, so its version of this point photographs the page
// and reads colours at projected stage points; here the same question is asked in
// WORLD units, of the bodies the build put in the scene. That is the stronger
// reading of the two: a body drawn in the right part of the picture but in the
// wrong place in the world passes there and fails here.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.

/** One body the yard is drawn from, and where it stands in the world. */
interface Body {
  /** Everything about it a redraw would have to keep to be the same body. */
  signature: string;
  box: THREE.Box3;
}

/**
 * Every body the yard is drawn from, with its world extent.
 *
 * A body is anything the build put in the scene that occupies space — a mesh, a
 * line, a cloud of points. Lights and bare groups occupy none and are skipped:
 * they carry no extent for a reading about a place to be about.
 */
function bodies(harness: Harness): Body[] {
  const found: Body[] = [];
  harness.engine.scene.traverse((object) => {
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial> | undefined;
    found.push({
      signature: [
        object.type,
        object.visible ? "1" : "0",
        box.min.toArray().map((one) => one.toFixed(3)).join(),
        box.max.toArray().map((one) => one.toFixed(3)).join(),
        material?.color?.getHexString() ?? "",
        material?.emissive?.getHexString() ?? "",
        material?.opacity ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Every body one reading holds that the other does not, either way round. */
function changedBodies(
  before: readonly Body[],
  after: readonly Body[],
): Body[] {
  const tally = (read: readonly Body[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const body of read) {
      counts.set(body.signature, (counts.get(body.signature) ?? 0) + 1);
    }
    return counts;
  };
  const was = tally(before);
  const now = tally(after);
  return [
    ...after.filter(
      (body) => (now.get(body.signature) ?? 0) > (was.get(body.signature) ?? 0),
    ),
    ...before.filter(
      (body) => (now.get(body.signature) ?? 0) < (was.get(body.signature) ?? 0),
    ),
  ];
}

/** How many of `changed` reach within `radius` world units of `at`. */
function changedNear(
  changed: readonly Body[],
  at: { x: number; y: number; z: number },
  radius: number,
): number {
  const ball = new THREE.Sphere(new THREE.Vector3(at.x, at.y, at.z), radius);
  return changed.filter((body) => body.box.intersectsSphere(ball)).length;
}


/** The eight corners of a class's box, given its lift point (specs/world.md). */
function boxCorners(lift: {
  x: number;
  y: number;
  z: number;
}): { where: string; x: number; y: number; z: number }[] {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const corners: { where: string; x: number; y: number; z: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const dy of [0, -size.y]) {
        corners.push({
          where: `(${sx > 0 ? "+x" : "-x"}, ${dy === 0 ? "top" : "bottom"}, ${
            sz > 0 ? "+z" : "-z"
          })`,
          x: lift.x + (sx * size.x) / 2,
          y: lift.y + dy,
          z: lift.z + (sz * size.z) / 2,
        });
      }
    }
  }
  return corners;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

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
  const bob = hanging.run.bob.pos;

  const onHook = boxCorners(bob).map((corner) => ({
    ...corner,
    where: `${corner.where} of the box at the bob`,
  }));
  const onGround = boxCorners(START).map((corner) => ({
    ...corner,
    where: `${corner.where} of the box at the starting pose`,
  }));
  const before = bodies(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.advance(1);
  const after = bodies(h);
  const changed = changedBodies(before, after);
  await h.capture("hanging", "The load hanging at the bob");

  const carried = await h.snapshot();
  assertEqual(
    carried.run.loads[0]?.phase,
    "attached",
    "the load's phase once it is posed onto the hook " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    carried.run.phase,
    "running",
    "the run after the load was hung on the hook, which the pictures are of",
  );

  const changedAt = (
    corners: readonly { where: string; x: number; y: number; z: number }[],
  ): { where: string }[] =>
    corners.filter((corner) => changedNear(changed, corner, TOLERANCE) > 0);

  assertGreaterThan(
    changedAt(onHook).length,
    MOST - 1,
    `the corners of the crate's box at the bob (${bob.x.toFixed(2)}, ` +
      `${bob.y.toFixed(2)}, ${bob.z.toFixed(2)}) that attaching draws over, ` +
      `out of ${onHook.length}: an attached load's lift point is the bob's ` +
      "position and the load visibly hangs from the hook there " +
      "(specs/rigging.md § The pivot and the bob, specs/overview.md § Visual " +
      "design)",
  );

  assertGreaterThan(
    changedAt(onGround).length,
    MOST - 1,
    `the corners of the crate's box at the starting pose (${START.x}, ` +
      `${START.y}, ${START.z}) that attaching clears, out of ` +
      `${onGround.length}: a load on the hook hangs at the bob rather than ` +
      "standing where it started (specs/rigging.md § The pivot and the bob)",
  );
});
