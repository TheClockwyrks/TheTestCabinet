// combos/status-abilities-flat-across-level — a slow's and a burn's parameters do not move with the level.
//
// specs/combinations.md: "Fire rate and every ability parameter are flat across
// level, so a tower scales through its damage alone." The level scaling table
// underneath it moves two figures and no others: damage by
// `COMBO_DAMAGE_MULT[level]` and range by `COMBO_RANGE_BONUS[level]`.
//
// FOUR POINTS READ THAT SENTENCE. A build that scales one ability parameter with
// the level must not cost itself the same single point as one that scales every
// parameter and the cadence too, so the cadence, the reported ability block, the
// slow and burn a struck unit carries, and a multishot's `N` are each decided by
// name. `combos/flat.ts` holds what they share.
//
// WHAT IS DECIDED HERE is what only the game shows. A slow's amount and duration
// and a burn's fraction and duration are carried by the unit that was struck, and
// specs/instrumentation.md reports all four on it. So a Corroder —
// `slow(0.2, 1.0)`, `burn(0.6, 3.0)` — is fired at a held unit at each end of the
// track and the struck unit is read. The shot's damage doubles across the track,
// so a build whose burn FRACTION moved with the level fails here even though its
// `burnDps` rose either way.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  TICK_HZ,
} from "../harness";
import { BURN, ENDS, SLOW, STATUS_TOWER, WAVE, firstHit } from "./flat";
import { comboDamage } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a slow and a burn's parameters across the whole level track", async () => {
  openYard(h, { wave: WAVE });

  const tolerance = 2 / TICK_HZ;
  for (const level of ENDS) {
    const hit = await firstHit(h, level);
    assertCloseTo(
      hit.slowFactor,
      1 - SLOW.amount,
      6,
      `${STATUS_TOWER.name} at level ${level}: slow(${SLOW.amount})`,
    );
    assertBetween(
      hit.slowFor,
      SLOW.duration - tolerance,
      SLOW.duration,
      `${STATUS_TOWER.name} at level ${level}: a slow of ${SLOW.duration} s`,
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
      BURN.duration - tolerance,
      BURN.duration,
      `${STATUS_TOWER.name} at level ${level}: a burn of ${BURN.duration} s`,
    );
  }
  captureStill(h, "flat");
});
