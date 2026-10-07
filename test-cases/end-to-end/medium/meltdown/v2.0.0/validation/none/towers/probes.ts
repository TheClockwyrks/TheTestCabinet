// Meltdown — the readings this group takes off one tower. GROUP-LOCAL.
//
// Eight of this group's fourteen items ask the same question of a different row
// of `specs/towers.md`'s roster: does THIS tower carry THESE figures? Four of the
// nine figures in a row are in the snapshot outright — `size`, `redline`,
// `spent`, `radiatorFaces` — and the other five are not, so they are measured
// where the specification says they act. That measuring is written once, here,
// rather than six times.
//
// NOTHING IN THIS FILE HOLDS A TOLERANCE, and the three numbers that shape a
// reading — the heat the cooling frame opens at, how many shots the rate window
// is driven to, and how far off the range boundary the two probes sit — are the
// CALLER's, passed in, so every figure a check leans on is stated in the check.
// What is fixed here is geometry and sequence: where the target stands, what
// order the legs run in, and why that order is the one that makes each reading a
// measurement of one figure.
//
// THE ORDER OF THE LEGS IS LOAD-BEARING.
//
//   1. THE TABLE IS READ FIRST, off the frame `addTower` appended the tower on,
//      before anything has been posed on top of it. `specs/instrumentation.md`
//      puts an added tower at heat `0`, level `1`, fresh, with `spent` equal to
//      its build cost and both faculties on, so that snapshot is the row as the
//      build holds it.
//
//   2. MASS IS READ NEXT, over ONE frame of air cooling with the guns off.
//      `specs/heat.md` resolves a frame as
//      `dH = (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) / mass`
//      with every term computed from the heat the frame opened with. A tower
//      alone on open floor touches no emitter, no Forge and no Sink, so conduct,
//      forgeGain and sinkLoss are exactly zero; the guns are off, so shotGain is
//      exactly zero. What is left is one frame's `airLoss * dt / mass`, and
//      `airCoefficient` is that loss's coefficient straight out of the
//      specification. One frame rather than a window, so there is no integration
//      to argue about: the specification fixes what a single frame does exactly.
//
//   3. THE FIRE RATE IS COUNTED BEFORE ANYTHING ELSE PUTS A TARGET IN RANGE,
//      because `specs/combat.md`'s accumulator carries between frames and only
//      grows on a frame the emitter has a target. Legs 1 and 2 leave the floor
//      empty of surge and the guns off, so the clock this leg counts against has
//      never run. The count is taken in units of the window's OWN first shot, so
//      what is graded is how OFTEN the tower fires and not how hard.
//
//   4. THE RANGE PROBES MOVE THAT SAME TARGET, which changes no figure the
//      earlier legs read.
//
//   5. heatPerShot IS READ LAST, on the one frame a shot lands on from cold. The
//      heat is set back to `0` with the thermal model running, and air cooling is
//      proportional to `H / 100`, so every frame before the shot leaves the heat
//      at exactly `0` and the frame the shot lands on leaves it at
//      `heatPerShot / mass` — nothing subtracted and nothing to predict. Which
//      frame that happens to be cannot change the answer.
//
// THE HEAT IS PINNED FOR LEGS 3 AND 4 and released for leg 5, because a rate
// counted in units of one shot's damage is only a rate count while every shot of
// the window removes the same amount; `setTowerThermal(id, false)` holds the
// tower's part in the heat model while it goes on firing at the heat posed
// (`specs/instrumentation.md`).

import { fail } from "../assert";
import {
  TILE,
  footprintCentre,
  type Side,
  type Tile,
  type TowerType,
} from "../constants";
import {
  framesFor,
  framesForShots,
  lastUnit,
  poseTower,
  requireTower,
  seconds,
  startRun,
  type BuildView,
  type Harness,
} from "../harness";
import { airCoefficient, emitterDefOf, sizeOf, targetTypeFor } from "./roster";

/**
 * Hp far past anything a reading below can remove, so the target survives every
 * leg and each reading is hp REMOVED rather than a death nobody asked for.
 */
