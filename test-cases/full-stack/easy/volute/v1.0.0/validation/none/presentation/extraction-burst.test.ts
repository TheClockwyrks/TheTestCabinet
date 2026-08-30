// presentation/extraction-burst — the produced particle burst plays over a run
// as it is drawn out, throwing live particles at the extraction's position.
//
// THE REQUIREMENT. `specs/assets.md` — "The effects": "extraction burst | each
// core an extraction removes | a sharp outward throw in the extracted charge's
// color, gone almost as fast as it arrives", produced with `particle-2d` as a
// `system.json` and "played live". The same section fixes how it reaches the
// screen: "Play them through `@test-cabinet/particle-runtime` ... using its
// `./canvas` binding: a player is constructed over a parsed system and a 2D
// rendering context and advanced each frame with that frame's delta, and it
// simulates the system and composites the particles itself." So a live burst is
// geometry the build's own context receives, one composited particle at a time,
// and "Each play of a system varies" — a simulated system moves between frames
// where a baked picture does not.
//
// WHY TWO DRIVES. A single frame cannot say which of its operations belong to
// the effect: the plate, the injector and the HUD are drawn every tick as well.
// So the same hall is driven twice, identically but for the charge the injector
// releases — once so the run of three completes and extracts, once so it does not
// — and what the burst is is what the first drive drew near the extraction and the
// second did not. Both drives fire on the same tick, from the same pose, at the
// same simulated time, so everything else on the field is the same picture.
//
// WHAT IS COUNTED. The points a tick's GEOMETRY landed on, with every image draw
// dropped, since the sprites are the picture the effect plays over. A point is
// the effect's when the control's own tick put nothing within a unit of it.
//
// THE BOUNDS. At least two ticks after the extraction carry such a point, and two
// of those ticks disagree about where the points are. That is the least that "a
// live particle system playing at the extraction" can mean and the least that
// separates it from a still mark: one tick is a mark, two identical ticks are a
// mark held up, and two that differ are motion. Nothing here counts particles or
// measures a spread — `specs/assets.md` fixes neither, and each play varies by
// design. The reach is 60 units of a core the removal took, which covers a throw
// that has left the core it came from while excluding the rest of the field.

import { afterEach, it } from "vitest";
import { type Point } from "../constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  driveShot,
  geometryPoints,
  nearAny,
  OTHER_CHARGE,
  poseRun,
  RUN_CHARGE,
} from "./extract";

/** How many ticks each drive runs for: the flight, then the burst. */
const DRIVE_TICKS = 60;

/** How many ticks after the extraction the burst is read over. */
const BURST_WINDOW = 30;

/** How far from a removed core a point still belongs to its burst. */
const BURST_RADIUS = 60;

/** How close two points must be to count as the same operation. */
const SAME_POINT = 1;

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

async function opened(): Promise<Harness> {
  const h = await createHarness();
  harnesses.push(h);
  return h;
}

it("throws live particles at the run an extraction draws out", async () => {
  const extracting = await opened();
  await poseRun(extracting, RUN_CHARGE);
  const burst = await captureReplay(extracting, "burst", () =>
    driveShot(extracting, DRIVE_TICKS),
  );

  const control = await opened();
  await poseRun(control, OTHER_CHARGE);
  const quiet = await driveShot(control, DRIVE_TICKS);

  assertGreaterThan(
    burst.strike,
    0,
    "the tick the released core reached the train",
  );
  assertTrue(
    burst.removed,
    "an extraction taking the run of three off the channel",
  );
  assertGreaterThan(
    quiet.strike,
    0,
    "the tick the control's core reached the train",
  );
  assertTrue(
    !quiet.removed,
    "the control drive leaving every core on the channel",
  );

  /** The points the extraction drew near the removal that the control did not. */
  const extra: Point[][] = [];
  for (let offset = 1; offset <= BURST_WINDOW; offset += 1) {
    const played = burst.frames[burst.strike - 1 + offset];
    const still = quiet.frames[quiet.strike - 1 + offset];
    if (played === undefined || still === undefined) break;
    const near = geometryPoints(played).filter((point) =>
      nearAny(point, burst.standing, BURST_RADIUS),
    );
    const control_ = geometryPoints(still).filter((point) =>
      nearAny(point, burst.standing, BURST_RADIUS),
    );
    extra.push(
      near.filter(
        (point) =>
          !control_.some(
            (other) =>
              Math.hypot(point.x - other.x, point.y - other.y) <= SAME_POINT,
          ),
      ),
    );
  }

  const alive = extra.filter((points) => points.length > 0);
  assertGreaterThanOrEqual(
    alive.length,
    2,
    "ticks after the extraction drawing something at it the control drive did not",
  );

  const moved = alive.some(
    (points, index) =>
      index > 0 && signature(points) !== signature(alive[index - 1]),
  );
  assertTrue(
    moved,
    "the particles at the extraction standing somewhere new from one tick to the next",
  );
});

/** A tick's points as one comparable string, rounded to a tenth of a unit. */
function signature(points: readonly Point[]): string {
  return points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .sort()
    .join(" ");
}
