// Meltdown — surge/scenario: how this group reaches the four things a surge item
// is about, and nothing about what any of them is worth. GROUP-LOCAL.
//
// `specs/surge.md` gives each type a row of figures and `specs/waves.md` gives
// the progression that releases them, and between them the items in this group
// need exactly five arrangements:
//
//   - A UNIT STANDING STILL, so the figures it carries at the moment it enters —
//     its maximum hp, its base speed, whether it flies — are read off the frame it
//     arrived on and not off a frame of walking.
//   - A DEATH, which cannot be posed. `setUnitHp` "does not kill the unit: death
//     belongs to the damage path" (`specs/instrumentation.md`), so a point about
//     what a kill is worth stands one gun beside one mark of a single hit point
//     and lets the gun fire.
//   - A LEAK, which cannot be posed either: a unit is removed on the frame the
//     tile its centre occupies is an opening tile of its assigned exhaust
//     (`specs/mazing.md`), so a leaker is stood one tile short of that opening and
//     walks the last tile under its own power.
//   - A SLOW ARRIVING, which is the sixth column of the roster table and no field
//     at all: `specs/surge.md` says only whether a type is slowable, and
//     `specs/combat.md` owns what applies one. So the column is read the way the
//     game reaches it — a cold Rime fires on a mark of the type and the `slowed`
//     flag is read off the mark afterwards, with the Rime's own damage tally
//     standing as the precondition that the shot landed at all.
//   - A WAVE BEING RELEASED, which is the world gate `setWaveSpawning` turned back
//     on. Two ways in are needed and both are here: {@link poseWavePhase}, which
//     poses the wave phase and hands the spawner a stated number of units to
//     release, and {@link armWave}, which leaves the run to enter its own wave off
//     a build timer at `0` — the only route by which the BUILD decides how many
//     units the wave owes.
//
// THIS FILE FIXES ARRANGEMENT AND GEOMETRY ALONE. Not one figure a point asserts
// and not one tolerance is decided here. Where a gun stands and how long a drive
// runs before it gives up are geometry — they say WHERE a scenario is posed and
// HOW LONG it is watched, never how far a build may miss a figure by — and every
// bound a point asserts is stated in that point beside the figure `specs/surge.md`
// or `specs/waves.md` fixes for it.
//
// IT LIVES IN THE GROUP because no other group releases a wave. `harness.ts`
// carries what every group needs — the run, the pinned tower, the walker, the
// stationary target — and this file is what the surge items build out of them.

