// presentation/hud-pressure-fill — the HUD's gauge fills in proportion to the
// pressure.
//
// THE REQUIREMENT. `specs/ui.md` — "The HUD": "Pressure | A gauge marked with the
// produced pressure icon, filled in proportion to the current pressure: empty at
// `0`, full at `100`." That the gauge carries the produced icon at all is
// `presentation/hud-pressure-icon`'s point; how much of it is filled is this one,
// and a build can get either one right on its own.
//
// THE DRIVE. The same hall three times over, at the two ends of the scale and at
// its middle, each on a page of its own so the three frames sit at the same tick
// and the same simulated time and differ in nothing but the pressure
// `setPressure` posed. `specs/instrumentation.md`: "Sets the pressure to `value`,
// clamped to `0` through `100`." Six ticks are run after each pose so a gauge a
// build chose to ease has arrived; with one core on the channel the pressure
// bleeds by 2.0 a second (`specs/channel.md`), which is a fifth of a unit over
// those six ticks and nowhere near the scale's thirds.
//
// WHAT IS COMPARED, AND WHY THE CORE IS CUT OUT OF IT. `specs/channel.md` has the
// lead segment advance at "level feed speed x (1 + pressure / 100)", so the one
// posed core has travelled a different distance in each of the three frames and
// its pixels differ for a reason that is not the gauge. The disc it stands in is
// therefore left out of the comparison, which costs the reading nothing: the
// core is on the channel, and `specs/ui.md` has the HUD "draw over the hall and
// hide none of them", so no part of a conformant build's gauge is inside it.
//
// THE BOUNDS. Two, and both follow from "filled in proportion ... empty at `0`,
// full at `100`". A gauge at 50 is not the gauge at 0, so the middle frame
// differs from the empty one somewhere; and a gauge at 100 is filled twice as far
// as one at 50, so it differs from the empty one in strictly more of the field
// than the middle one does. Neither reads a colour, a size or a place:
// `specs/ui.md` fixes no layout, so where the gauge is and what it looks like are
// the build's. A gauge that ignores the pressure fails the first; one that snaps
// between empty and full fails the second.

import { afterEach, it } from "vitest";
import { PRESSURE_MAX, PRESSURE_MIN, type Point } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  differingPoints,
  fieldPixels,
  poseHall,
  type Harness,
  type PixelRect,
} from "../harness";

/** Where the one core stands, in units from the inlet. */
const CORE_S = 1000;

/** Ticks run after each pose, so a gauge that eases has arrived. */
const SETTLE_TICKS = 6;

/**
 * How far from the core's centre a pixel is the core's rather than the HUD's.
 *
 * The core sprite is 28 units square (`specs/assets.md`), so its corners reach
 * about 20 units from its centre; 40 leaves twice that for whatever glow or rim
 * a build draws around one, and still cuts nothing a HUD may occupy, since a HUD
 * that hides a core is not what `specs/ui.md` asks for.
 */
const CORE_MASK = 40;

/** The three pressures read, in the order the frames are taken. */
const PRESSURES = [
  PRESSURE_MIN,
  (PRESSURE_MIN + PRESSURE_MAX) / 2,
  PRESSURE_MAX,
] as const;

interface Frame {
  pressure: number;
  pixels: PixelRect;
  core: Point;
}

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

/** Pose the hall at `pressure`, settle it, and read the frame it left. */
async function frameAt(pressure: number, still: string | null): Promise<Frame> {
  const h = await createHarness();
  harnesses.push(h);
  await poseHall(h, { level: 1, pressure, cores: [[CORE_S, "halide", null]] });
  await h.step(SETTLE_TICKS);
  if (still !== null) await captureStill(h, still);
  const snapshot = await h.snapshot();
  return {
    pressure,
    pixels: await fieldPixels(h),
    core: { x: snapshot.train[0].x, y: snapshot.train[0].y },
  };
}

/** How many pixels two frames differ on, ignoring the disc each core sits in. */
function differingAwayFromTheCore(a: Frame, b: Frame): number {
  return differingPoints(a.pixels, b.pixels).filter(
    (point) =>
      Math.hypot(point.x - a.core.x, point.y - a.core.y) > CORE_MASK &&
      Math.hypot(point.x - b.core.x, point.y - b.core.y) > CORE_MASK,
  ).length;
}

it("fills the HUD's gauge in proportion to the pressure", async () => {
  const empty = await frameAt(PRESSURES[0], "empty");
  const half = await frameAt(PRESSURES[1], null);
  const full = await frameAt(PRESSURES[2], "full");

  const atHalf = differingAwayFromTheCore(empty, half);
  const atFull = differingAwayFromTheCore(empty, full);

  assertGreaterThan(
    atHalf,
    0,
    "pixels a pressure of 50 changed against a pressure of 0",
  );
  assertGreaterThan(
    atFull,
    atHalf,
    `pixels a pressure of 100 changed against a pressure of 0 (50 changed ${atHalf})`,
  );
});
