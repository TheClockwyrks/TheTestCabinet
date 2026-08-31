// Meltdown — how this group reaches a unit, a kill, a leak and a wave.
// GROUP-LOCAL.
//
// `specs/surge.md` tabulates six types and states what each one carries, and
// `specs/waves.md` states what a wave carries and how it is released. Between
// them they name four situations, and every item in this group is read in one of
// them:
//
//   THE UNIT AS IT ENTERS. What `addUnit` appended, read straight off the
//   snapshot. Nothing is driven: hp, speed and flight are fields the roster row
//   fixes, and a drive would only give something else the chance to move them.
//
//   A KILL. `specs/economy.md` pays a bounty "On the frame a unit's hp reaches
//   `0`", and `setUnitHp` "does not kill the unit: death belongs to the damage
//   path" (`specs/instrumentation.md`), so a bounty and a death are reached
//   through a real shot. One Arc, one mark of one hp, and nothing else on the
//   floor.
//
//   A LEAK. `specs/surge.md` charges a leak "on the frame it reached its assigned
//   exhaust", which is likewise a transition rather than a field. So a unit is
//   posed one tile short of its exhaust and walks — or flies — the last tile
//   under its own power.
//
//   A WAVE, RELEASED BY THE RUN ITSELF. What a wave carries cannot be posed:
//   `setWavePending` sets the very count under test and `setPhase` "runs no entry
//   effect", releasing nothing. So the run's own release is turned back on and
//   the wave is BEGUN with a send, which is what makes the wave items the ones
//   the world gate belongs to.
//
// THIS FILE FIXES ARRANGEMENT AND GEOMETRY ALONE. Not one figure an item asserts
// and not one tolerance is decided here. Where the gun stands and how long a
// drive runs say WHERE a scenario is posed and HOW LONG it is watched, never how
// far a build may miss by; every threshold is stated in the check that asserts
// it, beside the specification figure it came from.

import { fail } from "../assert";
import {
  COLS,
  RIGHT_EXHAUST_ROWS,
  TOWER_DEFS,
  WAVE_SPAWN_INTERVAL,
  emitterStats,
  tileCX,
  tileCY,
  type DifficultyId,
  type EmitterDef,
  type SurgeType,
  type Tile,
  type TowerType,
  type Vent,
} from "../constants";
import {
  framesFor,
  framesForShots,
  poseTarget,
  posePinnedTower,
  poseWalker,
  requireUnit,
  startRun,
  tapAction,
  type Harness,
  type MeltdownSnapshot,
  type UnitView,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* One gun, one mark                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The gun's footprint anchor, and the tile its mark stands on.
 *
 * Both are quiet: a 2x2 footprint at `(20, 10)` covers columns `20..21` and rows
 * `10..11`, clear of the left vent's corridor (rows `16..19`) and of the top
 * vent's (columns `22..29`), so no gun posed here lengthens a route
 * (`specs/floor.md`). The mark stands three tiles east of the anchor, which puts
 * it off the footprint and `2.55` tiles from the footprint centre range is
 * measured from — comfortably inside the Arc's `6.0` and the Rime's `5.5`
 * (`specs/towers.md`), so nothing here reads a range boundary by accident.
 */
export const GUN: Tile = { col: 20, row: 10 };
export const MARK: Tile = { col: 23, row: 10 };

/**
 * Hp far past anything a scenario here removes, for a mark that must survive
 * being shot.
 *
 * A slow reading wants the unit still standing after the shot that applied it,
 * so the mark is posed with an hp pool no drive in this group can empty.
 */
export const TOUGH_HP = 100_000;

/**
 * The hp a mark that is meant to DIE is posed with: the least a live unit can
 * carry.
 *
 * The smallest possible target is what makes the death follow from the shot
 * landing at all rather than from any figure `specs/combat.md` gives the shot, so
 * a build whose per-shot damage or fire rate is off still reaches the death the
 * bounty and the removal are read on.
 */
export const FRAGILE_HP = 1;

/**
 * An emitter of `type` at {@link GUN} whose guns run and whose heat cannot move,
 * and its id.
 *
 * `setTowerThermal(id, false)` holds the tower's part in the heat model while it
 * goes on acquiring targets and firing at its rate (`specs/instrumentation.md`),
 * so the heat that scales its damage stays where it is posed and no trip can
 * interrupt the drive. The heat is `0`, the heat a placed tower starts at,
 * because nothing in this group is about heat.
 */
export function poseGun(h: Harness, type: TowerType): Promise<number> {
  return posePinnedTower(h, type, GUN.col, GUN.row, 0);
}

/**
 * A stationary mark of `type` on {@link MARK}, and its id.
 *
 * Motion off is what keeps the reading unambiguous: the mark cannot walk out of
 * the gun's range, and it cannot reach an exhaust and leak instead of dying,
 * which pays an entirely different figure.
 */
export function poseMark(
  h: Harness,
  type: SurgeType,
  hp: number,
): Promise<number> {
  return poseTarget(h, type, MARK.col, MARK.row, hp);
}

/**
 * How long a kill is waited for: six seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how
 * far a build may miss a figure by. An Arc at its specified `2.0` shots per
 * second lands its first shot half a second in (`specs/combat.md`), so six
 * seconds is a dozen intervals: a build whose fire rate or per-shot damage is off
 * still removes a single hp inside the window.
 */
export const KILL_FRAMES = framesFor(6);

/** Run until the surge roster is empty, and say whether it emptied. */
export async function runUntilGone(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: KILL_FRAMES,
    poll: 4,
  });
  return swept.hit;
}

