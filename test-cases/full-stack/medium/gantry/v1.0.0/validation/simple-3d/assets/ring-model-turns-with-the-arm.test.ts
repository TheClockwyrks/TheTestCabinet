// assets/ring-model-turns-with-the-arm — the ring model is drawn turned by the
// slew angle.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: the ring centered on the slew axis between its flanges and turning with the
// arm …". specs/structure.md says what turning with the arm means: the ring "is a
// bearing … It turns the top flange about the slew axis by the slew angle and
// takes the whole arm with it", so the drawn ring follows the slew angle rather
// than standing fixed while the arm swings around it.
//
// THE READING IS THE SAME PAGE AT TWO SLEW ANGLES. Nothing about the yard, the
// crane or the camera changes between them: the run is posed still, the carriage
// is parked at the far end of the track with the bob hanging under it, and the
// only thing driven is `setAxis("slew", …)`.
//
// THIRTY-SEVEN DEGREES, NOT NINETY OR FORTY-FIVE. A model sculpted with `voxel`
// is a block of cubes at eight voxels to the unit, so it has at most a finite
// rotational symmetry, and a turn is invisible only when it lands exactly on one
// of that symmetry's steps. Ninety and forty-five are the two steps a squat
// bearing drum is most likely to be built with; thirty-seven is a step of no
// symmetry of order below three hundred and sixty, so any ring that turns at all
// is drawn differently at it.
//
// WHAT IS READ IS THE DRUM'S OWN BODY, AND THIS IS THIS ENGINE'S HALF OF THE
// POINT. Under this engine the yard is the engine's own retained scene — "what
// `render` added on one frame is still there on the next… this is what lets a
// check find an object by name and read its world position with no pixels
// involved" (`rendering.ts`) — and this process has no GPU, so there is no drum
// face to photograph. There is the body the build put in the scene for the ring,
// and a body turned about the slew axis stands differently in the world from one
// left square to it. So the reading is the column of yard over the flange square,
// between the two flange levels: the tower's members stop at the bottom flange
// and the arm's start at the top one, both a full lattice node out from the axis,
// so the ring's own body is the only thing wholly inside that column.
//
// AND THE REST OF THE YARD IS READ BESIDE IT. Everything the two angles have in
// common — the ground, the aids, the anchors and their fixtures, the tower below
// the ring — has to come back the same: that is what tells a ring that turned
// from a build that redraws the whole yard between two ticks. The ARM is not
// among them, because it turns with the ring by specification, so what is held
// still is what stands outside the arm's reach.
//
// THE BOB IS CARRIED ROUND WITH THE ARM. specs/structure.md has the ring turn
// "the top flange about the slew axis by the slew angle" and take "the whole arm
// with it", so posing a slew angle moves the carriage the cable hangs from, and a
// bob left where it was would hang from a cable stretched past the length the
// hoist axis is set to — which specs/statics.md ends the run for. So the bob is
// posed under the carriage's turned position, computed from the same rule, and
// the run is read back as still running.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertTrue, fail } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, LATTICE_PITCH } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** The minimal crane's ring, and the slew axis through its flange square. */
const CORNER = { x: 0, y: 2, z: 0 };
const AXIS = {
  x: CORNER.x + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};

/**
 * The column of yard the ring's own body stands in.
 *
 * specs/assets.md sizes the ring "about `2.5 x 2 x 2.5` units" and adds that the
 * part figures "are the intent, not a tolerance", so the column is allowed to be
 * wider than the intent: it reaches `1.75` from the axis and a third of a unit
 * past each flange. The tower's members stop at the bottom flange and the arm's
 * start at the top one, both a full lattice node out from the axis, so nothing
 * else is wholly inside it.
 */
const RADIUS = 1.75;
const OVERHANG = 0.35;

/** The angle the arm is swung to, and the one it starts at. */
const REST = 0;
const SWUNG = 37;

/** The carriage, parked at the far end of the track, out of the ring's column. */
const TROLLEY_AT = 4;
const CARRIAGE: Vec3 = { x: 4, y: 4, z: 0 };

/**
 * How far from the slew axis the arm can reach at any angle.
 *
 * The minimal crane's furthest arm node is the rail tip, `(4, 4, 0)`, which is
 * `Math.hypot(3, 1)` from the axis; a body standing further out than that plus a
 * unit of room for whatever is drawn on it is outside the arm's sweep at every
 * angle, so it is one of the bodies the two readings must agree on.
 */
