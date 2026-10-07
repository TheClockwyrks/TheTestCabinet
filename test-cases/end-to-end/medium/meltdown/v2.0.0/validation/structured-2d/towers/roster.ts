// towers/roster — the roster read off the build, one figure at a time.
// GROUP-LOCAL.
//
// This group asks one question fourteen times: does the tower the build put on
// the floor carry the figure `specs/towers.md` tabulates for it? Four of those
// figures the snapshot reports outright — `size`, `redline`, `radiatorFaces` and
// a mover's `output` — and one, the build cost, it reports as the `spent` an
// `addTower` opens a tower with (specs/instrumentation.md). THE OTHER FOUR ARE
// NOT REPORTED AT ALL. Range, fire rate, base damage and `heatPerShot` exist only
// in what the tower DOES, so each has to be measured out of the running game, and
// the measurements are written once here rather than six times over.
//
// EVERY DRIVE BELOW POSES ITS OWN WORLD AND MEASURES ONE FIGURE.
//
//   - `targetsMarkAt` asks whether one mark at one distance is acquired at all.
//     Range is a radius from the FOOTPRINT CENTRE (specs/combat.md, Range), so
//     the distance is offered from that centre and nowhere else.
//   - `removalsAtShots` walks a pinned emitter through a fixed number of fire
//     intervals and reports the hp removed by the time it reaches each. The heat
//     is pinned (`posePinnedTower`), so every shot of the drive removes the same
//     amount and a count taken in units of the first shot is exact — which is what
//     separates a reading of the RATE from a reading of the DAMAGE.
//   - `firstShotHeat` opens a live emitter at heat `0`, where air cooling is
//     exactly nothing because specs/heat.md makes it proportional to `H / 100`,
//     and STOPS ON THE FRAME the first shot lands. Every frame of that drive
//     opened at heat `0`, so the whole of what moved the number is the shot's own
//     `heatPerShot / mass`.
//   - `coolingRate` reads the same tower with its guns held, at a heat where the
//     air term is large, over ONE frame. That is the second, independent reading
//     mass appears in, and it is what tells `heatPerShot 10.3` with `mass 1.0`
//     apart from `heatPerShot 20.6` with `mass 2.0` — a single per-shot gain
//     cannot.
//   - `probeValid` asks the game's own placement check whether one footprint would
//     be accepted, which is the only way the specification offers to ask which
//     tiles a standing tower blocked (specs/building.md, Valid and invalid).
//   - The three rotation items commit their copies through the harness's
//     `placeAt`, the real placement act, because their rule is about what PLACING
//     fixes.
//
// NOTHING HERE HOLDS A TOLERANCE. Each function hands back a measurement or a
// specification figure; what the specification requires of it, and how far a
// build may miss by, is stated in the check that took it. The figures restated
// from `constants.ts` — `figuresOf`, `massOf`, `redlineOf`, `costOf`,
// `localRadiators`, `airLossPerSecond` — are the specification's own arithmetic
// with no slack in them at all, and the anchors are geometry: they say WHERE a
// scenario stands, never how far a build may miss by.
//
// WHY EACH DRIVE RE-POSES THROUGH `startRun`. A fire accumulator is per emitter
// and carries between frames (specs/combat.md, The fire clock), and a heat reading
// opened on a tower that had already fired would open above `0`. `startRun` empties
// both rosters and shuts the world gate, so each drive's emitter is a new one with
// a fire clock at zero on a floor holding nothing else.