/* -------------------------------------------------------------------------- */
/* One leak                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on the row
 * a flyer aims at.
 *
 * `specs/floor.md` puts the right exhaust on tiles `(49, 16)` through `(49, 19)`
 * and assigns the left vent's units that exhaust for their whole life, so a
 * walker posed here has one orthogonal step left and reaches its exhaust in a
 * fraction of a second. Row `18` rather than any other of the four because a
 * flyer aims at "the midpoint of that opening's run of tile centres"
 * (`specs/mazing.md`), `(958.5, 360)`, which falls in tile `(49, 18)` — so the
 * one tile of walking and the short hop of flight both end in the opening, and
 * the six types are read through the same arrangement.
 */
export const LEAK_TILE: Tile = { col: COLS - 2, row: RIGHT_EXHAUST_ROWS[2] };

/**
 * How long a leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance. The slowest thing on the roster is the Core
 * at `30` logical units per second (`specs/surge.md`), which covers the one
 * `TILE` (`19`) it has left in `0.63` seconds, so three seconds carries a build
 * walking at a fifth of that speed out through the opening. The leak these items
 * read therefore rests on the unit reaching its exhaust rather than on how fast
 * it got there.
 */
export const LEAK_FRAMES = framesFor(3);

/**
 * A unit of `type` walking or flying under its own power with one tile left to
 * its exhaust, and its id.
 *
 * Nothing is posed beyond the entry and the position: its motion is on, its hp is
 * what its type and the current wave give it, and its route is recomputed from
 * the tile the position falls in (`specs/instrumentation.md`), so the way out is
 * the game's own.
 */
export async function poseLeaker(h: Harness, type: SurgeType): Promise<number> {
  const id = await poseWalker(h, type, "left");
  await h.debug.setUnitPosition(
    id,
    tileCX(LEAK_TILE.col),
    tileCY(LEAK_TILE.row),
  );
  return id;
}

/** Run until the leaker is gone from the roster, and say whether it went. */
export async function runUntilLeaked(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: LEAK_FRAMES,
    poll: 2,
  });
  return swept.hit;
}

