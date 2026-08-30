// combos/rate-and-abilities-flat — a tower scales through its damage alone.
//
// specs/combinations.md: "Fire rate and every ability parameter are flat across
// level, so a tower scales through its damage alone." The level scaling table
// underneath it moves two figures and no others: damage by
// `COMBO_DAMAGE_MULT[level]` and range by `COMBO_RANGE_BONUS[level]`.
//
// The flat figures fall into two groups, and both are read at level `0` and at
// level `COMBO_MAX_LEVEL`.
//
// WHAT THE SNAPSHOT REPORTS. Every one of the twelve towers is stood up and its
// `fireRate`, its ability names, and its `auraRadius` and `auraBonus` are read at
// both ends of the track and compared with each other and with the tower's own
// row of `COMBOS`. The twelve stand far enough apart that no aura reaches
// another tower, which matters here only because it keeps each reading the
// tower's own.
//
// WHAT ONLY THE GAME SHOWS. A slow's amount and duration, and a burn's fraction
// and duration, are carried by the unit that was struck, and
// specs/instrumentation.md reports all four on it. So a Corroder —
// `slow(0.2, 1.0)`, `burn(0.6, 3.0)` — is fired at a held unit at each end of the
// track and the struck unit is read: `slowFactor` is `1 - amount`, `slowUntil` is
// the hit plus the duration, `burnDps` is the shot's damage times the fraction,
// and `burnUntil` is the hit plus its duration. The shot's damage doubles across
// the track, so a build whose burn fraction moved with the level fails here even
// though its `burnDps` rose either way. A multishot's `N` is read the same way,
// off a Fork Array's cadence with five units in range at both ends.
//
// Every unit here is posed frozen and at a wave deep enough to outlive the
// shots, so the only thing that changes between the two readings is the level.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import {
  COMBOS,
  COMBO_MAX_LEVEL,
  comboDamage,
  comboDef,
  structureCenter,
} from "../constants";
import {
  captureStill,
  createHarness,
  emptyYard,
  openYard,
  parkUnit,
  standCombo,
  structureById,
  unitById,
  TICK_HZ,
  type Harness,
} from "../harness";
import { abilityNames } from "./towers";

/** The four columns and three rows of `stat-blocks`, past the widest aura. */
const COLS = [4, 17, 30, 43];
const ROWS = [8, 18, 28];

/** The two ends of the track every reading below is taken at. */
const ENDS = [0, COMBO_MAX_LEVEL];

/** The tower whose slow and burn are read off the unit it struck. */
const STATUS_TOWER = comboDef("corroder");
const SLOW = { amount: 0.2, seconds: 1.0 };
const BURN = { fraction: 0.6, seconds: 3.0 };

/** The tower whose `N` is read off one cadence. */
const SHOAL_TOWER = comboDef("forkarray");
const SHOAL_N = 3;

const ANCHOR = { col: 10, row: 10 };
const CENTER = structureCenter(ANCHOR.col, ANCHOR.row);

/** A wave deep enough that a Dynamo outlives every shot these readings take. */
const WAVE = 12;

/** Two cadences of the slowest tower here, and then some. */
const MAX_FRAMES = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The slow, the burn and the cadence a Corroder's first hit leaves on a unit. */
async function firstHit(level: number): Promise<{
  slowFactor: number;
  slowFor: number;
  burnDps: number;
  burnFor: number;
  damage: number;
}> {
  await emptyYard(h);
  const tower = await standCombo(
    h,
    STATUS_TOWER.id,
    ANCHOR.col,
    ANCHOR.row,
    level,
  );
  const unit = await parkUnit(h, "dynamo", {
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
async function volley(level: number): Promise<number> {
  await emptyYard(h);
  await standCombo(h, SHOAL_TOWER.id, ANCHOR.col, ANCHOR.row, level);
  for (const at of [
    { x: CENTER.x - 60, y: CENTER.y },
    { x: CENTER.x + 60, y: CENTER.y },
    { x: CENTER.x, y: CENTER.y - 60 },
    { x: CENTER.x, y: CENTER.y + 60 },
    { x: CENTER.x - 60, y: CENTER.y - 60 },
  ]) {
    await parkUnit(h, "dynamo", at);
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

it("holds the cadence and every ability parameter across the whole track", async () => {
  await openYard(h, { wave: WAVE });

  // The twelve, at both ends of the track.
  const placed = new Map<string, number>();
  for (const [index, tower] of COMBOS.entries()) {
    const col = COLS[index % COLS.length]!;
    const row = ROWS[Math.floor(index / COLS.length)]!;
    placed.set(tower.id, await standCombo(h, tower.id, col, row));
  }

  const reads = new Map<
    string,
    {
      fireRate: number;
      abilities: string;
      auraRadius: number;
      auraBonus: number;
    }[]
  >();
  for (const level of ENDS) {
    for (const tower of COMBOS) {
      await h.debug.setComboLevel(placed.get(tower.id)!, level);
    }
    const s = await h.snapshot();
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
  await captureStill(h, "flat");

  for (const tower of COMBOS) {
    const [low, high] = reads.get(tower.id)!;
    assertCloseTo(
      low!.fireRate,
      tower.fireRate,
      6,
      `${tower.name}: the rate its row names, at level 0`,
    );
    assertCloseTo(
      high!.fireRate,
      low!.fireRate,
      6,
      `${tower.name}: the same rate at level ${COMBO_MAX_LEVEL}`,
    );
    assertEqual(
      high!.abilities,
      low!.abilities,
      `${tower.name}: the same abilities at level ${COMBO_MAX_LEVEL}`,
    );
    assertCloseTo(
      high!.auraRadius,
      low!.auraRadius,
      6,
      `${tower.name}: the same aura radius at level ${COMBO_MAX_LEVEL}`,
    );
    assertCloseTo(
      high!.auraBonus,
      low!.auraBonus,
      6,
      `${tower.name}: the same aura bonus at level ${COMBO_MAX_LEVEL}`,
    );
  }

  // A slow and a burn, read off the unit the Corroder struck, at both ends.
  const tolerance = 2 / TICK_HZ;
  for (const level of ENDS) {
    const hit = await firstHit(level);
    assertCloseTo(
      hit.slowFactor,
      1 - SLOW.amount,
      6,
      `${STATUS_TOWER.name} at level ${level}: slow(${SLOW.amount})`,
    );
    assertBetween(
      hit.slowFor,
      SLOW.seconds - tolerance,
      SLOW.seconds,
      `${STATUS_TOWER.name} at level ${level}: a slow of ${SLOW.seconds} s`,
    );
    assertCloseTo(
      hit.burnDps / comboDamage(STATUS_TOWER.id, level),
      BURN.fraction,
      6,
      `${STATUS_TOWER.name} at level ${level}: burn(${BURN.fraction}) of a ` +
        `${comboDamage(STATUS_TOWER.id, level)} shot`,
    );
    assertCloseTo(
      hit.damage,
      comboDamage(STATUS_TOWER.id, level),
      6,
      `${STATUS_TOWER.name} at level ${level}: the shot the burn scaled from`,
    );
    assertBetween(
      hit.burnFor,
      BURN.seconds - tolerance,
      BURN.seconds,
      `${STATUS_TOWER.name} at level ${level}: a burn of ${BURN.seconds} s`,
    );
  }

  // And a multishot's N, read off one cadence at both ends.
  for (const level of ENDS) {
    assertEqual(
      await volley(level),
      SHOAL_N,
      `${SHOAL_TOWER.name} at level ${level}: multishot(${SHOAL_N})`,
    );
  }
});
