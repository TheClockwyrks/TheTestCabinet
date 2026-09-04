// abilities/burn-strongest-wins — a weaker burn cannot slow the burn down.
//
// specs/enemies.md fixes the arithmetic: "Applying a burn of `dps` at time `now`
// for `dur` seconds sets `burnDps = max(burnDps, dps)`", and says what it means:
// "Burns do not stack: the target keeps the strongest `burnDps` and a fresh hit
// refreshes the duration."
//
// This is the edge case the rule already implies, and it is its own point because
// a build that simply assigns the newest rate lets a cheap Rectifier smother a
// Rupture Node's burn. The burns are applied through the surface's own
// `setUnitBurn`, which specs/instrumentation.md defines as applying "through the
// rule specs/enemies.md fixes", so the unit is the only thing on the yard and no
// structure, shot or cadence stands between the check and the rule. Both the
// reported rate and the health that actually leaves the unit are read, so a build
// that reports the strong figure and burns at the weak one fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  tileCenter,
  unitById,
  type Harness,
} from "../harness";

/** The stronger burn, applied first, and the weaker one applied over it. */
const STRONG = { dps: 20, seconds: 4 };
const WEAK = { dps: 5, seconds: 4 };

/** The window the health is watched over, inside both durations. */
const WINDOW = 1;

/** What one update of integration can leave either side of the figure. */
const SLACK = STRONG.dps * 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the stronger rate when a weaker burn lands on top of it", async () => {
  openYard(h, { wave: 1 });
  const unit = parkUnit(h, "dynamo", tileCenter(20, 20), {
    burn: STRONG,
  });

  const held = await captureReplay(h, "stack", async () => {
    const strong = unitById(h.snapshot(), unit);
    h.debug.setUnitBurn(unit, WEAK.dps, WEAK.seconds);
    const opened = unitById(h.snapshot(), unit);
    await h.advanceSeconds(WINDOW);
    return { strong, opened, closed: unitById(h.snapshot(), unit) };
  });

  assertCloseTo(
    held.strong.burnDps,
    STRONG.dps,
    6,
    `burnDps after a burn of ${STRONG.dps} a second (specs/enemies.md)`,
  );
  assertCloseTo(
    held.opened.burnDps,
    STRONG.dps,
    6,
    `burnDps after a burn of ${WEAK.dps} landed on a burn of ${STRONG.dps}: ` +
      `max(burnDps, dps) keeps the stronger (specs/enemies.md)`,
  );
  assertBetween(
    held.opened.hp - held.closed.hp,
    STRONG.dps * WINDOW - SLACK,
    STRONG.dps * WINDOW + SLACK,
    `the health that left the unit over ${WINDOW}s: the stronger rate rather ` +
      `than the ${WEAK.dps} of the burn applied last`,
  );
});
