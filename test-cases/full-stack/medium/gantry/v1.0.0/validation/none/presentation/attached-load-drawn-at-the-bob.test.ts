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
// starting pose, put through `project`. A crate is `2 x 2 x 2` and a load pose is
// the pose of its lift point, the centre of its top face, so the box "extends
// half its width and half its depth horizontally from the lift point... and its
// full height below it" (specs/world.md § Loads). Most of those corners must have
// changed at each end: what a build draws a crate as is its own, and a corner or
// two of a produced model may sit inside its class box rather than on it.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
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

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** Slack on a point of the load's box, in logical pixels. */
const TOLERANCE = 3;
/** How many of the eight box corners have to have changed at each end. */
const MOST = 6;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
interface At {
  x: number;
  y: number;
}

async function picture(harness: Harness): Promise<Picture> {
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

function colorAt(shot: Picture, at: At): [number, number, number] {
  const x = Math.min(
    Math.max(Math.round((at.x / STAGE_W) * shot.width), 0),
    shot.width - 1,
  );
  const y = Math.min(
    Math.max(Math.round((at.y / STAGE_H) * shot.height), 0),
    shot.height - 1,
  );
  const i = (y * shot.width + x) * 4;
  return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
}

function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function changeNear(a: Picture, b: Picture, at: At, radius: number): number {
  let most = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const point = { x: at.x + dx, y: at.y + dy };
      most = Math.max(most, apart(colorAt(a, point), colorAt(b, point)));
    }
  }
  return most;
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
  const where = new Map<string, At>();
  for (const corner of [...onHook, ...onGround]) {
    const at = await h.project(corner.x, corner.y, corner.z);
    assertTrue(
      at.visible,
      `${corner.where}, at (${corner.x.toFixed(2)}, ${corner.y.toFixed(2)}, ` +
        `${corner.z.toFixed(2)}), to be drawn on the stage at the start ` +
        "camera pose, so this point has a picture to read " +
        "(specs/instrumentation.md)",
    );
    where.set(corner.where, at);
  }

  const before = await picture(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.advance(1);
  const after = await picture(h);
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
    corners: readonly { where: string }[],
  ): { where: string }[] =>
    corners.filter(
      (corner) =>
        changeNear(before, after, where.get(corner.where)!, TOLERANCE) >
        CHANGED,
    );

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