const TARGET_HP = 1e6;

/**
 * How far out the target stands for the rate and heat legs, in tiles beyond the
 * footprint's own edge.
 *
 * Two and a half tiles clear of the footprint puts it off the tower's own tiles
 * and inside the shortest range on the roster — the Stutter's `5.0`, against a
 * 2x2 footprint's own `1.0` tile of half-width — with room to spare at every
 * size. Geometry, not a tolerance: what range MEANS is decided by the two probes
 * of leg 4 and by `combat/range-*`.
 */
const CLEAR_TILES = 2.5;

/**
 * How many fire intervals a first-shot sweep may run for before the emitter is
 * called broken.
 *
 * The first shot of a run lands one full interval after the target is acquired
 * (`specs/combat.md`), and the accumulator leg 5 inherits is somewhere inside an
 * interval rather than at its start, so three intervals is generous and still
 * bounded.
 */
const SHOT_WAIT_INTERVALS = 3;

/** How far out the rate and heat legs stand their target, in logical units. */
function clearOf(type: TowerType): number {
  return (emitterDefOf(type).size / 2 + CLEAR_TILES) * TILE;
}

/** Frames of the default clock covering {@link SHOT_WAIT_INTERVALS} of `type`'s. */
function shotWindow(type: TowerType): number {
  return framesFor(SHOT_WAIT_INTERVALS / emitterDefOf(type).fireRate);
}

/** The three numbers a caller shapes an emitter reading with. */
export interface StatsProbe {
  /** The heat the one cooling frame of leg 2 opens at. */
  coolHeat: number;
  /** How many shots the rate window of leg 3 is driven to. */
  shots: number;
  /** How far inside and outside the range boundary leg 4 probes, in logical units. */
  rangeMargin: number;
}

/** What one pass over an emitter measured. Every figure raw; none of them judged. */
export interface EmitterReading {
  /** The id of the tower every reading was taken off. */
  id: number;
  /** `spent` on the frame `addTower` appended it. */
  spent: number;
  /** The `size` it reports. */
  size: number;
  /** The `redline` it reports. */
  redline: number;
  /** The `radiatorFaces` it reports at rotation `0`, sorted. */
  radiatorFaces: Side[];
  /** The `damage` it reports with its heat pinned at `0`. */
  damageWhenCold: number;
  /** The heat one frame of air cooling removed, opening at `coolHeat`. */
  coolLoss: number;
  /** The mass that loss implies under `specs/heat.md`'s frame. */
  mass: number;
  /** The shots the rate window resolved, in units of its own first shot. */
  shotsCounted: number;
  /** The heat on the frame the first shot from cold landed. */
  firstShotHeat: number;
  /** The `heatPerShot` that heat implies at the mass measured above. */
  heatPerShot: number;
  /** Whether a target a margin INSIDE the level-I range boundary was taken. */
  insideTaken: boolean;
  /** Whether a target a margin OUTSIDE the level-I range boundary was taken. */
  outsideTaken: boolean;
}

/**
 * Add one stationary, effectively unkillable target of the type this emitter's
 * own targeting rule lets it fire on, at a logical stage point, and hand back its
 * id.
 *
 * The surge is emptied first, so exactly one unit is ever on the floor and
 * `targeting` names it unambiguously. Motion off is what makes every reading
 * below unambiguous: the unit cannot walk across a range boundary while a
 * measurement is taken, and `specs/instrumentation.md` keeps its route computed
 * from the tile it stands on regardless.
 */
export async function poseMark(
  h: Harness,
  type: TowerType,
  x: number,
  y: number,
): Promise<number> {
  await h.debug.clearSurge();
  await h.debug.addUnit(targetTypeFor(type), "left");
  const added = lastUnit(await h.snapshot());
  if (added === undefined) {
    fail(
      "addUnit to append a unit to the roster (specs/instrumentation.md)",
      "the surge roster was still empty after addUnit",
    );
  }
  await h.debug.setUnitPosition(added.id, x, y);
  await h.debug.setUnitMotion(added.id, false);
  await h.debug.setUnitMaxHp(added.id, TARGET_HP);
  await h.debug.setUnitHp(added.id, TARGET_HP);
  return added.id;
}