import { COLS, RIGHT_EXHAUST_ROWS, type SurgeType } from "../constants";
import { fail } from "../assert";
import {
  posePinnedTower,
  poseTarget,
  poseWalker,
  startRun,
  ticksFor,
  tileCenter,
  towerById,
  unitById,
  type DifficultyName,
  type Harness,
  type MeltdownSnapshot,
  type ModeName,
  type Phase,
  type TowerSnapshot,
  type UnitSnapshot,
  type VentName,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Reading the roster                                                         */
/* -------------------------------------------------------------------------- */

/** The unit carrying `id`, or a failure saying the roster no longer holds it. */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(
      `a unit with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.surge.map((entry) => entry.id),
    );
  }
  return unit;
}

/* -------------------------------------------------------------------------- */
/* A unit standing still                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One unit of `type` entered at the left vent with its locomotion held off, and
 * its id.
 *
 * The arrangement every stats point reads its row off. `addUnit` enters the unit
 * "into the same pathing and combat systems the wave spawner uses" and gives it
 * "its base hp scaled for the current wave" (`specs/instrumentation.md`), so what
 * the snapshot then reports is what the type carries. Motion off is the isolation
 * `specs/instrumentation.md` provides for exactly this: "the unit holds its
 * position, and its route is still computed from the tile it stands on", so the
 * figures are read off a unit that has not walked anywhere and nothing about
 * crossing the floor — which `mazing` decides — is exercised.
 */
export function poseStill(h: Harness, type: SurgeType): number {
  const id = poseWalker(h, type, "left");
  h.debug.setUnitMotion(id, false);
  return id;
}

/* -------------------------------------------------------------------------- */
/* A death                                                                    */
/* -------------------------------------------------------------------------- */

/** The Arc's footprint top-left: open floor, well clear of every opening. */
export const GUN = { col: 20, row: 10 } as const;

/**
 * The tile the mark stands on: three tiles right of the Arc's anchor, so it is
 * off the 2x2 footprint and comfortably inside the Arc's `6.0`-tile range,
 * measured from the footprint's centre (`specs/combat.md`).
 */
export const MARK = { col: 23, row: 10 } as const;

/**
 * The hp a mark is posed with: the least a live unit can carry.
 *
 * A kill is what these points reach, and the smallest possible target is what
 * makes the kill follow from the shot landing at all rather than from any figure
 * `specs/combat.md` gives the shot. "A unit's hp never falls below `0`, and a unit
 * at `0` hp is removed on that frame" is what turns one shot into the death.
 */
export const MARK_HP = 1;

/**
 * How long a kill is waited for: six seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how far
 * a build may miss a figure by. An Arc at its specified `2.0` shots a second lands
 * its first shot half a second in (`specs/combat.md`), so six seconds is a dozen
 * intervals: a build whose fire rate or per-shot damage is off still removes a
 * single hit point inside the window.
 */
export const KILL_TICKS = ticksFor(6);

/**
 * An Arc at {@link GUN} whose guns run and whose heat cannot move, and its id.
 *
 * `setTowerThermal(id, false)` holds the tower's part in the heat model while it
 * goes on acquiring targets and firing (`specs/instrumentation.md`), so the heat
 * that scales its damage stays where it is posed and no trip can interrupt the
 * drive. The heat posed is `0`, which is what a placed tower starts at, because
 * nothing in this group is about heat.
 */
export function poseGun(h: Harness): number {
  return posePinnedTower(h, "arc", GUN.col, GUN.row, 0);
}

/**
 * A `type` of one hit point holding {@link MARK}, and its id.
 *
 * Motion off keeps the reading unambiguous: the mark cannot walk out of the Arc's
 * range, and it cannot reach an exhaust and leak instead of dying, which costs
 * lives rather than paying a bounty.
 */
export function poseMark(h: Harness, type: SurgeType): number {
  return poseTarget(h, type, MARK.col, MARK.row, MARK_HP);
}

/** Run until the surge roster is empty, and say whether it emptied. */
export async function runUntilGone(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: KILL_TICKS,
    poll: 4,
  });
  return swept.hit;
}

/* -------------------------------------------------------------------------- */
/* A leak                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * `specs/floor.md` puts the right exhaust on tiles `(49, 16)` through `(49, 19)`
 * and gives the left vent the right exhaust as its fixed opposite, so a unit
 * entered at the left vent and stood here has one tile left to travel. A flyer
 * stood here is the same distance from the midpoint of that opening, which is the
 * point `specs/mazing.md` sends it to. Keeping the walk to one tile is what stops
 * a leak point spending game time on a crossing `mazing` already decides.
 */
export const LEAK_TILE = {
  col: COLS - 2,
  row: RIGHT_EXHAUST_ROWS[1],
} as const;

/**
 * How long a leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance. The slowest unit on the roster, the Core at
 * `30` logical units a second (`specs/surge.md`), covers the one `TILE` (`19`) it
 * has left in under two thirds of a second, so three seconds carries a build
 * walking at a fifth of that speed out through the opening and the leak these
 * points read rests on the unit reaching its exhaust rather than on how fast it
 * got there.
 */
export const LEAK_TICKS = ticksFor(3);

/**
 * A `type` walking under its own power with one tile left to its exhaust, and its
 * id.
 *
 * Nothing is posed beyond the entry and the position: its motion is on, and its
 * route is recomputed from the tile the position falls in
 * (`specs/instrumentation.md`), so the walk out is the game's own.
 */
export function poseLeaker(h: Harness, type: SurgeType): number {
  const id = poseWalker(h, type, "left");
  const at = tileCenter(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}

/** Run until the leaker is gone from the roster, and say whether it went. */
export async function runUntilLeaked(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: LEAK_TICKS,
    poll: 2,
  });
  return swept.hit;
}

/* -------------------------------------------------------------------------- */
/* A slow arriving                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The hp a mark is given while a slow is read: a million, far past anything a
 * window of a Rime's shots removes.
 *
 * Slowability is read off a unit that is still standing, so the mark must outlive
 * the window whatever its row of `specs/surge.md` says: a Swarm carries `12` hp
 * and a Rime's `4` a shot would take it off the floor long before the reading.
 * The ceiling is posed rather than the damage suppressed because
 * `specs/instrumentation.md` gives no gate for a shot's damage, and because what
 * the reading is about — whether a slow touched the unit — is untouched by how
 * much hp it has.
 */
export const SLOW_MARK_HP = 1e6;

/**
 * How long the Rime is left firing before the slow is read: two and a half
 * seconds of game time.
 *
 * Geometry rather than a tolerance. A Rime at its specified `2.4` shots a second
 * (`specs/combat.md`) lands its first inside half a second and another every
 * `0.42`, and a slow lasts `SLOW_TIME` (`1.5`) seconds from the shot that applied
 * it, so the window carries several shots and ends with one of them still live.
 * A build whose fire rate is off by a factor of four still lands one.
 */
export const SLOW_TICKS = ticksFor(2.5);

/**
 * A `type` at {@link MARK} under a cold Rime's fire, and what the two of them read
 * afterwards.
 *
 * The slowable column of `specs/surge.md`'s table, reached on the real path. The
 * Rime is posed at heat `0`, which `specs/combat.md` makes the STRONGEST slow in
 * the game — `slowFactor(0)` is the full `slowCeil` — so a build that applies any
 * slow at all applies one here, and `setTowerThermal(id, false)` holds it there:
 * the tower goes on acquiring and firing while its heat cannot climb, so the slow
 * cannot fade as it heats and no trip can silence it mid-window
 * (`specs/instrumentation.md`).
 *
 * Nothing about the slow's STRENGTH is read — that is `combat/`'s, which decides
 * the ceiling, its fall with heat and its stacking. What is read back is the
 * `slowed` flag, which is the specification's own word for the column.
 *
 * `struck` comes back with it so a point can state, as its precondition, that the
 * Rime's shot actually landed: without it, "carried no slow" is the reading a
 * silent tower gives exactly as readily as an immune unit does.
 */
export async function slowTouches(
  h: Harness,
  type: SurgeType,
): Promise<{ slowed: boolean; struck: boolean }> {
  startRun(h);
  const rime = posePinnedTower(h, "rime", GUN.col, GUN.row, 0);
  const mark = poseTarget(h, type, MARK.col, MARK.row, SLOW_MARK_HP);

  await h.advance(SLOW_TICKS);

  const settled = h.snapshot();
  return {
    slowed: unitOf(settled, mark).slowed,
    struck: towerOf(settled, rime).damageDealt > 0,
  };
}

/** The tower carrying `id`, or a failure saying the roster no longer holds it. */
export function towerOf(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(
      `a tower with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.towers.map((entry) => entry.id),
    );
  }
  return tower;
}

