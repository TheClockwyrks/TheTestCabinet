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
// THE STAGE READ IS THE FACE OF THE DRUM ITSELF, on the slew axis and halfway
// between the flanges. It is measured off the build's own projection of that
// axis: the two flange levels are projected, and the patch is centred between
// them and sized as a fraction of the gap they leave. That keeps it on the drum
// whatever the camera does with it, and off everything else — the tower's members
// stop at the bottom flange and the arm's start at the top one, both a full
// lattice node out from the axis, and the carriage, the cable and the hook are
// four units away along the track.
//
// AND A PATCH OF EMPTY YARD IS READ BESIDE IT, across the yard from the crane and
// square to the camera, where the arm reaches at neither angle. It has to come
// back unchanged: that is what tells a ring that turned from a build that redraws
// the whole stage between two ticks.
//
// THE BOB IS CARRIED ROUND WITH THE ARM. specs/structure.md has the ring turn
// "the top flange about the slew axis by the slew angle" and take "the whole arm
// with it", so posing a slew angle moves the carriage the cable hangs from, and a
// bob left where it was would hang from a cable stretched past the length the
// hoist axis is set to — which specs/statics.md ends the run for. So the bob is
// posed under the carriage's turned position, computed from the same rule, and
// the run is read back as still running.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import {
  CAMERA_PITCH_MIN,
  CAMERA_START_YAW,
  GRIP_MAX_RATE,
  HOIST_START,
  LATTICE_PITCH,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  clearAll,
  createHarness,
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
 * The patch of the drum's face this point reads.
 *
 * Vertically it is the lower middle of the ring: the stage between where the
 * build draws the slew axis a tenth of the way up from the bottom flange and
 * halfway up. That is barrel at both ends and reaches neither flange — which
 * matters, because the camera stands above the arm and a member at the top flange
 * that swings toward the camera is drawn lower than one that swings away.
 * Horizontally the patch takes this share of the flange-to-flange gap either side
 * of the axis, which on a ring of the "about `2.5 x 2 x 2.5` units"
 * specs/assets.md asks for stays well inside the barrel and well clear of the
 * flange corners the members run to.
 */
const PATCH_LOW = 0.1;
const PATCH_HIGH = 0.5;
const PATCH_HALF_WIDTH = 0.3;

/** The angle the arm is swung to, and the one it starts at. */
const REST = 0;
const SWUNG = 37;

/** The carriage, parked at the far end of the track, out of the ring's column. */
const TROLLEY_AT = 4;
const CARRIAGE: Vec3 = { x: 4, y: 4, z: 0 };

/**
 * The camera this point reads the ring from: the start yaw, the lowest pitch the
 * player can orbit to, and close enough that the ring's own barrel is tens of
 * pixels tall.
 *
 * specs/controls.md bounds the orbit at `CAMERA_PITCH_MIN` and `CAMERA_DIST_MIN`,
 * and specs/instrumentation.md's `setCamera` poses one inside those bounds, so
 * this is a view the player can take. Looking along the yard rather than down on
 * it is what keeps the arm — every member of which stands at or above the top
 * flange — off the drum's face, whatever angle the arm is swung to.
 */
const VIEW_DIST = 20;

/** A patch of empty yard the arm reaches at neither angle. */
const CONTROL: Vec3 = { x: -8, y: 3, z: 8 };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ring turned by the slew angle", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await h.debug.setCamera(CAMERA_START_YAW, CAMERA_PITCH_MIN, VIEW_DIST);
  await startRun(h);
  await park(REST);

  const barrel = await columnRegion();
  const control = await boxRegion(CONTROL);
  const atRest = {
    ring: await shot(barrel),
    yard: await shot(control),
  };

  await park(SWUNG);
  await h.capture("slew", "The ring at slew 0 and slew 37");

  const swungYard = await shot(control);
  assertTrue(
    atRest.yard.equals(swungYard),
    `the patch of empty yard at (${CONTROL.x}, ${CONTROL.y}, ${CONTROL.z}), ` +
      "which the arm reaches at neither angle, to be drawn the same at slew " +
      `${REST} and slew ${SWUNG} — otherwise what changes over the ring says ` +
      "nothing about the ring",
  );

  const swungRing = await shot(barrel);
  assertTrue(
    !atRest.ring.equals(swungRing),
    "the ring to be drawn turned by the slew angle, so the face of its drum " +
      `is drawn differently at slew ${SWUNG} from at slew ${REST} — a ring ` +
      "standing fixed while the arm swings around it is drawn identically at " +
      "both (specs/assets.md, specs/structure.md)",
  );
});

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

