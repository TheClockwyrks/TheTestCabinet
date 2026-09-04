// progression/clearing — the one drive that empties an exhausted channel.
//
// Three points turn on the same scenario — `level-cleared`, `clear-bonus` and
// `victory` — so the arrangement and the drive live here once and each suite
// reads its own answer off the result. This file names no threshold: every
// figure it uses comes from `constants.ts`, and every assertion stays in the
// suite whose point it decides.
//
// THE SCENARIO. `specs/progression.md`: "A level is cleared the moment its quota
// is exhausted and no cores remain on the channel." So the hall is posed with the
// quota spent (`quotaRemaining` 0) and a single run of `MIN_RUN` same-charge
// cores on the channel, and the drive is one shot fired into that run.
//
// WHY THE SHOT EMPTIES THE CHANNEL, WHATEVER IT STRIKES. The posed cores are one
// segment of one charge, so they are one maximal run. `specs/injector.md` puts
// the inserted core at the struck core's arc position, or one spacing behind it,
// and shifts every core at or below that position back by one spacing — so
// whichever of the posed cores is struck, and on whichever side the projectile
// entered, the inserted core lands consecutive with the rest of the run at the
// channel spacing. `specs/extraction.md`: "take the maximal same-charge run
// containing the inserted core within that core's segment. That run is extracted
// on the same tick when it holds at least 3 cores." The run then holds
// `MIN_RUN + 1` cores of one charge, so every core on the channel is removed on
// the tick the projectile strikes, and `specs/channel.md`'s order of a tick puts
// the clear (step 6) after the insertion (step 3) on that same tick.
//
// WHERE THE RUN IS POSED. On the channel's first leg, which runs from the inlet
// `(40, 40)` to `(920, 40)` (`specs/channel.md`), directly above the injector at
// `(420, 330)` (`specs/injector.md`), so the shot is fired at the opening aim of
// 270 degrees — straight up the field — and needs no aiming. The run is posed one
// lead short of the injector's own arc position, the lead being how far the train
// rides while the projectile covers the 290 units between them at
// `PROJECTILE_SPEED`, so the middle of the run stands over the injector at the
// tick the projectile arrives. The lead is derived from the level's feed speed
// rather than measured: a build that rides at some other speed simply strikes a
// different core of the same run, and the paragraph above says the outcome is the
// same either way.

import {
  CHARGE_IDS,
  INJECTOR,
  MIN_RUN,
  OPENING_AIM,
  PROJECTILE_SPEED,
  SPACING,
  levelSpec,
} from "../constants";
import {
  TOP_RUN,
  fireAt,
  poseHall,
  spacedBlock,
  topRunS,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/** The charge the run is posed with: `halide`, which is in every level's set. */
const RUN_CHARGE = CHARGE_IDS[0];

/**
 * How far the train rides while the projectile crosses to the first leg.
 *
 * The projectile leaves the injector's center and flies at `PROJECTILE_SPEED`
 * along the aim, so straight up it covers the gap between the injector and the
 * leg in that many seconds, and the lead segment covers the level's feed speed
 * times that (`specs/channel.md` — "Advance").
 */
function leadUnits(level: number): number {
  const flightSeconds = (INJECTOR.y - TOP_RUN.y) / PROJECTILE_SPEED;
  return levelSpec(level).feed * flightSeconds;
}

/**
 * The arc position the head of the posed run takes on `level`.
 *
 * One channel spacing ahead of the injector's own arc position, so the MIDDLE
 * core of a three-core run is the one standing over the injector when the shot
 * arrives, less the lead the train rides while the shot is in the air.
 */
export function clearingHeadS(level: number): number {
  return topRunS(INJECTOR.x) + SPACING - leadUnits(level);
}

/** What the drive leaves behind, tick by tick. */
export interface ClearDrive {
  /** Every tick the drive stepped, oldest first. */
  history: VoluteSnapshot[];
  /** The tick the screen left `playing`, or the last tick stepped. */
  ended: VoluteSnapshot;
  /** The tick before that one. */
  before: VoluteSnapshot;
}

/**
 * Pose `level` with its quota spent and one run of {@link MIN_RUN} matching cores
 * standing over the injector, loaded with a matching core and aimed at it.
 *
 * Nothing here decides an outcome: the insertion, the extraction, the score, and
 * the clear all come from the ticks {@link driveClear} steps afterwards.
 */
export async function poseClearingHall(
  h: Harness,
  level: number,
): Promise<void> {
  await poseHall(h, {
    level,
    quotaRemaining: 0,
    pressure: 0,
    cores: spacedBlock(clearingHeadS(level), MIN_RUN, RUN_CHARGE),
    loaded: RUN_CHARGE,
  });
  await fireAt(h, OPENING_AIM);
}

/**
 * Step until the screen leaves `playing`, and hand back the tick it did.
 *
 * `maxTicks` covers the flight and a wide margin, and stays under the 2 s
 * interlude a clear opens, so the tick this stops on is the clearing tick rather
 * than the level that follows it.
 */
export async function driveClear(
  h: Harness,
  maxTicks = 90,
): Promise<ClearDrive> {
  const history = await h.stepWatching(
    maxTicks,
    (snapshot) => snapshot.screen !== "playing",
  );
  return {
    history,
    ended: history[history.length - 1],
    before: history[history.length - 2] ?? history[history.length - 1],
  };
}
