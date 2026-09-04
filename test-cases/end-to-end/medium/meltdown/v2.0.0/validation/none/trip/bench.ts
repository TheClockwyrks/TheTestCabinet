// Meltdown — the two benches this group poses on. GROUP-LOCAL.
//
// `specs/heat.md` makes the trip a CROSSING: "An emitter trips on the frame in
// which its newly written heat reaches `100` having opened that frame below
// `100`." So the ten items here split cleanly in two, and so does this file.
//
// THE REAL PATH, for the three items whose requirement is the trip EVENT. A
// crossing cannot be announced through `setTowerTripped` without the check
// grading its own pose, and it cannot be reached with `setTowerHeat(id, 100)`
// either: air cooling is proportional to `H / 100` and maximal at the trip, so a
// tower posed at `100` opens the next frame with a negative change, is written
// below `100`, and never meets the crossing test. The only honest route is an
// emitter posed just under `100` with both faculties on and a mark in range,
// carried over by the next shot's `heatPerShot`. `poseLiveGun` builds that, and
// `sweepToTheTrip` runs it.
//
// THE POSED PATH, for the six items about what a tower that is ALREADY tripped
// does. Those use `harness.ts`'s `poseTrippedTower` directly, so not one of them
// depends on targeting, range, the fire clock or the per-shot heat gain — the
// entanglement the faculty gates exist to remove. This file adds only the
// reading helpers they share.
//
// NOT ONE FIGURE A CHECK ASSERTS IS DECIDED HERE. Which emitter is driven, the
// heat it opens at, and how far a reading may miss are stated in the check that
// takes it. What lives here is arrangement, geometry, and the specification's
// own arithmetic over `constants.ts`'s restatement of `specs/towers.md`.