/** Where the build draws the drum's face: on the slew axis, between the flanges. */
async function columnRegion(): Promise<Rect> {
  const onAxis = async (share: number, what: string) =>
    on({ x: AXIS.x, y: CORNER.y + share * LATTICE_PITCH, z: AXIS.z }, what);
  const bottom = await onAxis(0, "the slew axis at the ring's bottom flange");
  const top = await onAxis(1, "the slew axis at the ring's top flange");
  const low = await onAxis(
    PATCH_LOW,
    "the slew axis just above the bottom flange",
  );
  const high = await onAxis(PATCH_HIGH, "the slew axis halfway up the ring");
  const gap = Math.abs(bottom.y - top.y);
  if (gap < 8) {
    fail(
      "the ring's two flange levels to be drawn far enough apart on the stage " +
        "for the barrel between them to be read, which the posed camera puts " +
        "them at (specs/instrumentation.md)",
      `they are ${gap.toFixed(1)} logical pixels apart`,
    );
  }
  return {
    x: (low.x + high.x) / 2 - PATCH_HALF_WIDTH * gap,
    y: Math.min(low.y, high.y),
    width: 2 * PATCH_HALF_WIDTH * gap,
    height: Math.abs(low.y - high.y),
  };
}

/** Where the build draws one world point, insisting that it draws it at all. */
async function on(at: Vec3, what: string): Promise<{ x: number; y: number }> {
  const point = await h.project(at.x, at.y, at.z);
  assertTrue(
    point.visible,
    `${what}, (${at.x}, ${at.y}, ${at.z}), to be drawn on the stage at the ` +
      "start camera pose, so this point has a picture to read " +
      "(specs/instrumentation.md)",
  );
  return point;
}

/** Where the build says a two-unit box around `at` is drawn. */
async function boxRegion(at: Vec3): Promise<Rect> {
  const corners: Vec3[] = [];
  for (const dx of [-1, 1]) {
    for (const dy of [-1, 1]) {
      for (const dz of [-1, 1]) {
        corners.push({ x: at.x + dx, y: at.y + dy, z: at.z + dz });
      }
    }
  }
  return hull(corners, "the patch of yard");
}

/** The stage those world points occupy, through the build's own projection. */
async function hull(corners: readonly Vec3[], what: string): Promise<Rect> {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const at of corners) {
    const on = await h.project(at.x, at.y, at.z);
    assertTrue(
      on.visible,
      `the corner (${at.x}, ${at.y}, ${at.z}) of ${what} to be drawn on the ` +
        "stage at the start camera pose, so this point has a picture to read " +
        "(specs/instrumentation.md)",
    );
    left = Math.min(left, on.x);
    right = Math.max(right, on.x);
    top = Math.min(top, on.y);
    bottom = Math.max(bottom, on.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A logical rectangle of the page's composited frame, as PNG bytes. */
async function shot(rect: Rect): Promise<Buffer> {
  const fit = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");
  const sx = fit!.width / STAGE_W;
  const sy = fit!.height / STAGE_H;
  return h.page.screenshot({
    clip: {
      x: fit!.x + rect.x * sx,
      y: fit!.y + rect.y * sy,
      width: Math.max(1, rect.width * sx),
      height: Math.max(1, rect.height * sy),
    },
  });
}
