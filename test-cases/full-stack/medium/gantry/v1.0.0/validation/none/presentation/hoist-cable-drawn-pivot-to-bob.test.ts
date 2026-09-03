// presentation/hoist-cable-drawn-pivot-to-bob — the hoist cable is drawn from the
// pivot to the bob.
//
// specs/rigging.md § The pivot and the bob: "The hoist cable hangs from the pivot:
// the trolley point, on the rail track at the trolley's position, rotated with
// the arm. Its length is the hoist axis's value `L`... The cable is inextensible:
// the bob stays at distance `L` from the pivot. IT IS DRAWN FROM PIVOT TO BOB and
// is otherwise massless." So the drawn cable is the hoist axis made visible:
// lengthen the axis and the drawn line reaches further down, and it stops where
// the bob is.
//
// THE READING IS ONE RUN AT TWO CABLE LENGTHS, with no load attached — the
// sentence holds "whether or not a load is attached", and the bare hook is the
// simpler world. The hoist axis is posed longer between the two pictures, which
// is a change the cable alone answers for: `setAxis` "sets an axis's value,
// leaving it stopped with no live command" (specs/instrumentation.md), and the
// pendulum's own constraint puts the bob at the new distance on the tick that
// follows, straight below a pivot it was already hanging under.
//
// WHAT IS ASSERTED. The stretch of stage between where the bob hung and where it
// hangs now is painted in the second picture and was not in the first: that is
// the cable following the axis's value. And the stage beyond the lower bob, along
// the same line, is left alone in both: the cable ends at the bob rather than
// running on. The control is taken a good way past the bob — a hook is drawn
// there too, and how big a hook is drawn is the build's own business
// (specs/assets.md), so the reading keeps well clear of it.
//
// THE STAGING IS THE SMALLEST WORLD THE READING FITS IN. The cable hangs from the
// pivot on every crane and on every site, so this point is decided on the
// cheapest one that shows it: the smallest crane that stands, on the first site,
// with the yard emptied to nothing. The carriage is run out to the end of the
// short track, which is what puts the cable in open air — read at the track
// origin the cable hangs down the tower's own face and the tower's drawing
// answers for the pixels instead of the cable's. It is run out BY THE TAPE, since
// a posed jump is a real pivot velocity and snaps the cable (specs/rigging.md
// § The pendulum tick, step 5) — that much of the route is the reading's, not a
// convention — and a last tape step slow enough that nothing else moves while the
// pictures are taken. The two cable lengths are chosen so the bob is well clear
// of the ground at the shorter and the stretch between them is long enough to
// sample along.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
  fail,
} from "../assert";
import { STAGE_H, STAGE_W, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** First Lift: the shortest site, and the smallest crane that stands on it. */
const SITE = 0;

/**
 * Where the trolley is run out to, and the two cable lengths read.
 *
 * The minimal crane's track runs from the top flange out to `(4, 4, 0)`, so the
 * carriage ends at the tip and the pivot stands two units clear of the tower.
 * The bob then hangs at `y = 3.5` on the short cable and `y = 0.5` on the long
 * one: off the ground at both, and far enough apart to sample the stretch
 * between them.
 */
const TROLLEY = 4;
const SHORT = 0.5;
const LONG = 3.5;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "trolley", target: TROLLEY, rate: 4 }] },
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

/** Where along the new stretch of cable the picture is read. */
const ALONG = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85];

/** How far past the lower bob the controls stand, in logical pixels. */
const BEYOND = [30, 60];