/**
 * Put `unit` at a logical stage point, run the one frame that answers it, and say
 * whether the emitter took it.
 *
 * One frame because `specs/combat.md` chooses the target again on every frame, so
 * a reading taken without one would report the target of the frame before the
 * unit moved.
 */
export async function targetsAt(
  h: Harness,
  id: number,
  unit: number,
  x: number,
  y: number,
): Promise<boolean> {
  await h.debug.setUnitPosition(unit, x, y);
  await h.advance(1);
  return (
    requireTower(await h.snapshot(), id, "the emitter under a range probe")
      .targeting === unit
  );
}

/**
 * Every figure `specs/towers.md`'s row for `type` states, measured off one tower
 * standing alone at `at`.
 *
 * See the note at the head of this file for why the legs run in the order they
 * do. It asserts nothing: each check states what its own row requires.
 */
export async function readEmitter(
  h: Harness,
  type: TowerType,
  at: Tile,
  probe: StatsProbe,
): Promise<EmitterReading> {
  const def = emitterDefOf(type);
  const centre = footprintCentre(at.col, at.row, def.size);
  const named = `the ${type} under test`;

  await startRun(h);
  const id = await poseTower(h, type, at.col, at.row);

  /* ---- Leg 1: the row the snapshot carries outright --------------------- */

  const placed = requireTower(await h.snapshot(), id, named);
  const spent = placed.spent;
  const size = placed.size;
  const redline = placed.redline;
  const radiatorFaces = [...placed.radiatorFaces].sort();

  /* ---- Leg 2: mass, over one frame of air cooling ------------------------ */

  await h.debug.setTowerFiring(id, false);
  await h.debug.setTowerHeat(id, probe.coolHeat);
  await h.advance(1);
  const cooled = requireTower(await h.snapshot(), id, named).heat;
  const coolLoss = probe.coolHeat - cooled;
  if (!(coolLoss > 0)) {
    fail(
      `the ${type} alone on open floor to shed heat over one frame, at ` +
        `airLoss = (RAD_K * radiatorEdges + BASE_K * plainEdges) * (H / 100) ` +
        "(specs/heat.md)",
      `heat ${probe.coolHeat} left at ${cooled} after one frame`,
    );
  }
  const mass =
    (airCoefficient(type) * (probe.coolHeat / 100) * seconds(1)) / coolLoss;

  /* ---- Leg 3: the fire rate, off a clock that has never run -------------- */

  await h.debug.setTowerFiring(id, true);
  await h.debug.setTowerThermal(id, false);
  await h.debug.setTowerHeat(id, 0);
  const damageWhenCold = requireTower(await h.snapshot(), id, named).damage;

  const mark = await poseMark(h, type, centre.x + clearOf(type), centre.y);
  const firstFrames = framesForShots(1, def.fireRate);
  await h.advance(firstFrames);
  const afterOne = requireTower(await h.snapshot(), id, named).damageDealt;
  if (!(afterOne > 0)) {
    fail(
      `one shot from the ${type} within ${firstFrames} frames of a target ` +
        `${CLEAR_TILES} tiles clear of its footprint (specs/combat.md)`,
      `damageDealt still ${afterOne}`,
    );
  }
  await h.advance(framesForShots(probe.shots, def.fireRate) - firstFrames);
  const afterAll = requireTower(await h.snapshot(), id, named).damageDealt;
  const shotsCounted = afterAll / afterOne;

  /* ---- Leg 4: the range boundary, with that same target ------------------ */

  const reach = def.range * TILE;
  const insideTaken = await targetsAt(
    h,
    id,
    mark,
    centre.x + reach - probe.rangeMargin,
    centre.y,
  );
  const outsideTaken = await targetsAt(
    h,
    id,
    mark,
    centre.x + reach + probe.rangeMargin,
    centre.y,
  );

  /* ---- Leg 5: heatPerShot, on the frame one shot lands from cold --------- */

  await h.debug.setUnitPosition(mark, centre.x + clearOf(type), centre.y);
  await h.debug.setTowerThermal(id, true);
  await h.debug.setTowerHeat(id, 0);
  const swept = await h.until(
    (snapshot) => requireTower(snapshot, id, named).heat > 0,
    { poll: 1, maxFrames: shotWindow(type) },
  );
  if (!swept.hit) {
    fail(
      `the ${type}'s heat to rise on the frame its first shot from cold ` +
        "resolves (specs/heat.md, specs/combat.md)",
      `heat still 0 after ${swept.frames} frames with a target in range`,
    );
  }
  const firstShotHeat = requireTower(swept.snapshot, id, named).heat;

  return {
    id,
    spent,
    size,
    redline,
    radiatorFaces,
    damageWhenCold,
    coolLoss,
    mass,
    shotsCounted,
    firstShotHeat,
    heatPerShot: firstShotHeat * mass,
    insideTaken,
    outsideTaken,
  };
}

