// presentation/extract — the one extraction the flash and the burst are read
// over, and the control drive that says what the same hall looks like without
// one.
//
// Nothing here asserts. It poses the hall, releases one core into it, and hands
// back the frames the build drew tick by tick together with where the cores the
// removal took were standing.
//
// THE SCENARIO, AND WHY IT IS THIS ONE. Two cores of one charge are posed on the
// straight top run (leg 0 of `specs/channel.md`'s polyline, `y = 40`), and the
// injector releases a third along its opening aim of 270 degrees, straight up
// the field from `(420, 330)` (`specs/injector.md` — "Opening aim | 270
// degrees"). The head is posed behind the line the shot crosses, so
// `dot(d - c.position, f)` is positive and the core enters AHEAD of it
// (`specs/injector.md` — "Striking a core"): the inserted core takes the head's
// arc position and the two behind it shift back by the channel spacing, which
// leaves three consecutive cores of one charge in one segment. "A maximal run of
// at least 3 cores is extracted" (`specs/extraction.md`), so the extraction
// resolves on the tick the projectile lands.
//
// The control is the same arrangement with the released core carrying a
// different charge. The run it completes holds one core, so nothing extracts,
// and every other thing on the field — the plate, the injector, the HUD, the
// tick the shot lands on — is what it was.

import { SPACING, type ChargeId, type Point } from "../constants";
import {
  drawnPoints,
  poseHall,
  type DrawCall,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/**
 * The head's arc position, in units from the inlet.
 *
 * Chosen so the head stands BEHIND the point the shot crosses the top run at.
 * The shot leaves `(420, 330)` along 270 degrees and meets `y = 40` at `x = 420`,
 * which is arc `380` on leg 0; the head is posed thirty units short of that and
 * has climbed about ten by the time the projectile arrives, so the projectile's
 * centre is comfortably on the `+x` side of the core it strikes and comfortably
 * inside the 28-unit strike distance.
 */
export const HEAD_S = 350;

/** The charge the two posed cores carry. */
export const RUN_CHARGE: ChargeId = "halide";

/** A charge no posed core carries, for the drive that must not extract. */
export const OTHER_CHARGE: ChargeId = "sulfur";

/** What one drive saw. */
export interface ShotFrames {
  /** The tick the projectile left the hall, 1-based, or -1 if it never did. */
  strike: number;
  /** Whether the strike took cores off the channel. */
  removed: boolean;
  /** Where the cores standing at the strike were, read the tick before it. */
  standing: Point[];
  /** The operations of each tick's render, index 0 being the first tick. */
  frames: DrawCall[][];
  /** The snapshot each tick left. */
  after: VoluteSnapshot[];
}

/** Pose the two-core run and load `charge` into the injector. */
export async function poseRun(h: Harness, charge: ChargeId): Promise<void> {
  await poseHall(h, {
    level: 1,
    cores: [
      [HEAD_S, RUN_CHARGE, null],
      [HEAD_S - SPACING, RUN_CHARGE, null],
    ],
    loaded: charge,
    queued: OTHER_CHARGE,
  });
}

/**
 * Release the loaded core along the opening aim and step `ticks` ticks, keeping
 * every frame.
 *
 * `debug.fire` rather than the fire control, because this drive is not about the
 * cooldown: "Any cooldown outstanding at the call is cleared first, so the call
 * always launches".
 */
export async function driveShot(
  h: Harness,
  ticks: number,
): Promise<ShotFrames> {
  h.debug.fire(270);
  const result: ShotFrames = {
    strike: -1,
    removed: false,
    standing: [],
    frames: [],
    after: [],
  };
  for (let tick = 1; tick <= ticks; tick += 1) {
    const before = h.snapshot();
    const calls = await h.frameCalls();
    const after = h.snapshot();
    result.frames.push(calls);
    result.after.push(after);
    if (
      result.strike < 0 &&
      before.projectiles.length > 0 &&
      after.projectiles.length === 0
    ) {
      result.strike = tick;
      result.removed = after.train.length < before.train.length;
      result.standing = before.train.map((core) => ({ x: core.x, y: core.y }));
    }
  }
  return result;
}

/** Whether `point` is within `radius` of any of `centres`. */
export function nearAny(
  point: Point,
  centres: readonly Point[],
  radius: number,
): boolean {
  return centres.some(
    (centre) => Math.hypot(point.x - centre.x, point.y - centre.y) <= radius,
  );
}

/**
 * The points a frame's GEOMETRY landed on, with every image draw left out.
 *
 * `specs/assets.md` has the produced particle systems played through
 * `@test-cabinet/particle-runtime`'s `./canvas` binding, which composites each
 * live particle as a filled arc on the context it was handed, while every
 * produced sprite reaches the field as a `drawImage`. Dropping the image draws
 * is therefore what separates the effect from the picture it plays over.
 */
export function geometryPoints(calls: readonly DrawCall[]): Point[] {
  const kept = calls.filter(
    (call) =>
      !(
        call.kind === "call" &&
        (call.method === "drawImage" || call.method === "putImageData")
      ),
  );
  return drawnPoints(kept);
}
