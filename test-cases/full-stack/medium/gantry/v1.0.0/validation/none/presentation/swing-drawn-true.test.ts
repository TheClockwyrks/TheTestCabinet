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
// makes the reading sharp: consecutive places stand a long way apart, so a load
// painted at one fixed place, animated on its own clock, or drawn where the bob
// WAS a tick ago cannot answer for all four.
//
// TWO PICTURES OF THE SAME WORLD AT EACH PLACE, one with the load on the hook and
// one with it out in the yard, are what makes that readable. Everything else —
// the crane, the cable, the hook, the camera, the bob itself — stands in both, so
// the two pictures differ at the crate's own box and nowhere else. Comparing one
// picture against another taken with the bob somewhere else could not tell a load
// drawn at the bob from a hook drawn at the bob; here the hook is in both, so only
// the load can part them.
//
// The rest of the staging is the same as every run reading in this category: Over
// the Wall's own crane on its own site, the yard emptied to nothing but one load,
// and a tape slow enough that nothing else moves while the pictures are taken. The
// trolley is run out and the cable let down by POSE, with the bob put straight back
// under where that leaves the pivot in the same breath, so the pendulum's
// pivot-velocity step (specs/rigging.md, step 5) takes the jump as the still hang
// it is rather than as a jolt.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
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
  type LoadPose,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** Over the Wall, whose crane carries its track at `y = 12`: room to swing. */
const SITE = 2;

const CLASS = "crate";
const MASS = 10;
const START: LoadPose = { x: -6, y: 2, z: 6, yaw: 0 };

/** Where the load stands while the picture without it is taken. */
const AWAY: LoadPose = { x: -8, y: 2, z: -8, yaw: 0 };

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
 * Four, spread wide enough that the bob travels a long way across the stage
 * between them, and all on the same side of the tower so the crate hangs in open
 * air at every one of them.
 */
const ARC = [-45, -15, 15, 45] as const;

/** How far the drawn bob has to travel between samples, in logical pixels. */
const SEPARATION = 20;

/** How far the two pictures' bobs may stand apart, in world units. */
const SAME_BOB = 0.01;

/** The tape: a slew slow enough that nothing moves while the pictures are taken. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** Slack on a point of the load's box, in logical pixels. */
const TOLERANCE = 3;
/** How many of the eight box corners must carry the load at each sample. */
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
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await harness.paintFrame();
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

/** Where the bob hangs `degrees` off the vertical on a cable from `pivot`. */
function onArc(pivot: Vec3, degrees: number): Vec3 {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: pivot.x + HOIST * Math.sin(radians),
    y: pivot.y - HOIST * Math.cos(radians),
    z: pivot.z,
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
  let state = await runTicks(h, 1);
  assertEqual(
    state.run.phase,
    "running",
    "the run this reading is taken in, once the arm stands where the pictures " +
      "are taken from",
  );

  let previous: At | null = null;
  for (const [sample, degrees] of ARC.entries()) {
    const at = onArc(state.run.pivot, degrees);

    // The picture with the load on the hook. The pose puts the bob on its cable;
    // the tick that follows is what carries the load's lift point onto it.
    await h.debug.setLoadPhase(0, "attached");
    await h.debug.setBob(at.x, at.y, at.z);
    await h.debug.setBobVelocity(0, 0, 0);
    state = await runTicks(h, 1);
    assertEqual(
      state.run.phase,
      "running",
      `the run at sample ${sample + 1}, ${state.run.tick} ticks in, which ` +
        "this reading needs still under way",
    );
    assertEqual(
      state.run.loads[0]?.phase,
      "attached",
      `the load's phase in the picture this reading is of, at sample ` +
        `${sample + 1} (specs/instrumentation.md)`,
    );
    const swungShot = await picture(h);
    const bob = state.run.bob.pos;

    // And the same world with the load out of it: the same crane, the same
    // camera, the same bob on the same cable, and the crate standing in the yard.
    await h.debug.setLoadPhase(0, "waiting");
    await h.debug.setLoadPose(0, AWAY.x, AWAY.y, AWAY.z, AWAY.yaw);
    await h.debug.setBob(at.x, at.y, at.z);
    await h.debug.setBobVelocity(0, 0, 0);
    const alone = await runTicks(h, 1);
    assertEqual(
      alone.run.loads[0]?.phase,
      "waiting",
      `the load's phase in the picture this reading is compared against, at ` +
        `sample ${sample + 1}, which holds the same world and leaves the crate ` +
        "standing in the yard",
    );
    assertTrue(
      distance3(bob, alone.run.bob.pos) <= SAME_BOB,
      `the two pictures' bobs to stand together at sample ${sample + 1}: the ` +
        "pendulum reads nothing but the pivot, the hoist length and its own " +
        "state, so a load on the hook does not move it (specs/rigging.md " +
        `§ Determinism) — they stand ${distance3(
          bob,
          alone.run.bob.pos,
        ).toFixed(3)} apart`,
    );
    const aloneShot = await picture(h);

    const point = await h.project(bob.x, bob.y, bob.z);
    assertTrue(
      point.visible,
      `the bob at sample ${sample + 1}, (${bob.x.toFixed(2)}, ` +
        `${bob.y.toFixed(2)}, ${bob.z.toFixed(2)}), to be drawn on the stage, ` +
        "so this point has a picture to read (specs/instrumentation.md)",
    );
    if (previous !== null) {
      assertGreaterThan(
        Math.hypot(point.x - previous.x, point.y - previous.y),
        SEPARATION,
        `the logical pixels the bob travelled between sample ${sample} and ` +
          `sample ${sample + 1}, which this reading needs so that a load ` +
          "painted at one place cannot answer for two of them",
      );
    }
    previous = point;

    if (sample === ARC.length - 1) {
      await h.capture("swing", "The load drawn at the bob across the swing");
    }

    let carried = 0;
    for (const corner of boxCorners(bob)) {
      const seen = await h.project(corner.x, corner.y, corner.z);
      if (!seen.visible) continue;
      if (changeNear(swungShot, aloneShot, seen, TOLERANCE) > CHANGED) {
        carried += 1;
      }
    }
    assertGreaterThan(
      carried,
      MOST - 1,
      `the corners of the crate's box at the bob at sample ${sample + 1}, ` +
        `tick ${state.run.tick} — (${bob.x.toFixed(2)}, ` +
        `${bob.y.toFixed(2)}, ${bob.z.toFixed(2)}) — that the picture carrying ` +
        "the load draws differently from the picture leaving it standing, out " +
        "of 8: an attached load's lift point is the bob's position at every " +
        "tick, so its swing is drawn true to the simulation " +
        "(specs/rigging.md § The pivot and the bob, specs/overview.md " +
        "§ Visual design)",
    );

    state = alone;
  }
});