/* -------------------------------------------------------------------------- */
/* One wave, released by the run itself                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lives no leak in this group can exhaust.
 *
 * A wave crossing an undefended floor leaks in full, and the twentieth leak would
 * take a Containment run's `20` lives to `0` and end it — which would stop the
 * spawner in the middle of the very release being counted (`specs/waves.md`). The
 * lives are a run figure no item here is about, so they are posed out of the way
 * rather than defended with towers. Five orders past the costliest wave the game
 * can field, so it reads unmistakably as a pose.
 */
export const UNENDING_LIVES = 1_000_000;

/**
 * Open a Containment run at wave `wave` and BEGIN that wave with a send.
 *
 * The four steps, and why each is here:
 *
 *   - `startRun` empties both rosters, poses a live build phase and shuts the
 *     world gate, so the floor holds nothing but what this wave releases.
 *   - `setWave` moves the run to the wave under test. "`setWave` rebuilds
 *     nothing, releases nothing, and clears nothing; the coming wave's type and
 *     count and the hp scaling follow it" (`specs/instrumentation.md`).
 *   - The lives are posed past every leak, above.
 *   - The world gate goes back ON, because the release is what these items are
 *     about, and the send begins the wave: `specs/waves.md` gives a build phase
 *     two ways to end, its timer reaching `0` and a send, and the send is the one
 *     that does not spend fifteen seconds of game time first.
 *
 * `arrange` runs on the emptied floor, after the run is posed and before the
 * send, for the one item whose scenario needs something standing there when the
 * wave arrives. It is not a place to put a threshold.
 */
export async function openWave(
  h: Harness,
  wave: number,
  difficulty: DifficultyId = "medium",
  arrange?: () => Promise<void>,
): Promise<void> {
  await startRun(h, "containment", difficulty);
  await h.debug.setWave(wave);
  await h.debug.setLives(UNENDING_LIVES);
  if (arrange !== undefined) await arrange();
  await h.debug.setWaveSpawning(true);
  await tapAction(h, "send");
}

/**
 * How long a wave's first unit is waited for: two seconds of game time.
 *
 * Geometry rather than a tolerance. `specs/waves.md` puts the first release "on
 * the frame the wave begins", so a conforming build has released one before this
 * sweep takes its first sample; the window is wide enough that a build releasing
 * its first a whole `WAVE_SPAWN_INTERVAL` in is still read rather than lost, and
 * `surge/spawn-cadence` is the item that decides which of the two it did.
 */
export const FIRST_UNIT_FRAMES = framesFor(2);

/**
 * The first unit the wave released, sampled every frame so it is caught where it
 * entered.
 *
 * Fails the check when the wave released nothing at all inside
 * {@link FIRST_UNIT_FRAMES}, naming the release as what was needed.
 */
export async function firstRelease(h: Harness): Promise<{
  unit: UnitView;
  snapshot: MeltdownSnapshot;
}> {
  const swept = await h.until((snapshot) => snapshot.surge.length >= 1, {
    maxFrames: FIRST_UNIT_FRAMES,
    poll: 1,
  });
  if (!swept.hit) {
    fail(
      `the wave to release its first unit within ${FIRST_UNIT_FRAMES} frames ` +
        `of the send (specs/waves.md)`,
      "the surge roster was still empty",
    );
  }
  return { unit: swept.snapshot.surge[0], snapshot: swept.snapshot };
}

/** One unit as it was first seen: what a release is read as. */
export interface Arrival {
  id: number;
  type: SurgeType;
  vent: Vent;
  col: number;
  row: number;
}

/**
 * How much game time separates two samples of a release, and how many frames of
 * it each sample covers.
 *
 * Geometry rather than a tolerance: it says how often the release is looked at,
 * not how far a build may miss by. A third of `WAVE_SPAWN_INTERVAL` is fine
 * enough that two releases never share a sample, and the shortest crossing on an
 * undefended floor is several seconds, so no unit can appear and be gone between
 * two samples. The frames inside a sample are coarse because nothing about motion
 * is read across a release: the spawner integrates game time like every other
 * rate (`specs/waves.md`), so a sample divided into six frames releases exactly
 * what one divided into sixty does.
 */
