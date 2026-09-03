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
// TWO RUNS OF THE SAME SWING, one carrying the load on the hook and one leaving
// it standing in the yard, are what makes that readable. The pendulum tick reads
// "nothing but the pivot, the hoist length, and its own state"
// (specs/rigging.md § Determinism) — no mass appears anywhere in its seven steps
// — so the bob traces the same path in both runs, and the two pictures at the
// same tick differ by exactly one thing: whether the load is drawn at the bob.
// Comparing one run against itself at two ticks could not tell a load drawn at
// the bob from a hook drawn at the bob, and comparing against a picture with no
// load in the world at all would not be the same world.
//
// THE SAMPLES ARE FOUR PLACES ALONG THE ARC, each posed and then earned by a real
// tick. Where on its cable the bob hangs is a precondition — the pendulum takes
// the pose and the tick that follows is what puts the load's lift point on it — so
// the bob is put at each in turn rather than watched through a free swing. That is
// also what makes the reading sharp: consecutive places stand a long way apart, so
// a load painted at one fixed place, one animated on its own clock, or one drawn
// where the bob WAS a tick ago cannot answer for all four. Both runs are posed to
// the same place at each sample, so the two yards stand at the same bob.
//
// The rest of the staging is the same as every run reading in this category: Over
// the Wall's own crane on its own site, the yard emptied to nothing but one load,
// and a tape slow enough that nothing else moves while the readings are taken. The
// trolley is run out and the cable let down by POSE, with the bob put straight back
// under where that leaves the pivot in the same breath, so the pendulum's
// pivot-velocity step (specs/rigging.md, step 5) takes the jump as the still hang
// it is rather than as a jolt.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  DESIGNS,
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Over the Wall, whose crane carries its track at `y = 12`: room to swing. */
const SITE = 2;

const CLASS = "crate";
const MASS = 10;
const START = { x: -6, y: 2, z: 6, yaw: 0 } as const;

/**
 * Where the trolley is run out to, the cable the load swings on, and the node the
 * pair leaves the pivot on.
 *
 * The crane's track runs from `(0, 12, 0)` out along `+x` to `(10, 12, 0)`, so the
 * track's origin is `(0, 12, 0)` and the trolley's distance along it is its `x`.
 */
const TROLLEY = 8;
const HOIST = 6;
const NODE = { x: 8, y: 12, z: 0 } as const;

/**
 * The places along the arc the load is read at, in degrees off the vertical.
 *
 * Four, spread wide enough that the bob travels a long way through the world
 * between them, and all on the same side of the tower so the crate hangs in open
 * air at every one of them.
 */
const ARC = [-45, -15, 15, 45] as const;

/** How far the bob has to travel between samples, in world units. */
const SEPARATION = 1;

/** How far the two runs' bobs may stand apart, in world units. */
const SAME_SWING = 0.01;

/** The tape: a slew slow enough that nothing moves while the readings are taken. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

/**
 * Slack on a corner of the load's box, in world units.
 *
 * A build models its own crate (specs/assets.md) and is free to bevel or inset
 * it, so the body it draws need not reach a mathematical corner exactly. A third
 * of a unit is that slack, and a sixth of the crate's own side.
 */
const TOLERANCE = 0.35;
/** How many of the eight box corners must carry the load at each sample. */
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
    const material = (object as THREE.Mesh).material as
      | Partial<THREE.MeshStandardMaterial>
      | undefined;
    found.push({
      signature: [
        object.type,
        object.visible ? "1" : "0",
        box.min
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
        box.max
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
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

/** Where the bob hangs `degrees` off the vertical on a cable from `pivot`. */
function onArc(
  pivot: { x: number; y: number; z: number },
  degrees: number,
): { x: number; y: number; z: number } {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: pivot.x + HOIST * Math.sin(radians),
    y: pivot.y - HOIST * Math.cos(radians),
    z: pivot.z,
  };
}

/** The eight corners of the crate's box, given its lift point. */
function boxCorners(lift: {
  x: number;
  y: number;
  z: number;
}): { x: number; y: number; z: number }[] {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const corners: { x: number; y: number; z: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const dy of [0, -size.y]) {
        corners.push({
          x: lift.x + (sx * size.x) / 2,
          y: lift.y + dy,
          z: lift.z + (sz * size.z) / 2,
        });
      }
    }
  }
  return corners;
}