/* -------------------------------------------------------------------------- */
/* A wave being released                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The wave phase of wave `wave`, with `pending` units still owed and the run's
 * own release of surge back on.
 *
 * The route a point takes when it is about WHICH units a wave releases and not
 * about how many: the count is the caller's, so the spawner is handed the
 * smallest number of releases the point can read its answer off and no wave
 * floods the floor. `setPhase` "runs no entry effect" (`specs/instrumentation.md`),
 * so the phase here is a precondition and the RELEASE is what the drive then
 * reaches through the spawner's own clock.
 *
 * `startRun` opens on an empty floor with both rosters cleared, so every unit that
 * turns up afterwards was released by the run.
 */
export function poseWavePhase(
  h: Harness,
  wave: number,
  pending: number,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): void {
  startRun(h, mode, difficulty);
  h.debug.setWave(wave);
  h.debug.setPhase("wave");
  h.debug.setWavePending(pending);
  h.debug.setWaveSpawning(true);
}

/**
 * A build phase for wave `wave` with its timer at `0` and the world gate open, so
 * the RUN enters its own wave on the next frame.
 *
 * The route a point takes when the build has to be the one that decides what the
 * wave owes: `specs/waves.md` starts the wave when the build timer reaches `0`,
 * and the wave it starts carries the type and the size the progression gives it.
 * Nothing here says how many units that is — the point reads it.
 *
 * No frame is advanced, so the caller's first advanced frame is the frame the wave
 * begins on.
 */