export const SAMPLE_SECONDS = WAVE_SPAWN_INTERVAL / 3;
export const SAMPLE_HZ = 30;

/**
 * Watch a release for `seconds` of game time and hand back every unit that
 * arrived, in the order it arrived.
 *
 * AN ARRIVAL IS AN ID THAT WAS NOT THERE ON THE PREVIOUS SAMPLE, and the reason
 * it is not simply an id never seen before is worth stating. The specification
 * says only that "an id is never reused WHILE THE ENTITY HOLDING IT IS LIVE"
 * (`specs/instrumentation.md`), so a build that draws its ids from a pool and
 * returns them on death is conformant — and a long release outlives its earliest
 * units, so an id freed by a leak may legitimately come back on a later one.
 * Counting ids never seen before would silently drop those units and read a short
 * wave off a correct build. A unit never leaves the floor and returns, so an id
 * absent from one sample and present in the next is an arrival either way.
 *
 * A unit that has already leaked by the end of the window is still in the list:
 * it was counted where it arrived. The gathering happens inside the sweep's
 * predicate because a sample is one crossing into the page and a separate read
 * would double the cost of every one of them.
 *
 * The whole of one release goes through a SINGLE call, because each call starts
 * with an empty idea of what is on the floor and would count everything standing
 * there as having just arrived.
 */
export async function watchRelease(
  h: Harness,
  seconds: number,
): Promise<Arrival[]> {
  const arrivals: Arrival[] = [];
  let present = new Set<number>();
  const gather = (snapshot: MeltdownSnapshot): void => {
    const now = new Set<number>();
    for (const unit of snapshot.surge) {
      now.add(unit.id);
      if (present.has(unit.id)) continue;
      arrivals.push({
        id: unit.id,
        type: unit.type,
        vent: unit.vent,
        col: unit.col,
        row: unit.row,
      });
    }
    present = now;
  };

  gather(await h.snapshot());
  await h.skipUntil(
    (snapshot) => {
      gather(snapshot);
      return false;
    },
    { maxSeconds: seconds, pollSeconds: SAMPLE_SECONDS, hz: SAMPLE_HZ },
  );
  return arrivals;
}

/**
 * How long a whole release of `size` units is watched: the cadence it takes,
 * plus three seconds.
 *
 * `specs/waves.md` releases the first unit on the frame the wave begins and one
 * every `WAVE_SPAWN_INTERVAL` after it, so `size` units take
 * `(size - 1) * WAVE_SPAWN_INTERVAL`. The three seconds past it are where a build
 * that kept releasing after the last one is caught, and they are five intervals
 * of margin for a build whose cadence runs a little slow — enough that a caller
 * reading a short count is reading the build rather than the window, which the
 * callers also state for themselves by requiring the release to have finished.
 */
export function releaseSeconds(size: number): number {
  return (size - 1) * WAVE_SPAWN_INTERVAL + 3;
}

/* -------------------------------------------------------------------------- */
/* The four readings a roster row is made of                                  */
/* -------------------------------------------------------------------------- */
//
// `specs/surge.md` tabulates six columns for each type — HP, Speed, Slowable,
// Flies, Bounty and Leak — and only the first, second and fourth are fields the
// snapshot reports. The other two are figures the game PAYS on an event, and
// slowability is decided by what a Rime's shot does rather than by anything a
// pose can set: "A unit that is not slowable never carries a slow, whatever hits
// it" (`specs/combat.md`), which is a claim about a hit. So each row is read in
// four scenarios, one per situation the specification puts the figures in, and
// each opens its own run so nothing of the last one is left on the floor.

/**
 * The unit `addUnit` just entered at the left vent, read straight off the
 * snapshot. Assumes a run is already open.
 *
 * Nothing is driven and nothing else is posed: hp, speed and flight are what the
 * roster row gives the unit at the moment it enters, and a drive would only give
 * a tower, a slow or a wall the chance to move one of them.
 */
