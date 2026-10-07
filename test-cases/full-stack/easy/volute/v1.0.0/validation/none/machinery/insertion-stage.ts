// machinery/insertion-stage — the extraction the grant points drive.
//
// WHY AN INSERTION AND WHY THE TRAIN IS HELD. Three points here need a run drawn
// out so they can read what its marks granted, and none of them is about the
// feed, the merge, or the aim. So the hall is posed with `feed: false`, which
// `specs/instrumentation.md` defines as stopping step 2 of the tick order alone —
// "no segment advances, no merge follows from an advance" — while "every other
// step runs unchanged", the strike and the insertion among them. The cores stand
// exactly where they were posed when the shot arrives, so the geometry below is
// arithmetic on the specs' own figures rather than a prediction of how far a
// train rode.
//
// THE GEOMETRY. `specs/channel.md`'s leg 0 runs from the inlet `(40, 40)` to
// `(920, 40)`, so a core at arc position `s` on it stands at `(40 + s, 40)`. The
// injector is fixed at `(420, 330)` and a shot fired at the opening aim of 270
// degrees runs straight up `x = 420` (`specs/injector.md`), so the core posed at
// {@link STRUCK_S} stands directly in its path and every other core posed here
// stands a whole channel spacing to one side of it or more.
//
// WHAT THE STRIKE DOES. The projectile's centre reaches within the 28-unit strike
// distance of the struck core while it is still directly below it, so
// `dot(d - c.position, f)` is exactly `0` — the shot arrives square on — and
// `specs/injector.md` says "a dot product of exactly `0` enters behind". The
// insertion position is therefore `STRUCK_S - SPACING`, every core at or below it
// shifts back one spacing, and the seated core completes a run of three with the
// two cores that were already there.

import { assertEqual, assertTrue } from "../assert";
import { OPENING_AIM, SPACING } from "../constants";
import {
  coreCount,
  driveShot,
  fireAt,
  poseHall,
  type Harness,
  type PoseOptions,
  type PosedCore,
  type VoluteSnapshot,
} from "../harness";

/** The charge the run is made of, and the charge the shot carries. */
export const RUN_CHARGE = "halide";

/**
 * The core the shot strikes: on leg 0 at `(420, 40)`, square above the injector.
 *
 * 380 puts it 290 units up the field from `(420, 330)`, which a projectile at
 * `PROJECTILE_SPEED` covers in 26 ticks.
 */
export const STRUCK_S = 380;

/** Where the seated core lands: one spacing behind the core it entered behind. */
export const SEATED_S = STRUCK_S - SPACING;

/** Ticks recorded after the run is drawn out, so a replay shows what it left. */
export const TRAILING_TICKS = 40;

/**
 * Pose the cores, fire square at {@link STRUCK_S}, and drive the shot home.
 *
 * Returns the snapshot of the tick the shot resolved on, which is the tick the
 * extraction and its grants resolved on too (`specs/channel.md`, steps 3 and 4).
 * Fails the point when the shot never resolves or the run was not drawn out,
 * since neither leaves anything to read.
 */
export async function driveExtraction(
  h: Harness,
  cores: readonly PosedCore[],
  options: PoseOptions = {},
): Promise<VoluteSnapshot> {
  await poseHall(h, {
    level: 1,
    feed: false,
    cores,
    loaded: RUN_CHARGE,
    ...options,
  });
  await fireAt(h, OPENING_AIM);
  const shot = await driveShot(h);
  assertTrue(shot.landed, "the fired core resolved within the sweep");
  return shot.snapshot;
}

/** Assert the run of three really went, so what follows is read off a removal. */
export function assertExtracted(
  snapshot: VoluteSnapshot,
  posed: number,
  removed: number,
): void {
  assertEqual(
    coreCount(snapshot),
    posed + 1 - removed,
    "the cores left once the seated core completed the run and it was drawn out",
  );
}
