// assets/hook-model-turned-to-the-grip — the hook block is drawn turned by the
// grip axis's value.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … the hook at the bob turned to the grip's yaw …". specs/program.md gives
// the grip as one of the four axes the tape drives, and specs/rigging.md has it
// turn nothing but the hook — "turning the grip applies no force to anything" —
// so the grip's value shows on screen in exactly one place: the yaw the hook
// block is drawn at.
//
// THE READING IS THE SAME PAGE AT TWO GRIP VALUES, with nothing else touched: the
// carriage is parked, the bob is posed under it on a cable of exactly the hoist
// axis's length and given no velocity, and the tape's one move is a grip command
// at a rate of a thousandth of a degree a second, which keeps the run running
// without turning anything itself.
//
// THIRTY-SEVEN DEGREES, NOT NINETY. A hook block sculpted with `voxel` at eight
// voxels to the unit is a block of cubes, so it has at most a finite rotational
// symmetry, and a turn is invisible only when it lands exactly on one of that
// symmetry's steps. Ninety is the step a block roughly square in plan is most
// likely to be built with — specs/assets.md sizes the hook `0.6 x 1 x 0.6` —
// and thirty-seven is a step of no symmetry of order below three hundred and
// sixty, so any hook that turns at all is drawn differently at it.
//
// THE CAMERA IS BROUGHT IN CLOSE. specs/assets.md sizes the hook at well under a
// unit, and at the start camera's `CAMERA_START_DIST` a unit is a few pixels of
// stage. `setCamera` poses a distance inside the bounds specs/controls.md gives
// the player, so this reads the hook from a view the player can take, with the
// block tens of pixels across.
//
// AND A PATCH OF EMPTY YARD IS READ BESIDE IT, across the yard and square to the
// camera. It has to come back unchanged: that is what tells a hook that turned
// from a build that redraws the whole stage between two ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import {
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  HOIST_START,
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

/**
 * The tape's one move, and why it is on the slew axis rather than the grip.
 *
 * The run has to still be running for the grip to be posed at all, so the tape
 * needs a step that never completes; and it cannot be a grip step, because
 * specs/instrumentation.md's `setAxis` sets an axis's value "leaving it stopped
 * with no live command", so posing the grip would finish a grip step and end the
 * run. The slew is unbounded (specs/program.md), so a slew target of a hundred
 * thousand degrees is in range and never arrives — and at a rate of a thousandth
 * of a degree a second, which specs/program.md accepts as "greater than `0` and
 * at most the axis's max", the arm turns by under a fifty-thousandth of a degree
 * between the two readings.
 */
const CRAWL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 100_000, rate: 0.001 }],
};

/** The carriage, and the bob hanging straight under it at the cable's length. */
const TROLLEY_AT = 4;
const BOB: Vec3 = { x: 4, y: 4 - HOIST_START, z: 0 };

/** The two grip values read, and how close the camera stands to read them. */
const REST = 0;
const TURNED = 37;
const VIEW_DIST = 20;

/**
 * How far around the bob the hook's own stage reaches.
 *
 * specs/assets.md sizes the hook "about `0.6 x 1 x 0.6` units" and says of the
 * part figures that they "are the intent, not a tolerance", so a box a unit each
 * way holds any block a build sculpts to that intent, while the carriage two
 * units above it and the crane four units away stay outside.
 */
const HALF = 1;

/** A patch of empty yard, square to the camera and clear of the crane. */
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

it("draws the hook turned by the grip axis's value", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [CRAWL]);
  await h.debug.setCamera(CAMERA_START_YAW, CAMERA_START_PITCH, VIEW_DIST);
  await startRun(h);

  const at = await park(REST);
  const block = await boxRegion(at, HALF, "the hook's block");
  const control = await boxRegion(CONTROL, 1, "the patch of yard");
  const square = {
    hook: await shot(block),
    yard: await shot(control),
  };

  const turnedAt = await park(TURNED);
  await h.capture("grip", "The hook at grip 0 and grip 37");

  assertTrue(
    Math.hypot(turnedAt.x - at.x, turnedAt.y - at.y, turnedAt.z - at.z) < 0.05,
    `the bob to stand where it stood, (${at.x.toFixed(2)}, ` +
      `${at.y.toFixed(2)}, ${at.z.toFixed(2)}), with only the grip axis ` +
      'posed — specs/rigging.md says turning the grip "applies no force to ' +
      "anything\", so what changes over the block is the block's own yaw",
  );

  assertTrue(
    square.yard.equals(await shot(control)),
    `the patch of empty yard at (${CONTROL.x}, ${CONTROL.y}, ${CONTROL.z}) to ` +
      `be drawn the same at grip ${REST} and grip ${TURNED} — otherwise what ` +
      "changes over the hook says nothing about the hook",
  );

  assertTrue(
    !square.hook.equals(await shot(block)),
    "the hook to be drawn turned to the grip's yaw, so the block at the bob " +
      `is drawn differently at grip ${TURNED} from at grip ${REST} — a hook ` +
      "drawn at a fixed yaw is drawn identically at both (specs/assets.md)",
  );
});

/** Pose the run still at one grip value, and answer where the bob stands. */
async function park(grip: number): Promise<Vec3> {
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setAxis("grip", grip);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  if (Math.abs(run.axes.grip.value - grip) > 0.5) {
    fail(
      `the grip axis to stand at ${grip} after it is posed there, which ` +
        "specs/instrumentation.md's `setAxis` establishes",
      `it reads ${run.axes.grip.value}`,
    );
  }
  if (run.phase !== "running") {
    fail(
      "the run to still be running with the bob parked under the carriage, so " +
        "this point reads a hook hanging rather than a crane coming down " +
        "(specs/statics.md)",
      `it is "${run.phase}"` + (run.cause === null ? "" : ` (${run.cause})`),
    );
  }
  return run.bob.pos;
}

/** Where the build says a box of `half` units around `at` is drawn. */
async function boxRegion(at: Vec3, half: number, what: string): Promise<Rect> {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-half, half]) {
    for (const dy of [-half, half]) {
      for (const dz of [-half, half]) {
        const on = await h.project(at.x + dx, at.y + dy, at.z + dz);
        assertTrue(
          on.visible,
          `the corner (${(at.x + dx).toFixed(2)}, ${(at.y + dy).toFixed(2)}, ` +
            `${(at.z + dz).toFixed(2)}) of ${what} to be drawn on the stage ` +
            "at the posed camera, so this point has a picture to read " +
            "(specs/instrumentation.md)",
        );
        left = Math.min(left, on.x);
        right = Math.max(right, on.x);
        top = Math.min(top, on.y);
        bottom = Math.max(bottom, on.y);
      }
    }
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
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await h.paintFrame();
  return h.page.screenshot({
    clip: {
      x: fit!.x + rect.x * sx,
      y: fit!.y + rect.y * sy,
      width: Math.max(1, rect.width * sx),
      height: Math.max(1, rect.height * sy),
    },
  });
}
