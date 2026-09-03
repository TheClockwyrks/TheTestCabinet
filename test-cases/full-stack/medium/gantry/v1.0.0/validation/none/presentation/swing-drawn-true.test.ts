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
// THE SAMPLES ARE FOUR TICKS SPREAD ACROSS THE SWING, each far enough from the
// last that the bob has moved a long way across the stage; a load painted at one
// fixed place, or one animated on its own clock, cannot be at all four. The bob
// is released well off the vertical, from rest, and the load is light so that the
// swing loads the crane gently rather than pulling it down mid-reading.
//
// The rest of the staging is the same as every run reading in this category: Over
// the Wall's own crane on its own site, the yard emptied to nothing but one load,
// the trolley run out BY THE TAPE — a posed jump would be a real pivot velocity
// and would snap the cable (specs/rigging.md § The pendulum tick, step 5) — and a
// last tape step slow enough that nothing else moves while the pictures are
// taken.

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
  runUntil,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Over the Wall, whose crane carries its track at `y = 12`: room to swing. */
const SITE = 2;

const CLASS = "crate";
const MASS = 10;
const START = { x: -6, y: 2, z: 6, yaw: 0 } as const;

/** Where the trolley is run out to, and the cable the load swings on. */
const TROLLEY = 8;
const HOIST = 6;

/** How far off the vertical the bob is released, in degrees. */
const RELEASE = 45;

/** The samples: four of them, this many ticks apart. */
const SAMPLES = 4;
const STRIDE = 25;

/** How far the drawn bob has to travel between samples, in logical pixels. */
const SEPARATION = 20;

/** How far the two runs' bobs may stand apart, in world units. */
const SAME_SWING = 0.01;

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

/**
 * Stand the crane up, run a swing's worth of staging, and leave the bob
 * released off the vertical, with the load on the hook or standing in the yard.
 */
async function stageSwing(harness: Harness, carry: boolean): Promise<void> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await poseCrane(harness, DESIGNS[SITE]!);
  await addOneLoad(harness, CLASS, MASS, START, START);
  await poseTape(harness, TAPE);
  await startRun(harness);

  // Driven in one span and then a tick at a time: the move is `TROLLEY` units
  // at rate 4 with an acceleration of 4 (specs/program.md), which cannot be
  // over inside two seconds however a build ramps it, and the sweep that
  // follows fails the item if it never arrives.
  await runTicks(harness, RUN_OUT);
  const out = await runUntil(
    harness,
    (s) => s.run.axes.trolley.value >= TROLLEY - 1e-9,
    300,
    `the trolley to run out to ${TROLLEY}`,
  );
  const pivot = out.run.pivot;
  await harness.debug.setAxis("hoist", HOIST);
  if (carry) await harness.debug.setLoadPhase(0, "attached");
  // Released from rest, `RELEASE` degrees off the vertical, on a cable of the
  // length the hoist axis is holding: a bob the constraint can keep.
  const radians = (RELEASE * Math.PI) / 180;
  await harness.debug.setBob(
    pivot.x + HOIST * Math.sin(radians),
    pivot.y - HOIST * Math.cos(radians),
    pivot.z,
  );
  await harness.debug.setBobVelocity(0, 0, 0);
  await harness.advance(1);
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

  let previous: At | null = null;
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const swung = await runTicks(h, STRIDE);
    const alone = await runTicks(control, STRIDE);
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
    const at = await h.project(bob.x, bob.y, bob.z);
    assertTrue(
      at.visible,
      `the bob at sample ${sample + 1}, (${bob.x.toFixed(2)}, ` +
        `${bob.y.toFixed(2)}, ${bob.z.toFixed(2)}), to be drawn on the stage, ` +
        "so this point has a picture to read (specs/instrumentation.md)",
    );
    if (previous !== null) {
      assertGreaterThan(
        Math.hypot(at.x - previous.x, at.y - previous.y),
        SEPARATION,
        `the logical pixels the bob travelled between sample ${sample} and ` +
          `sample ${sample + 1}, which this reading needs so that a load ` +
          "painted at one place cannot answer for two of them",
      );
    }
    previous = at;

    const swungShot = await picture(h);
    const aloneShot = await picture(control);
    if (sample === SAMPLES - 1) {
      await h.capture("swing", "The load drawn at the bob across the swing");
    }

    let carried = 0;
    for (const corner of boxCorners(bob)) {
      const point = await h.project(corner.x, corner.y, corner.z);
      if (!point.visible) continue;
      if (changeNear(swungShot, aloneShot, point, TOLERANCE) > CHANGED) {
        carried += 1;
      }
    }
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