/** Ticks driven per span while the carriage runs out, and the cap on the run. */
const RUN_OUT_SPAN = 60;
const RUN_OUT_CAP = 420;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** Slack on a point of the drawn cable, in logical pixels. */
const TOLERANCE = 2;
/** How many of the eight points along the new stretch must be painted. */
const MOST = 7;

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the cable down to the bob the hoist length puts there", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  // Driven in spans rather than a tick at a time: the move is `TROLLEY` units
  // at rate 4 with an acceleration of 4 (specs/program.md), so it is over well
  // inside the cap however a build ramps it, and all this reading needs is that
  // the carriage HAS arrived before the pictures are taken. A tick-by-tick sweep
  // reads the state across the surface once per tick and pays for the reading
  // many times over; a span-by-span one reads it once per span and still fails
  // the item, on the same cap, if the carriage never arrives.
  const out = await runOut(h);
  const pivot = out.run.pivot;
  await h.debug.setAxis("hoist", SHORT);
  await h.debug.setBob(pivot.x, pivot.y - SHORT, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(2);

  const hanging = await h.snapshot();
  assertEqual(
    hanging.run.phase,
    "running",
    "the run this reading is taken during (specs/program.md)",
  );
  assertEqual(
    hanging.run.attached,
    null,
    "the load on the hook, which this reading has none of: the cable is drawn " +
      "from pivot to bob whether or not a load is attached (specs/rigging.md)",
  );
  const high = await h.project(
    hanging.run.bob.pos.x,
    hanging.run.bob.pos.y,
    hanging.run.bob.pos.z,
  );

  const before = await picture(h);

  await h.debug.setAxis("hoist", LONG);
  await h.advance(1);
  const lowered = await h.snapshot();
  assertEqual(
    lowered.run.phase,
    "running",
    "the run once the cable is let out, which the second picture is of",
  );
  const low = await h.project(
    lowered.run.bob.pos.x,
    lowered.run.bob.pos.y,
    lowered.run.bob.pos.z,
  );
  const after = await picture(h);
  await h.capture("cable", "The cable drawn at two hoist lengths");

  assertEqual(
    Math.round(lowered.run.axes.hoist.value * 1e6) / 1e6,
    LONG,
    "the hoist axis's value the second picture is drawn at " +
      "(specs/instrumentation.md)",
  );
  assertTrue(
    high.visible && low.visible,
    `both bobs — (${high.x.toFixed(0)}, ${high.y.toFixed(0)}) and ` +
      `(${low.x.toFixed(0)}, ${low.y.toFixed(0)}) — to be drawn on the stage ` +
      "at the start camera pose, so this point has a picture to read " +
      "(specs/instrumentation.md)",
  );

  const span = Math.hypot(low.x - high.x, low.y - high.y);
  assertGreaterThan(
    span,
    ALONG.length * 4,
    `the logical pixels between the bob on a cable of ${SHORT} and the bob on ` +
      `a cable of ${LONG}, which this reading needs long enough to sample ` +
      "along",
  );
  const direction = { x: (low.x - high.x) / span, y: (low.y - high.y) / span };

  const bare = ALONG.filter((t) => {
    const at = {
      x: high.x + (low.x - high.x) * t,
      y: high.y + (low.y - high.y) * t,
    };
    return changeNear(before, after, at, TOLERANCE) <= CHANGED;
  });
  assertGreaterThan(
    ALONG.length - bare.length,
    MOST - 1,
    `the points along the stretch between the two bobs that letting the ` +
      `cable out from ${SHORT} to ${LONG} paints over, out of ` +
      `${ALONG.length}: the cable is drawn from the pivot to the bob, and the ` +
      "bob stands at the hoist axis's value below the pivot " +
      "(specs/rigging.md § The pivot and the bob)",
  );

  for (const past of BEYOND) {
    const at = {
      x: low.x + direction.x * past,
      y: low.y + direction.y * past,
    };
    assertLessThanOrEqual(
      changeNear(before, after, at, TOLERANCE),
      CHANGED,
      `the stage ${past} logical pixels past the lower bob, on the line the ` +
        "cable hangs along, which letting the cable out may not paint: the " +
        "cable is drawn from the pivot TO THE BOB (specs/rigging.md § The " +
        "pivot and the bob)",
    );
  }
});

/**
 * Run until the carriage has reached the end of its move, in spans.
 *
 * The cap is not a quiet ceiling: a reading whose carriage never arrived would
 * fall through to assertions about a cable hanging somewhere else, so a run that
 * has not arrived by `RUN_OUT_CAP` fails the item and says so.
 */
async function runOut(h: Harness): Promise<GantrySnapshot> {
  let state: GantrySnapshot | null = null;
  for (let driven = 0; driven < RUN_OUT_CAP; driven += RUN_OUT_SPAN) {
    state = await runTicks(h, Math.min(RUN_OUT_SPAN, RUN_OUT_CAP - driven));
    if (state.run.axes.trolley.value >= TROLLEY - 1e-9) return state;
  }
  return fail(
    `the trolley to run out to ${TROLLEY} within ${RUN_OUT_CAP} ticks ` +
      `(${(RUN_OUT_CAP / TICK_HZ).toFixed(2)}s of run clock): the step moves ` +
      `it there at rate 4 with an acceleration of 4 (specs/program.md)`,
    state === null
      ? "the run was never driven"
      : `it stands at ${state.run.axes.trolley.value.toFixed(3)} and the run ` +
          `is "${state.run.phase}"` +
          (state.run.cause === null ? "" : ` (${state.run.cause})`),
  );
}
