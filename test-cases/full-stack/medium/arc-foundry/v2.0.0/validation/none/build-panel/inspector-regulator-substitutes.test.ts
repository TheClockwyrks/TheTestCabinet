// build-panel/inspector-regulator-substitutes — a Regulator's inspector reads its aura.
//
// `specs/hud.md`: a selected Regulator reads "its type, its quality tier, and its
// aura radius and bonus in place of damage, range, and fire rate".
// `specs/components.md` fixes that aura by tier in `REGULATOR_AURA` — at Charged,
// a radius of `102` and a bonus of `+16%` — and `specs/instrumentation.md` has
// the snapshot report both as `auraRadius` and `auraBonus`.
//
// The two figures are held against the snapshot's own, so the reading is of the
// build's Regulator rather than of a table copied twice, and the bonus counts as
// drawn whether it is set as a percentage or as a fraction. Two tiers are read,
// because a panel that draws one tier's aura from a constant would pass on one.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  structureById,
  type Harness,
} from "../harness";
import { NON_FIRING_TYPE, REGULATOR_AURA, type Tier } from "../constants";
import { PANEL, figures } from "./reading";

const TIERS_READ: readonly Tier[] = [3, 5];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A bonus reads as drawn as a percentage or as a fraction. */
function drawsBonus(drawn: readonly number[], bonus: number): boolean {
  return drawn.some(
    (f) => Math.abs(f - bonus * 100) <= 0.5 || Math.abs(f - bonus) <= 0.005,
  );
}

it("draws the Regulator's aura radius and bonus, at two tiers", async () => {
  await openYard(h);

  for (const tier of TIERS_READ) {
    const regulator = await standComponent(h, NON_FIRING_TYPE, tier, 10, 10);
    await h.debug.select(regulator);

    const drawn = await h.frameCalls();
    if (tier === TIERS_READ[0]) await captureStill(h, "inspector");
    const reported = structureById(await h.snapshot(), regulator);
    assertEqual(
      reported.auraRadius,
      REGULATOR_AURA[tier - 1]!.radius,
      `the aura radius a tier-${tier} Regulator reports (specs/components.md)`,
    );
    assertEqual(
      reported.auraBonus,
      REGULATOR_AURA[tier - 1]!.bonus,
      `the aura bonus a tier-${tier} Regulator reports (specs/components.md)`,
    );

    const panel = figures(drawn, PANEL);
    assertContains(
      panel,
      reported.auraRadius,
      `the panel's figures with a tier-${tier} Regulator selected`,
    );
    assertEqual(
      drawsBonus(panel, reported.auraBonus),
      true,
      `whether the panel draws the tier-${tier} aura bonus ` +
        `${reported.auraBonus}; it drew ${panel.join(", ")}`,
    );

    await h.debug.dismantle(regulator);
  }
});