import { fail } from "../assert";
import {
  BASE_K,
  RAD_K,
  TOWER_DEFS,
  emitterStats,
  isEmitter,
  type EmitterDef,
  type EmitterStats,
  type SurgeType,
  type Tile,
  type TowerType,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  framesFor,
  poseTarget,
  poseTower,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
  type TowerView,
  type UntilResult,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The specification's own arithmetic                                         */
/* -------------------------------------------------------------------------- */

/** The emitter `specs/towers.md` tabulates under `type`, narrowed. */
export function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (!isEmitter(def)) {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/** That emitter's figures at `level`, every per-level multiplier applied. */
export function figuresOf(type: TowerType, level = 1): EmitterStats {
  return emitterStats(emitterDefOf(type), level);
}

/** The thermal mass that divides every change to a `type`'s heat. */
export function massOf(type: TowerType): number {
  return emitterDefOf(type).mass;
}

/**
 * The heat ONE shot from a level-`level` `type` adds: `heatPerShot / mass`.
 *
 * `specs/heat.md` puts the shot into the frame as
 * `shotGain(T) = shotsFired(T, dt) * heatPerShot(T)` and divides the whole
 * change by the tower's thermal mass.
 */
export function shotHeatOf(type: TowerType, level = 1): number {
  return figuresOf(type, level).heatPerShot / massOf(type);
}

/** Seconds between two shots at `type`'s rate at `level` (`specs/combat.md`). */
export function fireIntervalOf(type: TowerType, level = 1): number {
  return 1 / figuresOf(type, level).fireRate;
}

/**
 * The MOST air can take off a lone `type` at `level` in one fire interval.
 *
 * `airLoss(T) = (RAD_K * radiatorEdges + BASE_K * plainEdges) * (H_T / 100)`,
 * divided by the tower's mass (`specs/heat.md`). It is proportional to heat, so
 * the bound is the value at the trip itself — no emitter anywhere in `[0, 100]`
 * sheds faster than this. A check that wants a shot to carry a gun over `100`
 * from a stated opening heat compares that shot's gain against this.
 */
export function maxAirLossPerIntervalOf(type: TowerType, level = 1): number {
  const account = loneEdgeAccount(type);
  const perSecondAtTheTrip =
    (RAD_K * account.radiatorEdges + BASE_K * account.plainEdges) /
    massOf(type);
  return perSecondAtTheTrip * fireIntervalOf(type, level);
}

/**
 * How a lone emitter's perimeter is spent when every one of its faces looks onto
 * open floor.
 *
 * `specs/heat.md`: "a face is one edge-tile long per tile of the footprint's
 * side", so a `size`-tile footprint has `size` edge-tiles on each of its four
 * faces, and `specs/towers.md` names which of those faces are radiators. Nothing
 * stands against a lone tower, so every edge-tile sheds.
 */
function loneEdgeAccount(type: TowerType): {
  radiatorEdges: number;
  plainEdges: number;
} {
  const def = emitterDefOf(type);
  const radiatorFaces = def.radiators.length;
  return {
    radiatorEdges: def.size * radiatorFaces,
    plainEdges: def.size * (4 - radiatorFaces),
  };
}

/* -------------------------------------------------------------------------- */
/* Where a scenario stands                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The anchor every lone tower in this group is posed at: the first quiet site.
 *
 * Clear of all four openings and of both straight vent-to-exhaust corridors, so
 * nothing posed here lengthens a route, and six tiles from every other named
 * anchor, so no tower posed here abuts anything (`validation/none/fixtures.ts`).
 * All four of its faces therefore look onto open floor, which is what makes the
 * air term of every reading below the LONE tower's own.
 */
export const TRIP_SITE: Tile = FREE_SITE;

/** The plain ground unit every mark in this group is: ordinary in every respect. */
export const MARK_TYPE: SurgeType = "mote";

/**
 * How far east of the anchor a mark stands, in tiles.
 *
 * Geometry, not a tolerance. Four tiles east of a 2x2 footprint's anchor puts
 * the mark about `3.5` tiles from the footprint centre range is measured from,
 * inside the SHORTEST range on the roster — the Stutter's `5.0` tiles
 * (`specs/towers.md`) — with room to spare, and off the footprint itself. No
 * check in this group is about range, so no reading here may sit near one.
 */
export const MARK_OFFSET = 4;

/** Hp far past anything a scenario here removes, so nothing dies unasked. */
export const MARK_HP = 1_000_000;

/* -------------------------------------------------------------------------- */
/* The real path                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Open an empty run with one emitter of `type` at {@link TRIP_SITE}, at `level`,
 * opening at `heat`, with BOTH faculties on and a stationary mark in range.
 *
 * This is the arrangement in which a build's own heat model produces a trip. The
 * tower is posed bare through `poseTower`, so `firingEnabled` and
 * `thermalEnabled` are both true (`specs/instrumentation.md`) and every term of
 * the crossing — the shot's gain, the air it sheds between shots, the write, the
 * crossing test — is the build's. The heat is posed LAST so nothing can be added
 * to it on the way in, and the mark's motion is off so it cannot walk out of
 * range while the shots that carry the gun over are waited for.
 *
 * `startRun` empties both rosters and shuts the world gate, so the floor holds
 * this emitter and this mark and nothing else.
 */
export async function poseLiveGun(
  h: Harness,
  type: TowerType,
  heat: number,
  level = 1,
): Promise<{ id: number; mark: number }> {
  await startRun(h);
  const id = await poseTower(h, type, TRIP_SITE.col, TRIP_SITE.row);
  if (level !== 1) await h.debug.setTowerLevel(id, level);
  await h.debug.setTowerHeat(id, heat);
  const mark = await poseTarget(
    h,
    MARK_TYPE,
    TRIP_SITE.col + MARK_OFFSET,
    TRIP_SITE.row,
    MARK_HP,
  );
  return { id, mark };
}

/**
 * How many fire intervals a sweep toward the trip may run for before the build
 * is called broken.
 *
 * The first shot of a run lands one full interval after the target is acquired
 * (`specs/combat.md`), and a check in this group opens its gun at a heat one
 * shot carries over `100` from — so a conformant build trips on the FIRST shot
 * and the rest of the window is slack against a build that stages its
 * accumulator differently. Five intervals is generous and still bounded. This
 * says how long to look, not how far a build may miss by: what the sweep must
 * find is stated in the check that runs it.
 */
export const TRIP_SWEEP_INTERVALS = 5;

/** Frames of the default clock covering that many of `type`'s fire intervals. */
export function tripSweepFrames(type: TowerType, level = 1): number {
  return framesFor(TRIP_SWEEP_INTERVALS * fireIntervalOf(type, level));
}

/**
 * Advance one frame at a time until the emitter `id` reports `tripped`, and hand
 * back where the sweep stopped.
 *
 * A frame at a time, because the frame the crossing is written on is the frame
 * every reading about the trip's onset belongs to: the cooldown a build hands
 * the tower is `TRIP_TIME` at that moment and a hundredth of a second less a
 * frame later. It asserts nothing — a sweep that never found the trip comes back
 * with `hit` false and the check that ran it says what that means.
 */
export function sweepToTheTrip(
  h: Harness,
  id: number,
  type: TowerType,
  level = 1,
): Promise<UntilResult> {
  return h.until(
    (snapshot) => requireTower(snapshot, id, "the firing emitter").tripped,
    { poll: 1, maxFrames: tripSweepFrames(type, level) },
  );
}

/* -------------------------------------------------------------------------- */
/* Reading one                                                                */
/* -------------------------------------------------------------------------- */

/** A tower as the build's own `snapshot` reports it right now. */
export async function readTower(
  h: Harness,
  id: number,
  doing: string,
): Promise<TowerView> {
  return requireTower(await h.snapshot(), id, doing);
}

/** A mark's hp right now. */
export async function readHp(
  h: Harness,
  id: number,
  doing: string,
): Promise<number> {
  return requireUnit(await h.snapshot(), id, doing).hp;
}