/**
 * The held build preview, or a failure naming the surface member that was
 * missing.
 *
 * `specs/building.md`, Arming a type: arming holds a preview, so a check that
 * armed a type and found `build` null has found a build that does not hold one.
 */
export async function heldPreview(h: Harness): Promise<BuildView> {
  const build = (await h.snapshot()).build;
  if (build === null) {
    fail(
      "a held build preview after arming (specs/building.md, Arming a type)",
      null,
    );
  }
  return build;
}

/**
 * Whether the game's own placement check would accept a `type` footprint
 * anchored at `(col, row)` right now.
 *
 * This is `build.valid` — `specs/building.md`'s six-condition check — asked
 * through the one way the specification offers to ask it, since
 * `specs/instrumentation.md` states in as many words that "there is no operation
 * that asks whether a footprint could be placed". So a check probing whether a
 * tile is open or blocked is reading the game's own rule rather than a mirror of
 * it.
 *
 * It ARMS `type` and MOVES the held preview, and leaves the preview it probed
 * with held. A caller that wants the other five conditions of that check out of
 * the way poses them: money above the cost, no surge on the floor, a mode with no
 * build zone, and a footprint far from the openings.
 */
export async function probeValid(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
): Promise<boolean> {
  await h.debug.setArmed(type);
  await h.debug.setPreview(col, row);
  return (await heldPreview(h)).valid;
}

/* -------------------------------------------------------------------------- */
/* The footprint probes                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many anchors beyond the last one that could overlap a footprint the scan
 * still asks about, on every side.
 *
 * The scan decides a footprint's extent in BOTH directions — every tile of it
 * blocked, and no tile outside it blocked — so it has to ask about ground the
 * footprint has no business reaching. One ring is enough: a build whose footprint
 * ran a tile wide in any direction has an overlapping probe inside that ring
 * reading blocked. Geometry, not a tolerance.
 */
const SCAN_RING = 1;

/** One cell of a scan: where the probe footprint was held, and what it read. */
export interface ProbeCell {
  col: number;
  row: number;
  valid: boolean;
}

/** Whether two axis-aligned square footprints share a tile. */
export function overlaps(
  a: { col: number; row: number; size: number },
  b: { col: number; row: number; size: number },
): boolean {
  return (
    a.col < b.col + b.size &&
    b.col < a.col + a.size &&
    a.row < b.row + b.size &&
    b.row < a.row + a.size
  );
}

