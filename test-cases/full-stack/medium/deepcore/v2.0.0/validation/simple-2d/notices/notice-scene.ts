// Deepcore — the scene the first-time hazard notice checks share.
//
// Not a suite: a `.ts` beside the suites, which the project never collects. It
// holds what all seven checks arrange identically and nothing that decides
// anything — every assertion lives in the suite that owns the requirement.
//
// WHAT A NOTICE NEEDS, AND WHY THE SCENE IS BUILT THIS WAY. `specs/hazards.md`
// raises the card on "the first gas detonation that damages the miner" and "the
// first lava burn that does", so a check has to make a real hazard hurt the miner
// rather than pose a card. Both are reached the same way: put the hazard cell
// under the miner's drill and hold `down`, so the game's own drill lands the
// hits, its own rule detonates the pocket or bills the lava lump, and its own
// notice logic decides what to raise.
//
// The pockets sit in the ROCKBED and the lava in the DEEPSTONE, the bands
// `specs/world.md` says each first appears in, so the damage a check reads is the
// damage that band really deals. The hull tier is raised because two detonations
// at that depth cost more than a tier-1 hull holds, and a miner that died partway
// through would end the expedition rather than answer the question.
//
// TRAVEL IS HELD OFF throughout. The detonation shoves the miner away at
// `GAS_KNOCKBACK` and the cell it was standing on becomes a tunnel underneath it,
// so a miner free to move leaves the scenario the moment the first hazard fires —
// and every one of these checks is about the CARD, not about where the miner
// ends up. `specs/instrumentation.md` fixes the gate: with travel off the body
// holds its position while everything else about the miner carries on, damage
// included.

import { HULL_TIERS } from "../constants";
import {
  driveCut,
  minerXOn,
  minerYOn,
  openScene,
  pinMiner,
  rowInBand,
  type CutResult,
  type DeepcoreSnapshot,
  type Harness,
} from "../harness";

/** The column the first hazard cell is posed in. */
export const FIRST_COL = 10;

/** And the second, far enough away to be a separate cell of the same band. */
export const SECOND_COL = 14;

/**
 * The hull tier the scene runs at, and the hull it is filled to.
 *
 * Tier 3 rather than tier 1 because two rockbed detonations cost more hull than
 * a tier-1 miner has, and a check about a card must not end in a death.
 */
export const SCENE_HULL_TIER = 3;
export const SCENE_HULL = HULL_TIERS[SCENE_HULL_TIER - 1];

/** How long a cut is given before it is called stuck, in frames. */
const CUT_FRAMES = 900;

/** The scene every notice check opens: an empty mine, a tough hull, a pinned miner. */
export function openNoticeScene(h: Harness): void {
  openScene(h);
  h.debug.setTier("hull", SCENE_HULL_TIER);
  h.debug.setHull(SCENE_HULL);
  h.debug.reconcile();
  pinMiner(h);
}

/** Stand the miner on `(col, row)` while its travel is held off. */
function standWhilePinned(h: Harness, col: number, row: number): void {
  h.debug.setMinerPosition(minerXOn(col), minerYOn(row));
  h.debug.setMinerVelocity(0, 0);
  h.debug.reconcile();
}

/** What a driven hazard cut did to the miner. */
export interface BurnResult {
  cut: CutResult;
  hullBefore: number;
  hullAfter: number;
  /** The state on the frame the hazard cell broke. */
  snapshot: DeepcoreSnapshot;
}

/**
 * Pose a hazard cell of `kind` at `(col, row)`, stand the miner on it, and hold
 * `down` until the game's own drill breaks it.
 *
 * The miner stands ON the cell, so the cell under its feet is the one a held down
 * cut bites into and its centre is within `GAS_BLAST_TILES` of the pocket's when
 * the pocket goes off.
 */
export async function burnThrough(
  h: Harness,
  kind: "gas" | "lava",
  col: number,
  row: number,
): Promise<BurnResult> {
  h.debug.setTile(col, row, kind);
  standWhilePinned(h, col, row);
  const before = h.snapshot();
  const cut = await driveCut(
    h,
    "down",
    { col, row },
    { maxFrames: CUT_FRAMES },
  );
  return {
    cut,
    hullBefore: before.miner.hull,
    hullAfter: cut.snapshot.miner.hull,
    snapshot: cut.snapshot,
  };
}

/** A row well inside the rockbed, the band `specs/world.md` first places gas in. */
export function gasRow(snapshot: DeepcoreSnapshot): number {
  return rowInBand("rockbed", snapshot.coreRow);
}

/** A row well inside the deepstone, the band lava first appears in. */
export function lavaRow(snapshot: DeepcoreSnapshot): number {
  return rowInBand("deepstone", snapshot.coreRow);
}

/** Stand the miner on `(col, row)` and detonate a gas pocket there. */
export function detonateGas(
  h: Harness,
  col: number,
  row: number,
): Promise<BurnResult> {
  return burnThrough(h, "gas", col, row);
}

/** Stand the miner on `(col, row)` and burn it on a lava cell there. */
export function burnOnLava(
  h: Harness,
  col: number,
  row: number,
): Promise<BurnResult> {
  return burnThrough(h, "lava", col, row);
}

/** Run `seconds` of game time in a handful of frames, since no rate here is per frame. */
export function elapse(h: Harness, seconds: number): Promise<void> {
  return h.advanceSeconds(seconds, Math.max(2, Math.ceil(seconds * 8)));
}
