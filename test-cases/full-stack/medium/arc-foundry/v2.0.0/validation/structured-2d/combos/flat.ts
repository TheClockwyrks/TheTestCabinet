// combos — the two ends of the level track every "flat across level" point is
// read at. CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// specs/combinations.md: "Fire rate and every ability parameter are flat across
// level, so a tower scales through its damage alone." The level scaling table
// underneath it moves two figures and no others: damage by
// `COMBO_DAMAGE_MULT[level]` and range by `COMBO_RANGE_BONUS[level]`.
//
// FOUR POINTS READ THAT SENTENCE, because the figures it holds flat are reached
// four different ways and a build can let one drift without touching the others:
// `rate-flat-across-level` (the cadence), `abilities-flat-across-level` (what the
// snapshot reports of each tower), `status-abilities-flat-across-level` (a slow
// and a burn, which only the struck unit carries) and
// `multishot-flat-across-level` (an `N`, which only a cadence shows). This file
// holds the towers, the ends of the track and the two drives they share.
//
// EVERY UNIT HERE IS POSED FROZEN and at a wave deep enough to outlive the shots,
// so the only thing that changes between the two readings is the level.

import { assertEqual } from "../assert";
import {
  COMBO_MAX_LEVEL,
  comboDef,
  COMBOS,
  structureCenter,
} from "../constants";
import {
  emptyYard,
  type Harness,
  openYard,
  parkUnit,
  standCombo,
  structureById,
  unitById,
} from "../harness";
import { abilityNames } from "./towers";

/** The four columns and three rows of `stat-blocks`, past the widest aura. */
export const COLS = [4, 17, 30, 43];
export const ROWS = [8, 18, 28];

/** The two ends of the track every reading below is taken at. */
export const ENDS = [0, COMBO_MAX_LEVEL];

/**
 * The tower whose slow and burn are read off the unit it struck, and the two
 * parameters its own row of `COMBOS` names.
 */
export const STATUS_TOWER = comboDef("corroder");
export const SLOW = STATUS_TOWER.abilities.slow!;
export const BURN = STATUS_TOWER.abilities.burn!;

/** The tower whose `multishot(N)` is read off one cadence, and that `N`. */
export const SHOAL_TOWER = comboDef("forkarray");
export const SHOAL_N = SHOAL_TOWER.abilities.multishot!.targets;

export const ANCHOR = { col: 10, row: 10 };
export const CENTER = structureCenter(ANCHOR.col, ANCHOR.row);

/** A wave deep enough that a Dynamo outlives every shot these readings take. */
export const WAVE = 12;

/** Two cadences of the slowest tower here, and then some. */
export const MAX_FRAMES = 400;

/** The slow, the burn and the shot a Corroder's first hit leaves on a unit. */
export async function firstHit(
  h: Harness,
  level: number,
): Promise<{
  slowFactor: number;
  slowFor: number;
  burnDps: number;
  burnFor: number;
  damage: number;
}> {
  emptyYard(h);
  const tower = standCombo(h, STATUS_TOWER.id, ANCHOR.col, ANCHOR.row, level);
  const unit = parkUnit(h, "dynamo", {
    x: CENTER.x + 60,
    y: CENTER.y,
  });

  const struck = await h.until((s) => unitById(s, unit).slowFactor < 1, {
    maxFrames: MAX_FRAMES,
    poll: 1,
  });
  assertEqual(
    struck.hit,
    true,
    `the ${STATUS_TOWER.name} at level ${level} landed a hit`,
  );
  const view = unitById(struck.snapshot, unit);
  return {
    slowFactor: view.slowFactor,
    slowFor: view.slowUntil - struck.snapshot.simTime,
    burnDps: view.burnDps,
    burnFor: view.burnUntil - struck.snapshot.simTime,
    damage: structureById(struck.snapshot, tower).damage,
  };
}

/** How many projectiles a Fork Array puts up on one cadence, with five in range. */
export async function volley(h: Harness, level: number): Promise<number> {
  emptyYard(h);
  standCombo(h, SHOAL_TOWER.id, ANCHOR.col, ANCHOR.row, level);
  for (const at of [
    { x: CENTER.x - 60, y: CENTER.y },
    { x: CENTER.x + 60, y: CENTER.y },
    { x: CENTER.x, y: CENTER.y - 60 },
    { x: CENTER.x, y: CENTER.y + 60 },
    { x: CENTER.x - 60, y: CENTER.y - 60 },
  ]) {
    parkUnit(h, "dynamo", at);
  }
  const fired = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: MAX_FRAMES,
    poll: 1,
  });
  assertEqual(
    fired.hit,
    true,
    `the ${SHOAL_TOWER.name} at level ${level} fired a cadence`,
  );
  return fired.snapshot.projectiles.length;
}

/** One tower's reported block, as the flat points compare it. */
export interface Block {
  fireRate: number;
  abilities: string;
  auraRadius: number;
  auraBonus: number;
}

/**
 * Stand all twelve towers and read each one's block at both ends of the track.
 *
 * The twelve stand far enough apart that no aura reaches another tower, which
 * matters here only because it keeps each reading the tower's own.
 */
export async function blocksAtBothEnds(
  h: Harness,
): Promise<Map<string, Block[]>> {
  openYard(h, { wave: WAVE });

  const placed = new Map<string, number>();
  for (const [index, tower] of COMBOS.entries()) {
    const col = COLS[index % COLS.length]!;
    const row = ROWS[Math.floor(index / COLS.length)]!;
    placed.set(tower.id, standCombo(h, tower.id, col, row));
  }

  const reads = new Map<string, Block[]>();
  for (const level of ENDS) {
    for (const tower of COMBOS) {
      h.debug.setComboLevel(placed.get(tower.id)!, level);
    }
    const s = h.snapshot();
    for (const tower of COMBOS) {
      const view = structureById(s, placed.get(tower.id)!);
      const row = reads.get(tower.id) ?? [];
      row.push({
        fireRate: view.fireRate,
        abilities: abilityNames(view).join(", "),
        auraRadius: view.auraRadius,
        auraBonus: view.auraBonus,
      });
      reads.set(tower.id, row);
    }
  }
  await h.advance(1);
  return reads;
}
