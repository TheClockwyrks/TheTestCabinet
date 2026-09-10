// abilities/burn-credited — the burn's damage belongs to whatever set it.
//
// specs/enemies.md fixes it: "Burn damage is credited to the component that
// applied it, for that component's kill and damage tallies." specs/components.md
// says the same from the tallies' side: "Burn damage counts toward the tallies of
// the structure that applied the burn." specs/hud.md is what it is for — the
// damage leaderboard "ranking the player's firing structures by total damage
// dealt" — so a build that drops burn damage on the floor ranks a Rectifier as if
// it barely fired.
//
// The arrangement makes the credit unmistakable. One Tesla-Prime Rectifier, one
// held Dynamo posed to a health its direct hit cannot reach on its own, and
// nothing else on the yard. The shot takes off its `220` and leaves the unit
// standing; the burn it set finishes the unit off well before the Rectifier's next
// shot is due. What is read is the one structure's two tallies: one kill, and a
// damage figure that is the whole health the unit carried rather than the shot
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { componentDamage, RECTIFIER_BURN_FRAC } from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Tesla-Prime Rectifier's `128`. */
const TARGET_RANGE = 60;

/** The tier: a `220` shot, so a `110` a second burn. */
const TIER = 5;

/** The health the unit is posed to: more than the shot, less than shot plus burn. */
const POSED_HP = 260;

/** How long the kill is waited for, in seconds. */
const PATIENCE = 5;

/** The burn the shot sets. */
const DPS = componentDamage("rectifier", TIER) * RECTIFIER_BURN_FRAC;

/**
 * What the burn tick that lands the kill may overshoot the unit's health by.
 *
 * A build that clamps the last tick to the health left tallies exactly what the
 * unit carried; a build that tallies the whole tick overshoots by at most one
 * update of burn. The update is bounded at a thirtieth of a second, which is
 * slower than anything that could pass for a frame rate.
 */
const OVERSHOOT = DPS / 30;

/**
 * What a clamped tally may fall short of the unit's health by.
 *
 * A build that clamps the killing tick sums the shot and every burn tick's
 * `burnDps * dt` in floating point, and that sum lands within rounding of the
 * health the unit carried rather than on it exactly. The slack admits rounding
 * alone: a tally that stops at the shot is `40` short.
 */
const TALLY_SLACK = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("tallies the kill and the whole health the burn finished off", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "rectifier", TIER, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  parkUnit(
    h,
    "dynamo",
    { x: structure.cx + TARGET_RANGE, y: structure.cy },
    { hp: POSED_HP },
  );

  const killed = await captureReplay(h, "credit", () =>
    h.until((s) => s.units.length === 0, {
      maxFrames: ticks(PATIENCE),
      poll: 1,
    }),
  );

  assertEqual(
    killed.hit,
    true,
    `the unit finished off by the burn within ${PATIENCE}s`,
  );
  const after = structureById(killed.snapshot, id);
  assertEqual(
    after.kills,
    1,
    "the Rectifier's kill tally after its burn finished the unit off " +
      "(specs/enemies.md)",
  );
  // The direct hit alone could not have done this, so a tally that stops at the
  // shot lands short of the health the unit was carrying.
  assertBetween(
    after.damageDealt,
    POSED_HP - TALLY_SLACK,
    POSED_HP + OVERSHOOT,
    `the Rectifier's damage tally: the ${POSED_HP} health the unit carried, ` +
      `of which ${componentDamage("rectifier", TIER)} was the shot and the ` +
      `rest the burn it set (specs/components.md)`,
  );
});