import { fail } from "../assert";
import {
  BASE_K,
  MAX_HEAT_MULT,
  MIN_HEAT_MULT,
  RAD_K,
  TILE,
  TOWER_DEFS,
  TRIP_HEAT,
  UPGRADE_DAMAGE,
  UPGRADE_FIRE_RATE,
  UPGRADE_HEAT,
  UPGRADE_RANGE,
  moverOutput,
  type EmitterDef,
} from "../constants";
import {
  TICK_HZ,
  footprintCenter,
  poseIdleTower,
  posePinnedTower,
  poseTargetAt,
  poseTower,
  seconds,
  sizeOf,
  startRun,
  ticksFor,
  tileCenter,
  towerById,
  unitById,
  type BuildSnapshot,
  type Face,
  type Harness,
  type MeltdownSnapshot,
  type Point,
  type SurgeType,
  type Tile,
  type TowerSnapshot,
  type TowerType,
  type UnitSnapshot,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The specification's own table                                              */
/* -------------------------------------------------------------------------- */

/** The emitter specs/towers.md tabulates under `type`, narrowed. */
export function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    return fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/** The four figures a level moves, for one emitter (specs/towers.md, Levels). */
export interface Figures {
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
}

/**
 * That emitter's range, fire rate, base damage and `heatPerShot` at `level`.
 *
 * specs/towers.md, Levels: each level above the first adds `UPGRADE_RANGE` to
 * the range and multiplies the other three by `UPGRADE_DAMAGE`,
 * `UPGRADE_FIRE_RATE` and `UPGRADE_HEAT`. That sentence is written out here
 * over the seeded row rather than taken from the `emitterStats` the build's own
 * `src/constants.ts` exports FOR IT TO CALL, because an expectation evaluated
 * by the same function the build evaluates would agree with a build that
 * changed it.
 */
export function figuresOf(type: TowerType, level = 1): Figures {
  const def = emitterDefOf(type);
  const steps = level - 1;
  return {
    range: def.range + UPGRADE_RANGE * steps,
    fireRate: def.fireRate * Math.pow(UPGRADE_FIRE_RATE, steps),
    baseDamage: def.baseDamage * Math.pow(UPGRADE_DAMAGE, steps),
    heatPerShot: def.heatPerShot * Math.pow(UPGRADE_HEAT, steps),
  };
}

/**
 * The heat multiplier at heat `H` against redline `R` (specs/heat.md, Heat is
 * damage): quadratic to the redline, then flat across the plateau to `100`.
 *
 * Restated over the two scalars for the same reason {@link figuresOf} is: the
 * `heatMultiplier` in the build's own `src/constants.ts` is the function the
 * BUILD calls, and an expectation evaluated by it would agree with a build that
 * changed the curve.
 */
export function heatMultiplierOf(heat: number, redline: number): number {
  const ramp = Math.min(heat, redline) / redline;
  return MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * ramp * ramp;
}

/** The thermal mass that divides every change to `type`'s heat. */
export function massOf(type: TowerType): number {
  return emitterDefOf(type).mass;
}

/** The redline specs/towers.md gives `type`. An upgrade never moves it. */
export function redlineOf(type: TowerType): number {
  return emitterDefOf(type).redline;
}

/** The build cost specs/towers.md gives `type`. Movers included. */
export function costOf(type: TowerType): number {
  return TOWER_DEFS[type].cost;
}

/** A mover's output at `level`: the Forge's setpoint, the Sink's per-edge drain. */
export function moverOutputOf(type: "forge" | "sink", level = 1): number {
  return moverOutput(type, level);
}

/** The radiator faces specs/towers.md gives `type`, in LOCAL orientation. */
export function localRadiators(type: TowerType): readonly Face[] {
  return TOWER_DEFS[type].radiators;
}

/** That emitter's range at `level`, as a radius in LOGICAL UNITS. */
export function rangeUnitsOf(type: TowerType, level = 1): number {
  return figuresOf(type, level).range * TILE;
}

/**
 * The heat per second a LONE `type` at rotation `0` sheds to air at `heat`
 * (specs/heat.md, The two-phase resolution), BEFORE its mass divides it.
 *
 * A footprint's perimeter is `size` edge-tiles on each of its four faces, and a
 * lone tower's every edge-tile looks out at open floor or the casing, so its
 * radiator edge-tiles are `size` for each radiator face and its plain edge-tiles
 * are `size` for each of the rest.
 */
export function airLossPerSecond(type: TowerType, heat: number): number {
  const side = sizeOf(type);
  const radiator = side * localRadiators(type).length;
  const plain = side * (4 - localRadiators(type).length);
  return (RAD_K * radiator + BASE_K * plain) * (heat / TRIP_HEAT);
}

/**
 * Frames of the suite's clock that carry an emitter through exactly `shots`
 * shots at `fireRate`, and no further.
 *
 * The fire clock resolves a shot each time its accumulator REACHES the interval
 * `1 / fireRate` and takes the interval off (specs/combat.md, The fire clock), so
 * the shots a stretch of game time contains is `floor(elapsed * fireRate)` —
 * ambiguous by one at an exact multiple of the interval, where a build's own
 * accumulation of floating-point deltas may land a whisker either side. This lands
 * half an interval past the last shot it wants, the furthest point from both
 * boundaries.
 *
 * Geometry, not a tolerance: it says where in the fire cycle a drive stops.
 */
export function ticksForShots(shots: number, fireRate: number): number {
  return Math.round(((shots + 0.5) / fireRate) * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* Where a scenario stands                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Footprint anchors that are quiet in both senses: clear of all four openings and
 * of both straight vent-to-exhaust corridors, so a tower posed at one lengthens
 * neither route; and six tiles apart on both axes, so towers at two of them do not
 * abut even at the Lance's 4x4 footprint and neither conducts with the other.
 *
 * The left corridor runs along rows `16..19` and the top corridor down columns
 * `22..29` (specs/floor.md, The openings), and every anchor below keeps a whole
 * 4x4 out of both.
 */
export const FREE_SITES: readonly Tile[] = [
  { col: 4, row: 4 },
  { col: 10, row: 4 },
  { col: 16, row: 4 },
  { col: 4, row: 10 },
  { col: 10, row: 10 },
  { col: 16, row: 10 },
  { col: 4, row: 24 },
  { col: 10, row: 24 },
  { col: 16, row: 24 },
  { col: 4, row: 30 },
  { col: 10, row: 30 },
  { col: 16, row: 30 },
];

/** The `index`-th quiet anchor, wrapping. */
export function freeSite(index: number): Tile {
  return FREE_SITES[index % FREE_SITES.length];
}

/** The first quiet anchor: where a scenario with one tower in it puts it. */
export const FREE_SITE: Tile = FREE_SITES[0];

/** The point a `type` tower anchored at `at` measures its range from. */
export function gunCentre(type: TowerType, at: Tile = FREE_SITE): Point {
  return footprintCenter(type, at.col, at.row);
}

/** The centre of the ANCHOR TILE of a tower anchored at `at`. */
export function anchorCentre(at: Tile = FREE_SITE): Point {
  return tileCenter(at.col, at.row);
}

/**
 * The surge type a `type` emitter is read against.
 *
 * A Flak "targets flying units alone and ignores every ground unit whatever its
 * range" (specs/combat.md, The target), so a Flak read against a Mote would
 * measure nothing at any distance. The Drift is the roster's flyer; the Mote is
 * the plain ground unit every other emitter is read against.
 */
export function markTypeFor(type: TowerType): SurgeType {
  return type === "flak" ? "drift" : "mote";
}

/**
 * How far from the footprint centre a mark stands when the reading is not about
 * range: three tiles.
 *
 * Geometry, not a tolerance. Three tiles clears the largest footprint on the
 * roster — a 4x4's own half-width is two tiles — so a mark posed here never
 * stands on the gun, and it is well inside the shortest range the roster carries
 * (the Stutter's `5.0`), so no reading that is about something else brushes a
 * range boundary.
 */
export const NEAR_UNITS = 3 * TILE;

/** Hp far past anything a drive here removes, so nothing dies unasked. */
export const MARK_HP = 100_000;

/** A point `units` logical units due east of a `type` gun's footprint centre. */
export function eastOfGun(
  type: TowerType,
  units: number,
  at: Tile = FREE_SITE,
): Point {
  const centre = gunCentre(type, at);
  return { x: centre.x + units, y: centre.y };
}

/* -------------------------------------------------------------------------- */
/* Readings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The tower carrying `id`, or a failure saying the roster no longer holds it.
 *
 * `towerById` answers `undefined` for a tower that is not there, and a check that
 * posed a tower and then found it gone has found a different failure from whatever
 * it went on to read — so it is named as one here rather than surfacing as a
 * reading taken off `undefined`.
 */
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

/** The unit carrying `id`, or a failure saying the roster no longer holds it. */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(
      `a surge unit with id ${id} on the floor (specs/instrumentation.md, ` +
        `Identity)`,
      snapshot.surge.map((entry) => entry.id),
    );
  }
  return unit;
}

/** A tower's world radiator faces as a SET: sorted, because no order is fixed. */
export function sortedFaces(faces: readonly Face[]): Face[] {
  return [...faces].sort();
}

/* -------------------------------------------------------------------------- */
/* Measuring what the snapshot does not report                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a level-I `type` at heat `0` acquires one mark standing `units`
 * logical units due east of its FOOTPRINT CENTRE.
 *
 * One mark and nothing else, so `targeting` answers the range question and no
 * other: with a single candidate on the floor, specs/combat.md's target rule has
 * nothing to choose between. The tower is pinned so the frame the reading is taken
 * on cannot have moved its heat, and one frame is run because an emitter chooses
 * its target inside its own update.
 */
export async function targetsMarkAt(
  h: Harness,
  type: TowerType,
  units: number,
  at: Tile = FREE_SITE,
): Promise<boolean> {
  return targetsPoint(h, type, eastOfGun(type, units, at), at);
}

/**
 * Whether a level-I `type` anchored at `at` and pinned at heat `0` acquires one
 * mark whose centre sits at an exact logical stage point.
 *
 * The general form of {@link targetsMarkAt}, for a reading that offers a mark
 * somewhere other than due east: the mark is alone on the floor, so `targeting`
 * answers the question the point was posed to ask and nothing else.
 */
export async function targetsPoint(
  h: Harness,
  type: TowerType,
  point: Point,
  at: Tile = FREE_SITE,
): Promise<boolean> {
  startRun(h);
  const gun = posePinnedTower(h, type, at.col, at.row, 0);
  const mark = poseTargetAt(h, markTypeFor(type), point.x, point.y, MARK_HP);
  await h.advance(1);
  return towerOf(h.snapshot(), gun).targeting === mark;
}

/**
 * The hp a level-I `type` pinned at heat `0` has removed from one stationary mark
 * by the time it reaches each of `shots` fire intervals, half an interval past
 * each.
 *
 * The heat is pinned, so every shot removes the same amount and the list is a
 * reading of the fire clock in units of one shot; the first entry is also the
 * damage ONE shot removes, which is the base damage scaled by the multiplier at
 * heat `0`.
 */
export async function removalsAtShots(
  h: Harness,
  type: TowerType,
  shots: readonly number[],
): Promise<number[]> {
  startRun(h);
  posePinnedTower(h, type, FREE_SITE.col, FREE_SITE.row, 0);
  const near = eastOfGun(type, NEAR_UNITS);
  const mark = poseTargetAt(h, markTypeFor(type), near.x, near.y, MARK_HP);
  const opened = unitOf(h.snapshot(), mark).hp;
  const rate = figuresOf(type).fireRate;

  const removed: number[] = [];
  let driven = 0;
  for (const count of shots) {
    const wanted = ticksForShots(count, rate);
    await h.advance(wanted - driven);
    driven = wanted;
    removed.push(opened - unitOf(h.snapshot(), mark).hp);
  }
  return removed;
}

/**
 * How many fire intervals a first-shot sweep may run before the emitter is called
 * broken.
 *
 * The first shot of a run lands one full interval after the target is acquired
 * (specs/combat.md, The fire clock), so three intervals is generous and still
 * bounded.
 */
const SHOT_WAIT_INTERVALS = 3;

/**
 * The heat a level-I `type` carries on the frame its FIRST shot lands, opening at
 * heat `0` with both faculties running: its `heatPerShot` divided by its mass, and
 * nothing else.
 *
 * The sweep stops on that frame, so every frame of it opened at heat `0` where air
 * cooling is exactly nothing (specs/heat.md), and a frame of the suite's clock is
 * an order of magnitude shorter than the shortest fire interval on the roster, so
 * no conformant build resolves two shots inside it.
 */
export async function firstShotHeat(
  h: Harness,
  type: TowerType,
): Promise<number> {
  startRun(h);
  const gun = poseTower(h, type, FREE_SITE.col, FREE_SITE.row);
  const near = eastOfGun(type, NEAR_UNITS);
  poseTargetAt(h, markTypeFor(type), near.x, near.y, MARK_HP);
  const swept = await h.until((snapshot) => towerOf(snapshot, gun).heat > 0, {
    poll: 1,
    maxFrames: ticksFor(SHOT_WAIT_INTERVALS / figuresOf(type).fireRate),
  });
  if (!swept.hit) {
    return fail(
      "the emitter's heat to rise by heatPerShot / mass on the frame its " +
        "first shot resolves (specs/heat.md, specs/combat.md)",
      `heat still 0 after ${swept.frames} frames with a ` +
        `${markTypeFor(type)} in range`,
    );
  }
  return towerOf(swept.snapshot, gun).heat;
}

/** The frame every one-frame rate below is measured over, in seconds. */
export const FRAME_SECONDS = seconds(1);

/**
 * The heat per second a lone level-I `type` posed at `heat` sheds over ONE frame,
 * with its guns held.
 *
 * ONE frame because air cooling is proportional to heat: over two, the second is
 * taken at a heat the first moved, and the reading would be an integral rather
 * than a rate. The tower stands alone on a quiet anchor, so air is the only term.
 */
export async function coolingRate(
  h: Harness,
  type: TowerType,
  heat: number,
): Promise<number> {
  startRun(h);
  const id = poseIdleTower(h, type, FREE_SITE.col, FREE_SITE.row, 0, heat);
  const opened = towerOf(h.snapshot(), id).heat;
  await h.advance(1);
  const closed = towerOf(h.snapshot(), id).heat;
  return (opened - closed) / FRAME_SECONDS;
}

/* -------------------------------------------------------------------------- */
/* The build preview and the placement act                                    */
/* -------------------------------------------------------------------------- */

/** The held build preview, or the failure that arming held none. */
export function heldPreview(h: Harness, doing: string): BuildSnapshot {
  const build = h.snapshot().build;
  if (build === null) {
    return fail(
      `a held build preview (${doing}, specs/building.md, Arming a type)`,
      null,
    );
  }
  return build;
}

/**
 * Whether the game's own placement check would accept a `type` footprint anchored
 * at `(col, row)` right now.
 *
 * This is `build.valid` — specs/building.md's six-condition check, asked through
 * the one way the specification offers to ask it, since the surface carries no
 * operation that asks whether a footprint could be placed. A probe of a tile a
 * standing tower covers is therefore reading the game's own idea of what that
 * tower blocked.
 *
 * It ARMS `type` and MOVES the held preview, and leaves both held.
 */
export function probeValid(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
): boolean {
  h.debug.setArmed(type);
  h.debug.setPreview(col, row);
  return heldPreview(h, `probing ${type} at (${col}, ${row})`).valid;
}

/** The id a placement handed back, or the failure that it built nothing. */
export function requirePlaced(id: number | null, doing: string): number {
  if (id === null) {
    return fail(
      `a valid placement to build a tower (${doing}, specs/building.md, Placing)`,
      null,
    );
  }
  return id;
}

/* -------------------------------------------------------------------------- */
/* Probing what a standing tower blocked                                      */
/* -------------------------------------------------------------------------- */

/** One anchor the placement check was asked about, and what it answered. */
export interface Probed {
  col: number;
  row: number;
  valid: boolean;
}

/**
 * The side of the footprint every blocked-set probe is taken with: a 2x2, the
 * smallest on the roster.
 *
 * Geometry, not a tolerance. There is no 1x1 tower, so the finest instrument the
 * placement check offers is a 2x2 — and a 2x2 is enough: swept over a window of
 * anchors, the anchors it is refused at are exactly those whose own two-by-two
 * block overlaps the blocked square, which fixes that square uniquely.
 */
export const PROBE_SIZE = 2;

/**
 * Ask the game's own placement check about a {@link PROBE_SIZE} footprint at every
 * anchor of the window that surrounds a `size`-tile footprint anchored at
 * `(col, row)`, reaching one fully-clear anchor beyond the blocked band on each
 * side.
 *
 * It leaves a preview armed at the last anchor probed.
 */
export function probeAround(
  h: Harness,
  probe: TowerType,
  col: number,
  row: number,
  size: number,
): Probed[] {
  const from = { col: col - PROBE_SIZE - 1, row: row - PROBE_SIZE - 1 };
  const to = { col: col + size + 1, row: row + size + 1 };
  const probes: Probed[] = [];
  for (let r = from.row; r <= to.row; r += 1) {
    for (let c = from.col; c <= to.col; c += 1) {
      probes.push({ col: c, row: r, valid: probeValid(h, probe, c, r) });
    }
  }
  return probes;
}

/**
 * Whether a {@link PROBE_SIZE} footprint anchored at `(col, row)` shares a tile
 * with the `size`-tile footprint anchored at `(atCol, atRow)`.
 *
 * The case's own arithmetic over two rectangles, which is what specs/floor.md's
 * anchoring makes of "blocks exactly these tiles": the placement check refuses an
 * anchor when, and only when, its own block overlaps the blocked square
 * (specs/building.md, Valid and invalid, condition 2).
 */
export function overlapsFootprint(
  probe: Probed,
  atCol: number,
  atRow: number,
  size: number,
): boolean {
  return (
    probe.col <= atCol + size - 1 &&
    probe.col + PROBE_SIZE - 1 >= atCol &&
    probe.row <= atRow + size - 1 &&
    probe.row + PROBE_SIZE - 1 >= atRow
  );
}