const OUTSIDE_THE_SWEEP =
  Math.hypot(CARRIAGE.x - AXIS.x, CARRIAGE.z - AXIS.z) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ring turned by the slew angle", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await park(REST);

  const column = new THREE.Box3(
    new THREE.Vector3(AXIS.x - RADIUS, CORNER.y - OVERHANG, AXIS.z - RADIUS),
    new THREE.Vector3(
      AXIS.x + RADIUS,
      CORNER.y + LATTICE_PITCH + OVERHANG,
      AXIS.z + RADIUS,
    ),
  );
  const atRest = bodies(h);

  await park(SWUNG);
  await h.capture("slew", "The ring at slew 0 and slew 37");
  const swung = bodies(h);

  assertTrue(
    outside(atRest) === outside(swung),
    "everything standing outside the arm's own sweep — the ground, the aids, " +
      "the anchors and their fixtures — to be drawn the same at slew " +
      `${REST} and slew ${SWUNG}, since the ring turns the arm and nothing ` +
      "else (specs/structure.md); otherwise what changes over the ring says " +
      "nothing about the ring",
  );

  assertTrue(
    within(atRest, column) !== within(swung, column),
    "the ring to be drawn turned by the slew angle, so its body stands " +
      `differently at slew ${SWUNG} from at slew ${REST} — a ring standing ` +
      "fixed while the arm swings around it stands identically at both " +
      "(specs/assets.md, specs/structure.md)",
  );
});

/** One body the yard shows, and where it stands in the world. */
interface Body {
  signature: string;
  box: THREE.Box3;
}

/** Every body the yard SHOWS, with its world extent. */
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
    for (
      let node: THREE.Object3D | null = object;
      node !== null;
      node = node.parent
    ) {
      if (!node.visible) return;
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
        box.min
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
        box.max
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
        material?.color?.getHexString() ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Everything a reading holds wholly inside `box`, as one comparable value. */
function within(read: readonly Body[], box: THREE.Box3): string {
  return read
    .filter((body) => box.containsBox(body.box))
    .map((body) => body.signature)
    .sort()
    .join("\n");
}

/** Everything a reading holds outside the arm's own sweep, as one value. */
function outside(read: readonly Body[]): string {
  const axis = new THREE.Vector2(AXIS.x, AXIS.z);
  return read
    .filter((body) => {
      const centre = body.box.getCenter(new THREE.Vector3());
      const size = body.box.getSize(new THREE.Vector3());
      // A body whose whole extent stands further from the slew axis than the
      // arm reaches, and which is not a yard-spanning body the ground and the
      // sky are.
      if (Math.max(size.x, size.y, size.z) > 2 * OUTSIDE_THE_SWEEP)
        return false;
      const away = new THREE.Vector2(centre.x, centre.z).distanceTo(axis);
      return away - Math.max(size.x, size.z) / 2 > OUTSIDE_THE_SWEEP;
    })
    .map((body) => body.signature)
    .sort()
    .join("\n");
}

/** Pose the run still at one slew angle: the arm turned, everything at rest. */
async function park(slew: number): Promise<void> {
  const carriage = turned(CARRIAGE, slew);
  await h.debug.setAxis("slew", slew);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setBob(carriage.x, carriage.y - HOIST_START, carriage.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  if (Math.abs(run.axes.slew.value - slew) > 1e-6) {
    fail(
      `the slew axis to stand at ${slew} after it is posed there, which ` +
        "specs/instrumentation.md's `setAxis` establishes",
      `it reads ${run.axes.slew.value}`,
    );
  }
  if (run.phase !== "running") {
    fail(
      `the run to still be running with the arm at slew ${slew} and the bob ` +
        "hanging under the carriage it turned to, so this point reads a crane " +
        "standing rather than one coming down (specs/statics.md)",
      `it is "${run.phase}"` + (run.cause === null ? "" : ` (${run.cause})`),
    );
  }
}

/**
 * An arm node at slew `angle`.
 *
 * specs/structure.md: the ring "turns the top flange about the slew axis by the
 * slew angle and takes the whole arm with it, so an arm node stands at its
 * lattice position turned by that angle and nothing else moves it", and
 * specs/world.md fixes the sense of a yaw: "a positive yaw turns `+x` toward
 * `+z`".
 */
function turned(node: Vec3, angle: number): Vec3 {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = node.x - AXIS.x;
  const dz = node.z - AXIS.z;
  return {
    x: AXIS.x + dx * cos - dz * sin,
    y: node.y,
    z: AXIS.z + dx * sin + dz * cos,
  };
}
