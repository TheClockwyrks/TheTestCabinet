// cargo/slot-cap-from-the-tier — the bay capacity is the cargo tier's.
//
// specs/upgrades.md: the cargo track "sets the cargo capacity in ore slots",
// `15`, `25`, `40`, `70` and `120` across its five tiers, and weight is a separate
// limit set by the jetpack. specs/instrumentation.md has the snapshot report that
// capacity as `cargo.slotCap`.
//
// So each tier is posed in turn and the capacity read against the table. The
// jetpack tier is left where a fresh expedition opens it, so nothing here moves
// the weight limit alongside the slot one.

import { afterEach, beforeEach, it } from "vitest";
import { CARGO_TIERS, JETPACK_TIERS, MAX_TIER } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  stageTiers,
  standAtCamp,
  type Harness,
} from "../harness";

/** The tier the still is taken at: a raised one, so it is not the opening bay. */
const SHOWN_TIER = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the capacity the cargo tier gives, tier by tier", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinMiner(h);
  pinDrill(h);

  const opening = h.snapshot();
  assertEqual(opening.tiers.cargo, 1, "specs/expedition.md");
  assertEqual(opening.cargo.slotCap, CARGO_TIERS[0], "specs/upgrades.md");

  for (let tier = 1; tier <= MAX_TIER.cargo; tier += 1) {
    stageTiers(h, { cargo: tier });
    const snapshot = h.snapshot();
    assertEqual(
      snapshot.cargo.slotCap,
      CARGO_TIERS[tier - 1],
      `cargo tier ${tier} (specs/upgrades.md)`,
    );
    // And the weight limit, which the jetpack sets, did not move with it.
    assertEqual(
      snapshot.cargo.liftLimitKg,
      JETPACK_TIERS[0].liftLimitKg,
      `cargo tier ${tier} (specs/upgrades.md)`,
    );
  }

  stageTiers(h, { cargo: SHOWN_TIER });
  h.debug.setPanel("inventory");
  await h.advance(1);
  captureStill(h, "cap");
  assertEqual(
    h.snapshot().cargo.slotCap,
    CARGO_TIERS[SHOWN_TIER - 1],
    "specs/upgrades.md",
  );
});