/**
 * Ask the game's own placement check about a `probeType` footprint at every
 * anchor within reach of the block `size` tiles on a side anchored at `at`, and
 * hand back what each one answered.
 *
 * WHY A PREVIEW AND NOT A ROUTE. A route's LENGTH says that SOMETHING was blocked
 * and how much it cost the surge, which is `mazing/towers-block-tiles`'s reading;
 * it cannot say WHICH tiles. `build.valid` can, because the smallest footprint on
 * the roster is 2x2 and a 2x2 held at each of the anchors around a block reads
 * blocked exactly on the anchors whose four tiles meet the block. The full grid of
 * those answers pins the block's extent in both directions at once.
 *
 * FIVE OF THE SIX CONDITIONS ARE POSED OUT OF THE WAY by the caller, so the sixth
 * — every tile of the footprint is open — is the only one that can vary across the
 * grid: `specs/building.md` also asks that the footprint is on the grid (every
 * anchor here is interior), that no surge unit's centre stands on it (`startRun`
 * empties the floor), that the money covers the cost (the caller poses a purse far
 * above it), that a mode's build zone contains it (Containment fixes none,
 * `specs/modes.md`), and that the placement does not seal the floor
 * (`specs/mazing.md`), which one 2x2 preview beside one tower in the middle of an
 * open floor cannot do.
 */
export async function scanOpenness(
  h: Harness,
  probeType: TowerType,
  at: Tile,
  size: number,
): Promise<ProbeCell[]> {
  const probe = sizeOf(probeType);
  const cells: ProbeCell[] = [];
  for (
    let row = at.row - probe - SCAN_RING + 1;
    row <= at.row + size + SCAN_RING - 1;
    row += 1
  ) {
    for (
      let col = at.col - probe - SCAN_RING + 1;
      col <= at.col + size + SCAN_RING - 1;
      col += 1
    ) {
      cells.push({ col, row, valid: await probeValid(h, probeType, col, row) });
    }
  }
  return cells;
}

/**
 * How far along the ray from `centre` in direction `dir` the emitter `id` still
 * takes `unit`, in logical units, bisected to `steps` halvings of the bracket.
 *
 * WHY A BISECTION RATHER THAN TWO PROBES EITHER SIDE OF THE FIGURE. A check about
 * where a tower's CENTRE is must not also be a check on what its RANGE is, and a
 * pair of probes placed against the range the roster gives is exactly that: a
 * build whose range is right and whose centre is displaced, and a build whose
 * centre is right and whose range is short, both fail it. Bisecting instead finds
 * the boundary the build itself draws, in each of four directions, and the centre
 * is the midpoint of an opposed pair — a figure that is the same for ANY range the
 * bracket contains. `specs/combat.md` makes that midpoint the centre: the boundary
 * is "at most `range * TILE` logical units" from the footprint's centre, a
 * distance, so the two boundaries along one axis sit the same distance either side
 * of it.
 *
 * The bracket's near end must be taken and its far end must not; a build whose
 * reach falls outside it entirely is named for that rather than measured wrongly.
 */
export async function reachAlong(
  h: Harness,
  id: number,
  unit: number,
  centre: { x: number; y: number },
  dir: { dx: number; dy: number },
  bracket: { near: number; far: number },
  steps: number,
): Promise<number> {
  const takenAt = (distance: number): Promise<boolean> =>
    targetsAt(
      h,
      id,
      unit,
      centre.x + dir.dx * distance,
      centre.y + dir.dy * distance,
    );
  const facing = `${dir.dx > 0 ? "east" : dir.dx < 0 ? "west" : dir.dy > 0 ? "south" : "north"} of the footprint's centre`;
  if (!(await takenAt(bracket.near))) {
    fail(
      `the emitter to take a target ${bracket.near} logical units ${facing}, ` +
        "which is inside every level-I range on the roster (specs/towers.md)",
      "it took nothing there",
    );
  }
  if (await takenAt(bracket.far)) {
    fail(
      `the emitter to leave a target ${bracket.far} logical units ${facing} ` +
        "alone, which is outside every level-I range on the roster " +
        "(specs/towers.md)",
      "it took it",
    );
  }
  let taken = bracket.near;
  let untaken = bracket.far;
  for (let step = 0; step < steps; step += 1) {
    const middle = (taken + untaken) / 2;
    if (await takenAt(middle)) taken = middle;
    else untaken = middle;
  }
  return (taken + untaken) / 2;
}
