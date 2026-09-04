// abilities/slow-strongest-wins — a weaker slow cannot loosen a stronger one.
//
// specs/enemies.md fixes the arithmetic: "Applying a slow of amount `amt` at time
// `now` for `dur` seconds sets `slowFactor = min(slowFactor, 1 - amt)`", and says
// what that means in play: "Slows do not stack: the strongest slow in effect wins,
// and a fresh hit refreshes the duration."
//
// This is the edge case the rule already implies, and it is its own point because
// a build that simply assigns the newest amount plays a yard where a cheap Choke
// undoes an Aurora Lance's hold. The slows are applied through the surface's own
// `setUnitSlow`, which specs/instrumentation.md defines as applying "through the
// rule specs/enemies.md fixes" — so the unit is the only thing on the yard and
// there is no structure, no shot and no cadence between the check and the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  tileCenter,
  unitById,
  type Harness,
} from "../harness";

/** The stronger slow, applied first, and the weaker one applied over it. */
const STRONG = { amount: 0.6, seconds: 3 };
const WEAK = { amount: 0.2, seconds: 3 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the stronger factor when a weaker slow lands on top of it", async () => {
  openYard(h, { wave: 1 });
  const unit = parkUnit(h, "dynamo", tileCenter(20, 20), {
    slow: STRONG,
  });

  const held = await captureReplay(h, "stack", async () => {
    const strong = unitById(h.snapshot(), unit);
    h.debug.setUnitSlow(unit, WEAK.amount, WEAK.seconds);
    await h.advanceSeconds(0.5);
    return { strong, after: unitById(h.snapshot(), unit) };
  });

  assertCloseTo(
    held.strong.slowFactor,
    1 - STRONG.amount,
    6,
    `slowFactor after a slow of ${STRONG.amount} (specs/enemies.md)`,
  );
  assertCloseTo(
    held.after.slowFactor,
    1 - STRONG.amount,
    6,
    `slowFactor after a slow of ${WEAK.amount} landed on a slow of ` +
      `${STRONG.amount}: min(slowFactor, 1 - amount) keeps the stronger ` +
      `(specs/enemies.md)`,
  );
  assertCloseTo(
    held.after.speed,
    held.after.baseSpeed * (1 - STRONG.amount),
    6,
    "the speed the unit moves at while the stronger slow holds",
  );
});