export async function enterUnit(
  h: Harness,
  type: SurgeType,
): Promise<UnitView> {
  const id = await poseWalker(h, type, "left");
  return requireUnit(await h.snapshot(), id, `the ${type} that just entered`);
}

/** The emitter whose shot decides slowability, and the level it is read at. */
export const SLOW_GUN: TowerType = "rime";
export const SLOW_GUN_LEVEL = 1;

/**
 * How far a slow drive runs: half a fire interval past the Rime's first shot.
 *
 * Geometry, not a tolerance. `framesForShots` lands the drive at the furthest
 * point in the fire cycle from either boundary, so exactly one shot has resolved
 * however a build accumulates its frames (`specs/combat.md`). It is well inside
 * `SLOW_TIME` (`1.5` s), so a slow applied by that shot is still live when the
 * reading is taken.
 */
export const SLOW_FRAMES = framesForShots(
  1,
  emitterStats(TOWER_DEFS[SLOW_GUN] as EmitterDef, SLOW_GUN_LEVEL).fireRate,
);

/**
 * Fire one level-I Rime shot, cold, at a `type` that cannot die of it, and hand
 * back the hp it removed and the unit as it stood afterwards.
 *
 * The Rime is pinned, so the heat that decides both its damage and its slow
 * factor cannot move under the reading (`specs/instrumentation.md`), and the mark
 * holds its tile with an hp pool the shot cannot empty, so what is read is the
 * slow rather than a death. The hp removed is handed back so the caller can state,
 * as its precondition, that the shot actually landed: an unslowed unit that was
 * never hit says nothing at all about slowability.
 */
export async function readSlow(
  h: Harness,
  type: SurgeType,
): Promise<{ removed: number; unit: UnitView }> {
  await startRun(h);
  await poseGun(h, SLOW_GUN);
  const mark = await poseMark(h, type, TOUGH_HP);
  const before = requireUnit(
    await h.snapshot(),
    mark,
    `the ${type} before the ${SLOW_GUN} fired`,
  ).hp;
  await h.advance(SLOW_FRAMES);
  const unit = requireUnit(
    await h.snapshot(),
    mark,
    `the ${type} after one ${SLOW_GUN} shot`,
  );
  return { removed: before - unit.hp, unit };
}

/** The emitter every kill in this group is reached through. */
export const KILL_GUN: TowerType = "arc";

/**
 * Kill one `type` on wave `wave` and hand back what its death paid into the
 * money.
 *
 * The phase is `building`, which is what keeps the figure alone: a wave clears
 * only while the phase is `wave` (`specs/waves.md`), so a kill driven in a build
 * phase cannot also pay a wave-clear bonus. Nothing but the one gun and the one
 * mark stands on the floor, so the only event that can move the money is the one
 * death.
 */
export async function readBounty(
  h: Harness,
  type: SurgeType,
  wave = 1,
): Promise<{ died: boolean; paid: number }> {
  await startRun(h);
  if (wave !== 1) await h.debug.setWave(wave);
  await poseGun(h, KILL_GUN);
  await poseMark(h, type, FRAGILE_HP);
  const before = (await h.snapshot()).money;
  const died = await runUntilGone(h);
  return { died, paid: (await h.snapshot()).money - before };
}

/**
 * Leak one `type` on wave `wave` and hand back the lives it cost.
 *
 * The floor is empty but for the leaker, so the only way it can leave the roster
 * is by reaching its exhaust; and the phase is `building`, so the leak cannot
 * also clear a wave and run the transitions a clear carries with it
 * (`specs/waves.md`).
 */
export async function readLeak(
  h: Harness,
  type: SurgeType,
  wave = 1,
): Promise<{ leaked: boolean; spent: number }> {
  await startRun(h);
  if (wave !== 1) await h.debug.setWave(wave);
  await poseLeaker(h, type);
  const before = (await h.snapshot()).lives;
  const leaked = await runUntilLeaked(h);
  return { leaked, spent: before - (await h.snapshot()).lives };
}
