// Meltdown — one shot, read on its own. GROUP-LOCAL.
//
// Four items in this group are about the DAMAGE one shot removes at a heat, and
// two about the HEAT one shot adds. Both readings want the same arrangement and
// the same discipline, so it is written once, here, rather than six times:
//
//   - THE HEAT MUST NOT DRIFT UNDER A DAMAGE READING. A damage scenario pins it
//     with `posePinnedTower`, so the shot resolves at exactly the heat posed and
//     the multiplier the check is about is the multiplier the shot used
//     (specs/instrumentation.md).
//   - THE AIR MUST NOT DRIFT UNDER A HEAT READING. A heat scenario opens at heat
//     `0`, where air cooling is exactly nothing — specs/heat.md makes it
//     proportional to `H / 100` — and STOPS ON THE FRAME the first shot lands.
//     Every frame of that drive therefore opened at heat `0`, so the whole of
//     what moved the number is the shot, and the frame the shot happens to land
//     on cannot change the answer.
//   - THE TARGET STANDS STILL AND SURVIVES. `poseTarget` with motion off cannot
//     walk out of range while a shot is waited for, and hp far past one shot's
//     worth makes the reading hp REMOVED rather than a death nobody asked for.
//
// WHY THE DRIVE IS A SWEEP AND NOT A FIXED WINDOW. A window sized off a build's
// fire rate would fail this group's items whenever the fire clock was wrong,
// which is `combat/*`'s requirement and not one of these. The sweep stops on the
// first frame the reading moves at all, so what it measures is one shot however
// fast the emitter fires; a frame of the default clock is shorter than the
// shortest interval on the roster by an order of magnitude, so no conformant
// build resolves two shots inside the frame it stops on.
//
// NEITHER FUNCTION HOLDS A TOLERANCE. Each hands back a measurement; what the
// specification requires of it is stated in the check that took it.

import { fail } from "../assert";
import {
  posePinnedTower,
  poseTarget,
  poseTower,
  startRun,
  ticksFor,
  towerOf,
  unitOf,
  type Harness,
  type TowerType,
} from "../harness";
import { FREE_SITE } from "./sites";
import { figuresOf } from "./roster";

/** The plain ground unit a shot is read against: ordinary in every respect. */
const TARGET_TYPE = "mote";

/**
 * How far east of the emitter's anchor the target stands, in tiles.
 *
 * Four tiles puts its centre about 3.5 tiles from a 2x2 footprint's centre,
 * inside the shortest range on the roster (the Stutter's `5.0`) with room to
 * spare, and off the footprint itself. Geometry, not a tolerance: what range
 * means is `combat/*`'s business.
 */
const TARGET_OFFSET = 4;

/** Hp far past anything one shot on the roster removes, so nothing dies. */
const TARGET_HP = 1000;

/**
 * How many fire intervals a first-shot sweep may run for before the emitter is
 * called broken.
 *
 * The first shot of a run lands one full interval after the target is acquired
 * (specs/combat.md), so three intervals is generous and still bounded.
 */
const SHOT_WAIT_INTERVALS = 3;

/** Frames of the default clock covering that many of `type`'s fire intervals. */
function shotWindow(type: TowerType): number {
  return ticksFor(SHOT_WAIT_INTERVALS / figuresOf(type).fireRate);
}

/**
 * The hp the FIRST shot from a level-I `type` pinned at `heat` removes from a
 * stationary target.
 */
export async function oneShotDamage(
  h: Harness,
  type: TowerType,
  heat: number,
): Promise<number> {
  startRun(h);
  posePinnedTower(h, type, FREE_SITE.col, FREE_SITE.row, heat);
  const target = poseTarget(
    h,
    TARGET_TYPE,
    FREE_SITE.col + TARGET_OFFSET,
    FREE_SITE.row,
    TARGET_HP,
  );
  const opened = unitOf(h.snapshot(), target).hp;
  const swept = await h.until(
    (snapshot) => unitOf(snapshot, target).hp < opened,
    { poll: 1, maxFrames: shotWindow(type) },
  );
  if (!swept.hit) {
    fail(
      "one shot to remove baseDamage(level) * heatMultiplier(heat, redline) " +
        "from the target's hp (specs/combat.md)",
      `no hp removed in ${swept.frames} frames with a target in range at ` +
        `heat ${heat}`,
    );
  }
  return opened - unitOf(swept.snapshot, target).hp;
}

/**
 * The heat a level-I `type` carries on the frame its first shot lands, opening
 * at heat `0` with both faculties running.
 *
 * The sweep stops on that frame, so the whole of the answer is the shot's own
 * gain: see the note at the head of this file.
 */
export async function firstShotHeat(
  h: Harness,
  type: TowerType,
): Promise<number> {
  startRun(h);
  const id = poseTower(h, type, FREE_SITE.col, FREE_SITE.row);
  poseTarget(
    h,
    TARGET_TYPE,
    FREE_SITE.col + TARGET_OFFSET,
    FREE_SITE.row,
    TARGET_HP,
  );
  const swept = await h.until((snapshot) => towerOf(snapshot, id).heat > 0, {
    poll: 1,
    maxFrames: shotWindow(type),
  });
  if (!swept.hit) {
    fail(
      "the emitter's heat to rise on the frame its first shot resolves " +
        "(specs/heat.md, specs/combat.md)",
      `heat still 0 after ${swept.frames} frames with a target in range`,
    );
  }
  return towerOf(swept.snapshot, id).heat;
}
