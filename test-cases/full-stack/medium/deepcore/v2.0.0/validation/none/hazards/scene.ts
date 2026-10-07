// Deepcore — the poses the hazard checks share. CASE-PROVIDED.
//
// Every point in this category reads a hull figure off one hazard, so all of
// them want the same world: an empty mine holding exactly the hazard cell the
// point is about, a hull large enough that the blow does not end the expedition
// before it can be read, and a miner given only the faculties the requirement
// exercises.
//
// Nothing here decides anything. The arrangements are the ones
// `specs/instrumentation.md` names — `setTile`, `setTier`, `setHull`,
// `setMinerPosition`, the two faculty gates — and the geometry is
// `specs/world.md`'s, so a check that stands the miner on a cell stands it where
// the specification says that cell is.

import { fail } from "../assert";
import {
  BAND_HEALTH,
  DRILL_DAMAGE,
  drillHitsFor,
  HULL_MAX,
  MINER_H,
  TILE,
  type Band,
} from "../constants";
import {
  driveCut,
  minerXOn,
  minerYOn,
  standOn,
  type CutResult,
  type DeepcoreSnapshot,
  type Harness,
  type TileKind,
} from "../harness";

/** The column every hazard below is posed in: clear of both border columns. */
export const HAZARD_COL = 8;

/**
 * The drill tier the cut-through checks run at.
 *
 * `specs/upgrades.md` gives tier 5 five damage a hit, so a coreshell cell falls
 * in four hits rather than sixteen. Nothing a hazard point reads depends on the
 * drill tier — the gas curve is a function of depth, the lava lump of the band —
 * so the fastest tier is the one that spends the least of a check's budget
 * getting to the thing it decides.
 */
export const FAST_DRILL_TIER = 5;

/** How many hits `FAST_DRILL_TIER` takes to break a cell of `band`. */
export function fastHitsFor(band: Band): number {
  return drillHitsFor(BAND_HEALTH[band], DRILL_DAMAGE[FAST_DRILL_TIER - 1]);
}

/**
 * Raise the hull track to `tier` and fill the hull to its new maximum.
 *
 * Two calls rather than one, because `setTier` clamps the hull held to the new
 * maximum and otherwise leaves it alone: a raised tier is a bigger hull, not a
 * full one.
 */
export async function armHull(h: Harness, tier: number): Promise<number> {
  await h.debug.setTier("hull", tier);
  await h.debug.setHull(HULL_MAX[tier - 1]);
  await h.debug.reconcile();
  return HULL_MAX[tier - 1];
}

/** A row at the middle of `band`, at the mine the snapshot describes. */
export function bandRow(snapshot: DeepcoreSnapshot, band: Band): number {
  const index = ["topsoil", "rockbed", "deepstone", "coreshell"].indexOf(band);
  return Math.round(1 + ((index + 0.5) / 4) * (snapshot.coreRow - 1));
}

/** The row whose depth fraction is `f`, at the mine the snapshot describes. */
export function rowAt(snapshot: DeepcoreSnapshot, f: number): number {
  return Math.round(1 + f * (snapshot.coreRow - 1));
}

/** The depth fraction of `row`: `(row - 1) / (coreRow - 1)`. */
export function fractionOf(snapshot: DeepcoreSnapshot, row: number): number {
  return (row - 1) / (snapshot.coreRow - 1);
}

/** Pose one cell and stand the miner on top of it, at rest. */
export async function poseUnderfoot(
  h: Harness,
  col: number,
  row: number,
  kind: TileKind,
): Promise<void> {
  await h.debug.setTile(col, row, kind);
  await standOn(h, col, row);
}

/** What a hazard cut cost. */
export interface CutCost {
  cut: CutResult;
  hullBefore: number;
  hullAfter: number;
  loss: number;
}

/**
 * Pose `kind` under the miner, cut it through, and report the hull it cost.
 *
 * The cut is the game's own: the direction key goes down through the surface and
 * the build's drill lands its own hits at its own interval, so what breaks the
 * cell is `specs/character.md`'s drill rather than a posed outcome.
 */
export async function cutUnderfoot(
  h: Harness,
  col: number,
  row: number,
  kind: TileKind,
): Promise<CutCost> {
  await poseUnderfoot(h, col, row, kind);
  const before = (await h.snapshot()).miner.hull;
  const cut = await driveCut(h, "down", { col, row });
  const after = cut.snapshot.miner.hull;
  return { cut, hullBefore: before, hullAfter: after, loss: before - after };
}

/**
 * Put the miner's whole box inside the cell `(col, row)`.
 *
 * `specs/hazards.md` charges the lava contact drain "for as long as the miner's
 * box overlaps a lava cell", so a check about the drain has to establish that
 * overlap. `specs/character.md` also says the box never overlaps a cell that is
 * not a tunnel, and the game's own collision is what enforces that — so a
 * scenario posing this overlap holds the body still with the travel gate, which
 * `specs/instrumentation.md` says moves it nowhere including by collision
 * displacement.
 */
export async function soakIn(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const inset = (TILE - MINER_H) / 2;
  await h.debug.setMinerPosition(minerXOn(col), row * TILE + inset);
  await h.debug.reconcile();
}

/** What a driven landing did. */
export interface Landing {
  landed: boolean;
  /** The fastest downward speed the sweep saw: the speed it arrived at. */
  impactSpeed: number;
  hullBefore: number;
  hullAfter: number;
  loss: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Drop the miner onto the floor at `(col, floorRow)` from `height` above it,
 * already travelling downward at `vy`, and report the landing.
 *
 * The harness's own `driveFall` starts every fall at rest, which is the right
 * drive for the free fall `specs/hazards.md` describes; this one poses the
 * arrival speed instead, because the impact rule is stated over the speed the
 * landing happens at and the speeds it names are past what a short drop reaches.
 *
 * One frame is run past the first that reads as grounded, for the same reason
 * `driveFall` does it: a build may report a miner about to touch down as
 * grounded, so the frame the flag turns on is not necessarily the frame the
 * contact was resolved and the hull was billed on.
 */
export async function driveLanding(
  h: Harness,
  col: number,
  floorRow: number,
  height: number,
  vy: number,
): Promise<Landing> {
  if (height <= 0) {
    fail(
      "a landing driven from above the floor (specs/hazards.md)",
      `a height of ${height}`,
    );
  }
  await h.debug.setMinerPosition(minerXOn(col), minerYOn(floorRow) - height);
  await h.debug.setMinerVelocity(0, vy);
  await h.debug.reconcile();
  const before = (await h.snapshot()).miner.hull;
  let fastest = 0;
  const swept = await h.until(
    (s) => {
      if (s.miner.vy > fastest) fastest = s.miner.vy;
      return s.miner.grounded;
    },
    { maxFrames: 900, poll: 1 },
  );
  if (swept.hit) await h.advance(1);
  const settled = await h.snapshot();
  return {
    landed: swept.hit,
    impactSpeed: fastest,
    hullBefore: before,
    hullAfter: settled.miner.hull,
    loss: before - settled.miner.hull,
    snapshot: settled,
  };
}