/**
 * Stand the crane up and pose the arm where the readings are taken from: the
 * trolley out along the track, the cable let down, and the bob hanging straight
 * back under where that leaves the pivot, with the load on the hook or standing
 * in the yard.
 */
async function stageSwing(harness: Harness, carry: boolean): Promise<void> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await poseCrane(harness, DESIGNS[SITE]!);
  await addOneLoad(harness, CLASS, MASS, START, START);
  await poseTape(harness, TAPE);
  await startRun(harness);

  await harness.debug.setAxis("trolley", TROLLEY);
  await harness.debug.setAxis("hoist", HOIST);
  await harness.debug.setBob(NODE.x, NODE.y - HOIST, NODE.z);
  await harness.debug.setBobVelocity(0, 0, 0);
  if (carry) await harness.debug.setLoadPhase(0, "attached");
  await harness.advance(1);
}

/** Put a harness's bob at `to`, at rest, and run the tick that answers for it. */
async function poseBob(
  harness: Harness,
  to: { x: number; y: number; z: number },
) {
  await harness.debug.setBob(to.x, to.y, to.z);
  await harness.debug.setBobVelocity(0, 0, 0);
  return runTicks(harness, 1);
}

let h: Harness;
let control: Harness;

beforeEach(async () => {
  h = await createHarness();
  control = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  await control.dispose();
});

it("draws the load at the bob at every tick of a swing", async () => {
  await stageSwing(h, true);
  await stageSwing(control, false);

  assertEqual(
    (await h.snapshot()).run.loads[0]?.phase,
    "attached",
    "the load's phase in the run this reading is of " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    (await control.snapshot()).run.loads[0]?.phase,
    "waiting",
    "the load's phase in the run this reading is compared against, which " +
      "carries the same load in the same yard and leaves it standing",
  );

  let pivot = (await h.snapshot()).run.pivot;
  let previous: { x: number; y: number; z: number } | null = null;
  for (const [sample, degrees] of ARC.entries()) {
    // The pose puts the bob on its cable; the tick that follows is what carries
    // the load's lift point onto it. Both runs are posed to the same place.
    const to = onArc(pivot, degrees);
    const swung = await poseBob(h, to);
    const alone = await poseBob(control, to);
    pivot = swung.run.pivot;
    assertEqual(
      swung.run.phase,
      "running",
      `the run at sample ${sample + 1}, ${swung.run.tick} ticks in, which ` +
        "this reading needs still under way",
    );
    assertEqual(
      alone.run.phase,
      "running",
      `the compared run at sample ${sample + 1}, which carries the same load ` +
        "and is not holding it",
    );
    assertTrue(
      distance3(swung.run.bob.pos, alone.run.bob.pos) <= SAME_SWING,
      `the two runs' bobs to stand together at sample ${sample + 1}: the ` +
        "pendulum reads nothing but the pivot, the hoist length and its own " +
        "state, so a load on the hook does not move it (specs/rigging.md " +
        `§ Determinism) — they stand ${distance3(
          swung.run.bob.pos,
          alone.run.bob.pos,
        ).toFixed(3)} apart`,
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

    // The two yards at the same tick. They hold the same crane on the same
    // site over the same swing, so every body but the load's stands in both,
    // and what parts them is where the load is drawn.
    const parted = changedBodies(bodies(h), bodies(control));
    if (sample === ARC.length - 1) {
      await h.capture("swing", "The load drawn at the bob across the swing");
    }

    const carried = boxCorners(bob).filter(
      (corner) => changedNear(parted, corner, TOLERANCE) > 0,
    ).length;
    assertGreaterThan(
      carried,
      MOST - 1,
      `the corners of the crate's box at the bob at sample ${sample + 1}, ` +
        `tick ${swung.run.tick} — (${bob.x.toFixed(2)}, ` +
        `${bob.y.toFixed(2)}, ${bob.z.toFixed(2)}) — that the run carrying ` +
        "the load draws differently from the run leaving it standing, out of " +
        "8: an attached load's lift point is the bob's position at every " +
        "tick, so its swing is drawn true to the simulation " +
        "(specs/rigging.md § The pivot and the bob, specs/overview.md " +
        "§ Visual design)",
    );
  }
});
