// presentation/extraction-burst — the produced particle burst plays over a run
// as it is drawn out, throwing live particles at the extraction's position.
//
// THE REQUIREMENT. `specs/assets.md` — "The effects": "extraction burst | each
// core an extraction removes | a sharp outward throw in the extracted charge's
// color, gone almost as fast as it arrives", produced with `particle-2d` as a
// `system.json` and "played live". The same section fixes how it reaches the
// screen: "Play them through `@clockwyrks/particle-runtime` ... using its
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
// same simulated time, and are observed by the same sequence of renders, so
// everything else on the field is the same picture render for render.
//
// WHY TWO RENDERS PER TICK. `specs/assets.md` advances a player "each frame with
// that frame's delta" and `specs/instrumentation.md` has the loop keep rendering
// while the game is off the clock, so a build may age its burst on the wall
// clock between two steps or on simulation time at each step (see
// `./extract.ts`). Each tick after the strike is therefore read twice, back to
// back inside the page: the step's own render and the loop's next render of the
// same state. Whichever clock the burst runs on, two consecutive renders of a
// live system differ; and because nothing crosses the wire between them, the
// reading does not depend on how fast the host let the drive run.
//
// WHAT IS COUNTED. The points a render's GEOMETRY landed on, with every image
// draw dropped, since the sprites are the picture the effect plays over. A point
// is the effect's when the control's own render put nothing within a unit of it.
//
// THE BOUNDS. At least two renders after the strike's own carry such a point, and
// two of those renders disagree about where the points are. That is the least
// that "a live particle system playing at the extraction" can mean and the least
// that separates it from a still mark: one render is a mark, two identical
// renders are a mark held up, and two that differ are motion. Nothing here counts
// particles or measures a spread — `specs/assets.md` fixes neither, and each play
// varies by design. The reach is 60 units of a core the removal took, which
// covers a throw that has left the core it came from while excluding the rest of
// the field.

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

/** How many ticks each drive may run for before the shot must have landed. */
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
    driveShot(extracting, DRIVE_TICKS, BURST_WINDOW),
  );

  const control = await opened();
  await poseRun(control, OTHER_CHARGE);
  const quiet = await driveShot(control, DRIVE_TICKS, BURST_WINDOW);

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

  /**
   * The points the extraction drew near the removal that the control did not,
   * per render after the strike's own. Both drives observe the same sequence of
   * renders from their strike on, so the control's render at the same index is
   * the same state drawn by the same hand.
   */
  const extra: Point[][] = [];
  for (let index = 1; index < burst.renders.length; index += 1) {
    const played = burst.renders[index];
    const still = quiet.renders[index];
    if (played === undefined || still === undefined) break;
    const near = geometryPoints(played.calls).filter((point) =>
      nearAny(point, burst.standing, BURST_RADIUS),
    );
    const control_ = geometryPoints(still.calls).filter((point) =>
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
    "renders after the extraction drawing something at it the control drive did not",
  );

  const moved = alive.some(
    (points, index) =>
      index > 0 && signature(points) !== signature(alive[index - 1]),
  );
  assertTrue(
    moved,
    "the particles at the extraction standing somewhere new from one render to the next",
  );
});

/** A render's points as one comparable string, rounded to a tenth of a unit. */
function signature(points: readonly Point[]): string {
  return points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .sort()
    .join(" ");
}