export function armWave(
  h: Harness,
  wave: number,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): void {
  startRun(h, mode, difficulty);
  h.debug.setWave(wave);
  h.debug.setWaveSpawning(true);
  h.debug.setBuildTimer(0);
}

/** One unit the drive saw arrive, as it read on the frame it first appeared. */
export interface Release {
  id: number;
  type: SurgeType;
  vent: VentName;
  /** The tile its centre fell in on that frame. */
  col: number;
  row: number;
  /** Its centre, in logical stage units, on that frame. */
  x: number;
  y: number;
  /** The simulation time the game had accumulated on that frame. */
  at: number;
  /** The phase the run read on that frame. */
  phase: Phase;
}

/** What a drive saw of a wave being released. */
export interface Watch {
  /** Every unit that appeared, in the order it first appeared. */
  releases: Release[];
  /**
   * The simulation time on the first frame the phase read `wave`, or `null` where
   * it never did.
   *
   * What "the first on the frame the wave begins" (`specs/waves.md`) is measured
   * against, and it is read off the same frame-by-frame sweep the releases are, so
   * the two are the same clock.
   */
  waveBegan: number | null;
}

/** How a release is watched, and what is done to each unit as it turns up. */
export interface WatchOptions {
  /** Frames between two samples. Every frame by default. */
  poll?: number;
  /**
   * Run once for each unit, the moment it is first seen.
   *
   * What a point about ENTERING uses to hold each arrival where it arrived —
   * `setUnitMotion(id, false)` leaves the unit's route computed from the tile it
   * stands on and stops it walking away (`specs/instrumentation.md`), so a long
   * release can be watched to its end without a single unit reaching an exhaust
   * and taking lives with it. A point about crossing the floor passes nothing and
   * lets every unit walk.
   */
  onRelease?: (release: Release) => void;
}

/**
 * Advance `frames` frames, sampling as `options.poll` asks, and record every unit
 * the moment it first appears.
 *
 * A release is an EVENT rather than a field, so it is caught by watching: a unit
 * is recorded the first frame the roster holds its id, together with the
 * simulation time and the phase of that frame. Nothing is asserted here — a drive
 * that saw no unit hands back an empty list, and what that means is the point's to
 * state.
 *
 * `poll` is the caller's, because how finely a point needs to know WHEN a unit
 * arrived is the point's business: a point reading only which types turned up
 * samples coarsely, and a point measuring the cadence samples every frame.
 */
export async function watchReleases(
  h: Harness,
  frames: number,
  options: WatchOptions = {},
): Promise<Watch> {
  const releases: Release[] = [];
  const seen = new Set<number>();
  let waveBegan: number | null = null;

  const step = Math.max(1, options.poll ?? 1);
  for (let done = 0; done < frames; done += step) {
    await h.advance(Math.min(step, frames - done));
    const snapshot = h.snapshot();
    if (waveBegan === null && snapshot.phase === "wave") {
      waveBegan = snapshot.simTime;
    }
    for (const unit of snapshot.surge) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      const release: Release = {
        id: unit.id,
        type: unit.type,
        vent: unit.vent,
        col: unit.col,
        row: unit.row,
        x: unit.x,
        y: unit.y,
        at: snapshot.simTime,
        phase: snapshot.phase,
      };
      releases.push(release);
      options.onRelease?.(release);
    }
  }

  return { releases, waveBegan };
}
